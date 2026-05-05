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

  if (generation.outputAsset) {
    await deleteObject(generation.outputAsset.storageKey).catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, "Failed to delete output object");
    });
    await prisma.mediaAsset.delete({ where: { id: generation.outputAsset.id } }).catch(() => {});
  }
  await prisma.generation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
