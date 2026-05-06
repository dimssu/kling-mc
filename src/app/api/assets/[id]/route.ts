import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset, Generation, ImageGeneration } from "@/models";
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
  const asset = await MediaAsset.findById(id).lean();
  if (!asset || asset.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ asset: toApi(asset) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const asset = await MediaAsset.findById(id).lean();
  if (!asset || asset.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Block delete if any generation/image-gen still references this asset.
  const [vidUse, imgGenUseSubject, imgGenUseScene, imgGenUseStyle, vidGenOutput, imgGenOutput] =
    await Promise.all([
      Generation.findOne({
        $or: [{ sourceVideoId: id }, { referenceImageId: id }],
      }).lean(),
      ImageGeneration.findOne({ subjectImageIds: id }).lean(),
      ImageGeneration.findOne({ sceneImageId: id }).lean(),
      ImageGeneration.findOne({ styleImageId: id }).lean(),
      Generation.findOne({ outputAssetId: id }).lean(),
      ImageGeneration.findOne({ outputAssetId: id }).lean(),
    ]);
  if (
    vidUse ||
    imgGenUseSubject ||
    imgGenUseScene ||
    imgGenUseStyle ||
    vidGenOutput ||
    imgGenOutput
  ) {
    return NextResponse.json(
      { error: "Asset is in use by a generation; delete the generation first." },
      { status: 409 },
    );
  }

  await deleteObject(asset.storageKey).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : err }, "Storage delete failed");
  });
  await MediaAsset.deleteOne({ _id: id });
  return NextResponse.json({ ok: true });
}
