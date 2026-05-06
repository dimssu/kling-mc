import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { value?: boolean };

  let updated;
  if (typeof body.value === "boolean") {
    updated = await MediaAsset.findOneAndUpdate(
      { _id: id, ownerId: env.DEFAULT_USER_ID },
      { $set: { isFavorite: body.value } },
      { new: true, lean: true },
    );
  } else {
    // Atomic toggle via aggregation pipeline update.
    updated = await MediaAsset.findOneAndUpdate(
      { _id: id, ownerId: env.DEFAULT_USER_ID },
      [{ $set: { isFavorite: { $not: "$isFavorite" } } }],
      { new: true, lean: true },
    );
  }

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ asset: toApi(updated) });
}
