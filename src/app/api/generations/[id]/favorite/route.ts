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

  // Atomic toggle when no explicit value is given. Avoids the read-modify-write
  // race when two tabs click the star at the same time.
  if (typeof body.value === "boolean") {
    const updated = await prisma.generation.updateMany({
      where: { id, ownerId: env.DEFAULT_USER_ID },
      data: { isFavorite: body.value },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Generation" SET "isFavorite" = NOT "isFavorite", "updatedAt" = NOW()
       WHERE "id" = $1 AND "ownerId" = $2`,
      id,
      env.DEFAULT_USER_ID,
    );
    if (result === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const generation = await prisma.generation.findUnique({ where: { id } });
  return NextResponse.json({ generation });
}
