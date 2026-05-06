import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Generation, MediaAsset } from "@/models";
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
  const generation = await Generation.findById(id).lean();
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ids = [generation.sourceVideoId, generation.referenceImageId, generation.outputAssetId].filter(
    (x): x is string => !!x,
  );
  const assets = await MediaAsset.find({ _id: { $in: ids } }).lean();
  const m = new Map(assets.map((a) => [String(a._id), a]));
  return NextResponse.json({
    generation: toApi({
      ...generation,
      sourceVideo: m.get(generation.sourceVideoId) ?? null,
      referenceImage: m.get(generation.referenceImageId) ?? null,
      outputAsset: generation.outputAssetId ? (m.get(generation.outputAssetId) ?? null) : null,
    }),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const generation = await Generation.findById(id).lean();
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const outputAsset = generation.outputAssetId
    ? await MediaAsset.findById(generation.outputAssetId).lean()
    : null;
  const outputStorageKey = outputAsset?.storageKey;

  await Generation.deleteOne({ _id: id });
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
