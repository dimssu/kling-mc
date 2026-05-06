import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await connectMongo();
  const env = getEnv();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? undefined;
  const favorite = url.searchParams.get("favorite") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const filter: Record<string, unknown> = { ownerId: env.DEFAULT_USER_ID };
  if (kind) filter.kind = kind;
  if (favorite) filter.isFavorite = true;

  if (cursor) {
    const cursorDoc = await MediaAsset.findById(cursor).lean();
    if (cursorDoc) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, _id: { $lt: cursor } },
      ];
    }
  }

  const items = await MediaAsset.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  return NextResponse.json({ items: toApi(trimmed), nextCursor });
}
