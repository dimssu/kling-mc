import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";
import { estimateImageCostUsd, type KlingImageModel } from "@/lib/kling/pricing";
import { createCarouselSchema, validateImageFile } from "@/lib/validation";
import { isLlmConfigured, suggestCarouselPosePrompts } from "@/lib/gemini";
import { Decimal } from "@/generated/prisma/runtime/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const where = {
    ownerId: env.DEFAULT_USER_ID,
    ...(status ? { status } : {}),
  };

  const items = await prisma.imageCarousel.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      slides: {
        orderBy: { slotIndex: "asc" },
        include: { outputAsset: true },
      },
    },
  });

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;

  return NextResponse.json({ items: trimmed, nextCursor });
}

export async function POST(req: Request) {
  const env = getEnv();

  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createCarouselSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const subject = await prisma.mediaAsset.findUnique({
    where: { id: input.subjectImageId },
  });
  if (!subject || subject.ownerId !== env.DEFAULT_USER_ID || subject.kind !== "reference_image") {
    return NextResponse.json(
      { error: `subjectImage not found: ${input.subjectImageId}` },
      { status: 400 },
    );
  }
  const check = validateImageFile({
    mimeType: subject.mimeType,
    sizeBytes: subject.sizeBytes,
    width: subject.width ?? undefined,
    height: subject.height ?? undefined,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: `${subject.filename}: ${check.reason}` },
      { status: 400 },
    );
  }

  let plan;
  try {
    plan = await suggestCarouselPosePrompts({
      theme: input.themePrompt,
      n: input.n,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Carousel pose planning failed",
    );
    return NextResponse.json(
      {
        error:
          "Could not plan the carousel — " +
          (err instanceof Error ? err.message : "try again"),
      },
      { status: 502 },
    );
  }

  const estimatedCost = estimateImageCostUsd(
    input.modelName as KlingImageModel,
    input.n,
    input.endpoint,
  );

  const carousel = await prisma.$transaction(async (tx) => {
    const parent = await tx.imageCarousel.create({
      data: {
        ownerId: env.DEFAULT_USER_ID,
        status: "queued",
        n: input.n,
        themePrompt: input.themePrompt ?? null,
        vibeLabel: plan.vibeLabel,
        subjectImageId: input.subjectImageId,
        modelName: input.modelName,
        endpoint: input.endpoint,
        imageReference: input.imageReference ?? null,
        aspectRatio: input.aspectRatio ?? null,
        estimatedCostUsd: new Decimal(estimatedCost),
      },
    });

    for (let i = 0; i < input.n; i++) {
      const slide = plan.slides[i];
      const externalTaskId = `kmc_carousel_${parent.id}_${i}_${randomUUID().slice(0, 8)}`;
      // For image2image (default), one subject image is enough; the
      // multi-image2image hack of duplicating into styleImageId is dropped.
      // For multi-image2image, fall back to that hack so Kling's ≥2-refs
      // requirement is satisfied without asking the user for two photos.
      const isMulti = input.endpoint === "multi-image2image";
      await tx.imageGeneration.create({
        data: {
          ownerId: env.DEFAULT_USER_ID,
          status: "queued",
          provider: "kling_official",
          externalTaskId,
          endpoint: input.endpoint,
          subjectImageIds: [input.subjectImageId],
          styleImageId: isMulti ? input.subjectImageId : null,
          prompt: slide.prompt,
          negativePrompt: slide.negativePrompt,
          modelName: input.modelName,
          imageReference: input.imageReference ?? null,
          aspectRatio: input.aspectRatio ?? null,
          n: 1,
          // Per-slide caption pack is intentionally OFF; the carousel parent
          // owns one unified caption set generated post-completion.
          captionPackEnabled: false,
          estimatedCostUsd: new Decimal(
            estimateImageCostUsd(input.modelName as KlingImageModel, 1, input.endpoint),
          ),
          carouselId: parent.id,
          slotIndex: i,
          poseLabel: slide.poseLabel,
        },
      });
    }

    return tx.imageCarousel.findUniqueOrThrow({
      where: { id: parent.id },
      include: {
        slides: { orderBy: { slotIndex: "asc" } },
      },
    });
  });

  // Enqueue jobs OUTSIDE the transaction so we don't hold a DB lock during
  // Redis writes and so a Redis failure doesn't roll back the rows.
  const queue = getImageGenerationQueue();
  await Promise.all(
    carousel.slides.map((slide) =>
      queue.add(
        "image-to-image",
        { imageGenerationId: slide.id },
        { jobId: slide.id },
      ),
    ),
  );

  logger.info(
    { carouselId: carousel.id, n: carousel.n, vibeLabel: carousel.vibeLabel },
    "Carousel queued",
  );

  return NextResponse.json({ carousel }, { status: 201 });
}
