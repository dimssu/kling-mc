import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Generation, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMotionControlQueue } from "@/lib/queue";
import { estimateCostUsd } from "@/lib/kling/pricing";
import { createGenerationSchema, validateImageFile, validateVideoFile } from "@/lib/validation";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await connectMongo();
  const env = getEnv();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const favorite = url.searchParams.get("favorite") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const filter: Record<string, unknown> = { ownerId: env.DEFAULT_USER_ID };
  if (status) filter.status = status;
  if (favorite) filter.isFavorite = true;

  if (cursor) {
    const cursorDoc = await Generation.findById(cursor).lean();
    if (cursorDoc) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, _id: { $lt: cursor } },
      ];
    }
  }

  const items = await Generation.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  // Resolve referenced MediaAssets in one round-trip.
  const assetIds = new Set<string>();
  for (const g of trimmed) {
    if (g.sourceVideoId) assetIds.add(g.sourceVideoId);
    if (g.referenceImageId) assetIds.add(g.referenceImageId);
    if (g.outputAssetId) assetIds.add(g.outputAssetId);
  }
  const assets = await MediaAsset.find({ _id: { $in: [...assetIds] } }).lean();
  const assetMap = new Map(assets.map((a) => [String(a._id), a]));
  const enriched = trimmed.map((g) => ({
    ...g,
    sourceVideo: assetMap.get(g.sourceVideoId) ?? null,
    referenceImage: assetMap.get(g.referenceImageId) ?? null,
    outputAsset: g.outputAssetId ? (assetMap.get(g.outputAssetId) ?? null) : null,
  }));

  return NextResponse.json({ items: toApi(enriched), nextCursor });
}

export async function POST(req: Request) {
  await connectMongo();
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
    MediaAsset.findById(input.sourceVideoId).lean(),
    MediaAsset.findById(input.referenceImageId).lean(),
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

  const { randomUUID } = await import("node:crypto");
  const externalTaskId = `kmc_${randomUUID().replace(/-/g, "")}`;

  const generation = await Generation.create({
    ownerId: env.DEFAULT_USER_ID,
    status: "queued",
    provider: "kling_official",
    externalTaskId,
    sourceVideoId: String(sourceVideo._id),
    referenceImageId: String(referenceImage._id),
    prompt: input.prompt ?? null,
    modelName: input.modelName,
    mode: input.mode,
    characterOrientation: input.characterOrientation,
    keepOriginalSound: input.keepOriginalSound,
    watermarkEnabled: input.watermarkEnabled,
    captionPackEnabled: input.captionPackEnabled,
    estimatedCostUsd: estimatedCost,
  });

  const queue = getMotionControlQueue();
  await queue.add(
    "motion-control",
    { generationId: String(generation._id) },
    { jobId: String(generation._id) },
  );
  logger.info(
    { generationId: String(generation._id), externalTaskId },
    "Generation enqueued",
  );

  return NextResponse.json({ generation: toApi(generation.toObject()) }, { status: 201 });
}
