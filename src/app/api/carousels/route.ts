import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ImageCarousel, ImageGeneration, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";
import { estimateImageCostUsd, type KlingImageModel } from "@/lib/kling/pricing";
import { createCarouselSchema, validateImageFile } from "@/lib/validation";
import { isLlmConfigured, suggestCarouselPosePrompts } from "@/lib/gemini";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await connectMongo();
  const env = getEnv();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const filter: Record<string, unknown> = { ownerId: env.DEFAULT_USER_ID };
  if (status) filter.status = status;

  if (cursor) {
    const cursorDoc = await ImageCarousel.findById(cursor).lean();
    if (cursorDoc) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, _id: { $lt: cursor } },
      ];
    }
  }

  const items = await ImageCarousel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  // Resolve all slides + their output assets in two round-trips.
  const carouselIds = trimmed.map((c) => String(c._id));
  const slides = await ImageGeneration.find({ carouselId: { $in: carouselIds } })
    .sort({ slotIndex: 1 })
    .lean();
  const outputIds = slides.map((s) => s.outputAssetId).filter((x): x is string => !!x);
  const outputs = outputIds.length
    ? await MediaAsset.find({ _id: { $in: outputIds } }).lean()
    : [];
  const outputMap = new Map(outputs.map((a) => [String(a._id), a]));

  const slidesByCarousel = new Map<string, typeof slides>();
  for (const s of slides) {
    const cid = s.carouselId ?? "";
    if (!cid) continue;
    if (!slidesByCarousel.has(cid)) slidesByCarousel.set(cid, []);
    slidesByCarousel.get(cid)!.push(s);
  }

  const enriched = trimmed.map((c) => ({
    ...c,
    slides: (slidesByCarousel.get(String(c._id)) ?? []).map((s) => ({
      ...s,
      outputAsset: s.outputAssetId ? (outputMap.get(s.outputAssetId) ?? null) : null,
    })),
  }));

  return NextResponse.json({ items: toApi(enriched), nextCursor });
}

export async function POST(req: Request) {
  await connectMongo();
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
      {
        error: parsed.error.issues[0]?.message ?? "Validation failed",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const subject = await MediaAsset.findById(input.subjectImageId).lean();
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
    return NextResponse.json({ error: `${subject.filename}: ${check.reason}` }, { status: 400 });
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

  const parent = await ImageCarousel.create({
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
    estimatedCostUsd: estimatedCost,
  });

  const isMulti = input.endpoint === "multi-image2image";
  const slideDocs = await ImageGeneration.insertMany(
    Array.from({ length: input.n }, (_, i) => {
      const slide = plan.slides[i];
      return {
        ownerId: env.DEFAULT_USER_ID,
        status: "queued",
        provider: "kling_official",
        externalTaskId: `kmc_carousel_${String(parent._id)}_${i}_${randomUUID().slice(0, 8)}`,
        endpoint: input.endpoint,
        subjectImageIds: [input.subjectImageId],
        styleImageId: isMulti ? input.subjectImageId : null,
        prompt: slide.prompt,
        negativePrompt: slide.negativePrompt,
        modelName: input.modelName,
        imageReference: input.imageReference ?? null,
        aspectRatio: input.aspectRatio ?? null,
        n: 1,
        captionPackEnabled: false,
        estimatedCostUsd: estimateImageCostUsd(
          input.modelName as KlingImageModel,
          1,
          input.endpoint,
        ),
        carouselId: String(parent._id),
        slotIndex: i,
        poseLabel: slide.poseLabel,
      };
    }),
  );

  // Enqueue jobs OUTSIDE any transaction so a Redis failure doesn't roll back rows.
  const queue = getImageGenerationQueue();
  await Promise.all(
    slideDocs.map((slide) =>
      queue.add(
        "image-to-image",
        { imageGenerationId: String(slide._id) },
        { jobId: String(slide._id) },
      ),
    ),
  );

  logger.info(
    { carouselId: String(parent._id), n: input.n, vibeLabel: parent.vibeLabel },
    "Carousel queued",
  );

  const carouselWithSlides = {
    ...parent.toObject(),
    slides: slideDocs.map((s) => s.toObject()),
  };

  return NextResponse.json({ carousel: toApi(carouselWithSlides) }, { status: 201 });
}
