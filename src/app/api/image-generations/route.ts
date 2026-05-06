import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ImageGeneration, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";
import { estimateImageCostUsd, type KlingImageModel } from "@/lib/kling/pricing";
import { createImageGenerationSchema, validateImageFile } from "@/lib/validation";
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
    const cursorDoc = await ImageGeneration.findById(cursor).lean();
    if (cursorDoc) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, _id: { $lt: cursor } },
      ];
    }
  }

  const items = await ImageGeneration.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  // Resolve sceneImage / styleImage / outputAsset for the cards.
  const assetIds = new Set<string>();
  for (const g of trimmed) {
    if (g.sceneImageId) assetIds.add(g.sceneImageId);
    if (g.styleImageId) assetIds.add(g.styleImageId);
    if (g.outputAssetId) assetIds.add(g.outputAssetId);
  }
  const assets = await MediaAsset.find({ _id: { $in: [...assetIds] } }).lean();
  const m = new Map(assets.map((a) => [String(a._id), a]));
  const enriched = trimmed.map((g) => ({
    ...g,
    sceneImage: g.sceneImageId ? (m.get(g.sceneImageId) ?? null) : null,
    styleImage: g.styleImageId ? (m.get(g.styleImageId) ?? null) : null,
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

  const parsed = createImageGenerationSchema.safeParse(body);
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

  const referencedIds = [
    ...input.subjectImageIds,
    ...(input.sceneImageId ? [input.sceneImageId] : []),
    ...(input.styleImageId ? [input.styleImageId] : []),
  ];
  const assets = await MediaAsset.find({
    _id: { $in: referencedIds },
    ownerId: env.DEFAULT_USER_ID,
  }).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));

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
      return NextResponse.json({ error: `${a.filename}: ${check.reason}` }, { status: 400 });
    }
  }

  const estimatedCost = estimateImageCostUsd(
    input.modelName as KlingImageModel,
    input.n,
    input.endpoint,
  );
  const externalTaskId = `kmc_img_${randomUUID().replace(/-/g, "")}`;

  const created = await ImageGeneration.create({
    ownerId: env.DEFAULT_USER_ID,
    status: "queued",
    provider: "kling_official",
    externalTaskId,
    endpoint: input.endpoint,
    subjectImageIds: input.subjectImageIds,
    sceneImageId: input.sceneImageId ?? null,
    styleImageId: input.styleImageId ?? null,
    prompt: input.prompt ?? null,
    negativePrompt: input.negativePrompt ?? null,
    modelName: input.modelName,
    imageReference: input.imageReference ?? null,
    aspectRatio: input.aspectRatio ?? null,
    n: input.n,
    captionPackEnabled: input.captionPackEnabled,
    estimatedCostUsd: estimatedCost,
  });

  const queue = getImageGenerationQueue();
  await queue.add(
    "image-to-image",
    { imageGenerationId: String(created._id) },
    { jobId: String(created._id) },
  );
  logger.info(
    { imageGenerationId: String(created._id), externalTaskId, refs: referencedIds.length },
    "Image generation enqueued",
  );

  return NextResponse.json(
    { imageGeneration: toApi(created.toObject()) },
    { status: 201 },
  );
}
