import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { VideoGeneration, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getVideoGenerationQueue } from "@/lib/queue";
import {
  estimateImage2VideoCostUsd,
  estimateMultiImage2VideoCostUsd,
} from "@/lib/kling/pricing";
import type {
  KlingImage2VideoMode,
  KlingImage2VideoModel,
  KlingMultiImage2VideoMode,
  KlingMultiImage2VideoModel,
} from "@/lib/kling/types";
import { createVideoGenerationSchema, validateImageFile } from "@/lib/validation";
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
    const cursorDoc = await VideoGeneration.findById(cursor).lean();
    if (cursorDoc) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, _id: { $lt: cursor } },
      ];
    }
  }

  const items = await VideoGeneration.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  const assetIds = new Set<string>();
  for (const g of trimmed) {
    for (const id of g.referenceImageIds) assetIds.add(id);
    if (g.tailImageId) assetIds.add(g.tailImageId);
    if (g.outputAssetId) assetIds.add(g.outputAssetId);
  }
  const assets = await MediaAsset.find({ _id: { $in: [...assetIds] } }).lean();
  const m = new Map(assets.map((a) => [String(a._id), a]));
  const enriched = trimmed.map((g) => ({
    ...g,
    referenceImages: g.referenceImageIds.map((id) => m.get(id) ?? null),
    tailImage: g.tailImageId ? (m.get(g.tailImageId) ?? null) : null,
    outputAsset: g.outputAssetId ? (m.get(g.outputAssetId) ?? null) : null,
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

  const parsed = createVideoGenerationSchema.safeParse(body);
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

  // Collect referenced asset IDs for fetch + validation, branched by endpoint.
  const refIds: string[] =
    input.endpoint === "image2video"
      ? [input.imageId, ...(input.tailImageId ? [input.tailImageId] : [])]
      : input.imageIds;

  const assets = await MediaAsset.find({
    _id: { $in: refIds },
    ownerId: env.DEFAULT_USER_ID,
  }).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));

  for (const id of refIds) {
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
      return NextResponse.json({ error: `${a.filename}: ${check.reason}` }, { status: 400 });
    }
  }

  const durationSec = Number(input.duration);
  const estimatedCost =
    input.endpoint === "image2video"
      ? estimateImage2VideoCostUsd(
          input.modelName as KlingImage2VideoModel,
          input.mode as KlingImage2VideoMode,
          durationSec,
        )
      : estimateMultiImage2VideoCostUsd(
          input.modelName as KlingMultiImage2VideoModel,
          input.mode as KlingMultiImage2VideoMode,
          durationSec,
        );

  const externalTaskId =
    input.endpoint === "image2video"
      ? `kmc_i2v_${randomUUID().replace(/-/g, "")}`
      : `kmc_miv_${randomUUID().replace(/-/g, "")}`;

  const referenceImageIds =
    input.endpoint === "image2video" ? [input.imageId] : input.imageIds;

  const created = await VideoGeneration.create({
    ownerId: env.DEFAULT_USER_ID,
    status: "queued",
    provider: "kling_official",
    externalTaskId,
    endpoint: input.endpoint,
    referenceImageIds,
    tailImageId:
      input.endpoint === "image2video" ? (input.tailImageId ?? null) : null,
    cfgScale: input.endpoint === "image2video" ? (input.cfgScale ?? null) : null,
    prompt: input.prompt ?? null,
    negativePrompt: input.negativePrompt ?? null,
    modelName: input.modelName,
    mode: input.mode,
    duration: input.duration,
    aspectRatio: input.aspectRatio,
    watermarkEnabled: input.watermarkEnabled,
    captionPackEnabled: input.captionPackEnabled,
    estimatedCostUsd: estimatedCost,
  });

  const queue = getVideoGenerationQueue();
  await queue.add(
    "multi-image-to-video",
    { videoGenerationId: String(created._id) },
    { jobId: String(created._id) },
  );
  logger.info(
    {
      videoGenerationId: String(created._id),
      externalTaskId,
      endpoint: input.endpoint,
      refs: referenceImageIds.length,
    },
    "Video generation enqueued",
  );

  return NextResponse.json(
    { videoGeneration: toApi(created.toObject()) },
    { status: 201 },
  );
}
