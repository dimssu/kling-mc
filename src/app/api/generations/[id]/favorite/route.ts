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

  const generation = await prisma.generation.findUnique({ where: { id } });
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.generation.update({
    where: { id },
    data: { isFavorite: body.value ?? !generation.isFavorite },
  });
  return NextResponse.json({ generation: updated });
}
