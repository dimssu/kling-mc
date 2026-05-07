import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { VideoGeneration, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { deleteObject } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const videoGen = await VideoGeneration.findById(id).lean();
  if (!videoGen || videoGen.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ids = [...videoGen.referenceImageIds];
  if (videoGen.tailImageId) ids.push(videoGen.tailImageId);
  if (videoGen.outputAssetId) ids.push(videoGen.outputAssetId);
  const assets = await MediaAsset.find({ _id: { $in: ids } }).lean();
  const m = new Map(assets.map((a) => [String(a._id), a]));
  return NextResponse.json({
    videoGeneration: toApi({
      ...videoGen,
      referenceImages: videoGen.referenceImageIds.map((rid) => m.get(rid) ?? null),
      tailImage: videoGen.tailImageId ? (m.get(videoGen.tailImageId) ?? null) : null,
      outputAsset: videoGen.outputAssetId ? (m.get(videoGen.outputAssetId) ?? null) : null,
    }),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const videoGen = await VideoGeneration.findById(id).lean();
  if (!videoGen || videoGen.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const outputAsset = videoGen.outputAssetId
    ? await MediaAsset.findById(videoGen.outputAssetId).lean()
    : null;
  const outputStorageKey = outputAsset?.storageKey;

  await VideoGeneration.deleteOne({ _id: id });
  if (outputAsset) {
    await MediaAsset.deleteOne({ _id: outputAsset._id });
  }

  if (outputStorageKey) {
    try {
      await deleteObject(outputStorageKey);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, outputStorageKey },
        "Output object delete failed after row delete — manual cleanup required",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
