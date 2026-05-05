import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { deleteObject } from "@/lib/storage";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;
  const imageGeneration = await prisma.imageGeneration.findUnique({
    where: { id },
    include: { sceneImage: true, styleImage: true, outputAsset: true },
  });
  if (!imageGeneration || imageGeneration.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // subjectImageIds is a Postgres String[] with no FK, so resolve to assets
  // here. Preserves the order the user picked.
  const subjects = await prisma.mediaAsset.findMany({
    where: { id: { in: imageGeneration.subjectImageIds } },
  });
  const byId = new Map(subjects.map((a) => [a.id, a]));
  const subjectImages = imageGeneration.subjectImageIds
    .map((sid) => byId.get(sid))
    .filter((a): a is NonNullable<typeof a> => !!a);

  return NextResponse.json({ imageGeneration: { ...imageGeneration, subjectImages } });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;
  const imageGeneration = await prisma.imageGeneration.findUnique({
    where: { id },
    include: { outputAsset: true },
  });
  if (!imageGeneration || imageGeneration.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const outputAssetId = imageGeneration.outputAsset?.id;
  const outputStorageKey = imageGeneration.outputAsset?.storageKey;

  await prisma.$transaction(async (tx) => {
    await tx.imageGeneration.delete({ where: { id } });
    if (outputAssetId) {
      await tx.mediaAsset.delete({ where: { id: outputAssetId } });
    }
  });

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
