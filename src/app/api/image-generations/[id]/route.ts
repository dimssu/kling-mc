import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ImageGeneration, MediaAsset } from "@/models";
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
  const imageGeneration = await ImageGeneration.findById(id).lean();
  if (!imageGeneration || imageGeneration.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const refIds = [
    ...imageGeneration.subjectImageIds,
    imageGeneration.sceneImageId,
    imageGeneration.styleImageId,
    imageGeneration.outputAssetId,
  ].filter((x): x is string => !!x);
  const assets = await MediaAsset.find({ _id: { $in: refIds } }).lean();
  const m = new Map(assets.map((a) => [String(a._id), a]));

  const subjectImages = imageGeneration.subjectImageIds
    .map((sid) => m.get(sid))
    .filter((a): a is NonNullable<typeof a> => !!a);

  return NextResponse.json({
    imageGeneration: toApi({
      ...imageGeneration,
      subjectImages,
      sceneImage: imageGeneration.sceneImageId
        ? (m.get(imageGeneration.sceneImageId) ?? null)
        : null,
      styleImage: imageGeneration.styleImageId
        ? (m.get(imageGeneration.styleImageId) ?? null)
        : null,
      outputAsset: imageGeneration.outputAssetId
        ? (m.get(imageGeneration.outputAssetId) ?? null)
        : null,
    }),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const imageGeneration = await ImageGeneration.findById(id).lean();
  if (!imageGeneration || imageGeneration.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const outputAsset = imageGeneration.outputAssetId
    ? await MediaAsset.findById(imageGeneration.outputAssetId).lean()
    : null;
  const outputStorageKey = outputAsset?.storageKey;

  await ImageGeneration.deleteOne({ _id: id });
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
