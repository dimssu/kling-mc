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
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: {
      sourceVideo: true,
      referenceImage: true,
      outputAsset: true,
    },
  });
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ generation });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { outputAsset: true },
  });
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete the DB rows transactionally first; only attempt storage cleanup once
  // the DB state is consistent. If the storage delete fails we surface the error
  // — the user can retry, or a sweeper can mop it up later.
  const outputAssetId = generation.outputAsset?.id;
  const outputStorageKey = generation.outputAsset?.storageKey;

  await prisma.$transaction(async (tx) => {
    await tx.generation.delete({ where: { id } });
    if (outputAssetId) {
      await tx.mediaAsset.delete({ where: { id: outputAssetId } });
    }
  });

  if (outputStorageKey) {
    try {
      await deleteObject(outputStorageKey);
    } catch (err) {
      // DB is already consistent; storage will be a leaked object. Log loudly so
      // the user can manually clean up if it matters.
      logger.warn(
        { err: err instanceof Error ? err.message : err, outputStorageKey },
        "Output object delete failed after row delete — manual cleanup required",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
