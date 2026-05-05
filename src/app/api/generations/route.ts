import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMotionControlQueue } from "@/lib/queue";
import { estimateCostUsd } from "@/lib/kling/pricing";
import { createGenerationSchema, validateImageFile, validateVideoFile } from "@/lib/validation";
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

  const items = await prisma.generation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      sourceVideo: true,
      referenceImage: true,
      outputAsset: true,
    },
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

  const parsed = createGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [sourceVideo, referenceImage] = await Promise.all([
    prisma.mediaAsset.findUnique({ where: { id: input.sourceVideoId } }),
    prisma.mediaAsset.findUnique({ where: { id: input.referenceImageId } }),
  ]);
  if (!sourceVideo || sourceVideo.ownerId !== env.DEFAULT_USER_ID || sourceVideo.kind !== "source_video") {
    return NextResponse.json({ error: "sourceVideoId not found" }, { status: 400 });
  }
  if (!referenceImage || referenceImage.ownerId !== env.DEFAULT_USER_ID || referenceImage.kind !== "reference_image") {
    return NextResponse.json({ error: "referenceImageId not found" }, { status: 400 });
  }

  const videoCheck = validateVideoFile({
    mimeType: sourceVideo.mimeType,
    sizeBytes: sourceVideo.sizeBytes,
    width: sourceVideo.width ?? undefined,
    height: sourceVideo.height ?? undefined,
    durationSec: sourceVideo.durationSec ?? undefined,
    characterOrientation: input.characterOrientation,
  });
  if (!videoCheck.ok) {
    return NextResponse.json({ error: videoCheck.reason }, { status: 400 });
  }
  const imageCheck = validateImageFile({
    mimeType: referenceImage.mimeType,
    sizeBytes: referenceImage.sizeBytes,
    width: referenceImage.width ?? undefined,
    height: referenceImage.height ?? undefined,
  });
  if (!imageCheck.ok) {
    return NextResponse.json({ error: imageCheck.reason }, { status: 400 });
  }

  const estimatedCost = estimateCostUsd(
    input.modelName,
    input.mode,
    sourceVideo.durationSec ?? 5,
  );

  const externalTaskId = `kmc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const generation = await prisma.generation.create({
    data: {
      ownerId: env.DEFAULT_USER_ID,
      status: "queued",
      provider: "kling_official",
      externalTaskId,
      sourceVideoId: sourceVideo.id,
      referenceImageId: referenceImage.id,
      prompt: input.prompt,
      modelName: input.modelName,
      mode: input.mode,
      characterOrientation: input.characterOrientation,
      keepOriginalSound: input.keepOriginalSound,
      watermarkEnabled: input.watermarkEnabled,
      estimatedCostUsd: new Decimal(estimatedCost),
    },
  });

  const queue = getMotionControlQueue();
  await queue.add("motion-control", { generationId: generation.id }, { jobId: generation.id });
  logger.info({ generationId: generation.id, externalTaskId }, "Generation enqueued");

  return NextResponse.json({ generation }, { status: 201 });
}
