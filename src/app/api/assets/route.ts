import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? undefined;
  const favorite = url.searchParams.get("favorite") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const where = {
    ownerId: env.DEFAULT_USER_ID,
    ...(kind ? { kind } : {}),
    ...(favorite ? { isFavorite: true } : {}),
  };

  const items = await prisma.mediaAsset.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;

  return NextResponse.json({ items: trimmed, nextCursor });
}
