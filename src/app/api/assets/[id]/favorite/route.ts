import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { value?: boolean };

  if (typeof body.value === "boolean") {
    const updated = await prisma.mediaAsset.updateMany({
      where: { id, ownerId: env.DEFAULT_USER_ID },
      data: { isFavorite: body.value },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "MediaAsset" SET "isFavorite" = NOT "isFavorite"
       WHERE "id" = $1 AND "ownerId" = $2`,
      id,
      env.DEFAULT_USER_ID,
    );
    if (result === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  return NextResponse.json({ asset });
}
