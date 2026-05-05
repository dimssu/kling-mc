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
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ asset });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      sourceForGenerations: { take: 1 },
      referenceForGenerations: { take: 1 },
      outputForGeneration: true,
    },
  });
  if (!asset || asset.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (asset.sourceForGenerations.length > 0 || asset.referenceForGenerations.length > 0 || asset.outputForGeneration) {
    return NextResponse.json(
      { error: "Asset is in use by a generation; delete the generation first." },
      { status: 409 },
    );
  }
  await deleteObject(asset.storageKey).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : err }, "Storage delete failed");
  });
  await prisma.mediaAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
