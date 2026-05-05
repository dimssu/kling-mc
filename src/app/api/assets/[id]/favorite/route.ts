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

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const updated = await prisma.mediaAsset.update({
    where: { id },
    data: { isFavorite: body.value ?? !asset.isFavorite },
  });
  return NextResponse.json({ asset: updated });
}
