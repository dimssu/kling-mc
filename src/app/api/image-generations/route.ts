import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";
import { estimateImageCostUsd, type KlingImageModel } from "@/lib/kling/pricing";
import { createImageGenerationSchema, validateImageFile } from "@/lib/validation";
import { Decimal } from "@/generated/prisma/runtime/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const favorite = url.searchParams.get("favorite") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const where = {
    ownerId: env.DEFAULT_USER_ID,
    ...(status ? { status } : {}),
    ...(favorite ? { isFavorite: true } : {}),
  };

  const items = await prisma.imageGeneration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: { sceneImage: true, styleImage: true, outputAsset: true },
  });

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;

  return NextResponse.json({ items: trimmed, nextCursor });
}

export async function POST(req: Request) {
  const env = getEnv();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createImageGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Resolve and validate every referenced asset in one round-trip.
  const referencedIds = [
    ...input.subjectImageIds,
    ...(input.sceneImageId ? [input.sceneImageId] : []),
    ...(input.styleImageId ? [input.styleImageId] : []),
  ];
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: referencedIds }, ownerId: env.DEFAULT_USER_ID },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const id of referencedIds) {
    const a = byId.get(id);
    if (!a || a.kind !== "reference_image") {
      return NextResponse.json({ error: `referenceImage not found: ${id}` }, { status: 400 });
    }
    const check = validateImageFile({
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width ?? undefined,
      height: a.height ?? undefined,
    });
    if (!check.ok) {
      return NextResponse.json(
        { error: `${a.filename}: ${check.reason}` },
        { status: 400 },
      );
    }
  }

  const estimatedCost = estimateImageCostUsd(input.modelName as KlingImageModel, input.n);
  const externalTaskId = `kmc_img_${randomUUID().replace(/-/g, "")}`;

  const imageGeneration = await prisma.imageGeneration.create({
    data: {
      ownerId: env.DEFAULT_USER_ID,
      status: "queued",
      provider: "kling_official",
      externalTaskId,
      subjectImageIds: input.subjectImageIds,
      sceneImageId: input.sceneImageId,
      styleImageId: input.styleImageId,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      modelName: input.modelName,
      aspectRatio: input.aspectRatio,
      n: input.n,
      captionPackEnabled: input.captionPackEnabled,
      estimatedCostUsd: new Decimal(estimatedCost),
    },
  });

  const queue = getImageGenerationQueue();
  await queue.add(
    "image-to-image",
    { imageGenerationId: imageGeneration.id },
    { jobId: imageGeneration.id },
  );
  logger.info(
    { imageGenerationId: imageGeneration.id, externalTaskId, refs: referencedIds.length },
    "Image generation enqueued",
  );

  return NextResponse.json({ imageGeneration }, { status: 201 });
}
