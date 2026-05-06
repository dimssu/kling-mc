import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Generation } from "@/models";
import { getEnv } from "@/lib/env";
import { pricingTable } from "@/lib/kling/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await connectMongo();
  const env = getEnv();
  const ownerId = env.DEFAULT_USER_ID;
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today, week, month, all, statusBreakdown] = await Promise.all([
    sumCost(ownerId, startOfDay),
    sumCost(ownerId, startOfWeek),
    sumCost(ownerId, startOfMonth),
    sumCost(ownerId, null),
    Generation.aggregate([
      { $match: { ownerId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return NextResponse.json({
    cost: {
      today: today.actual,
      week: week.actual,
      month: month.actual,
      allTime: all.actual,
      pending: all.estimatedPending,
    },
    counts: Object.fromEntries(
      (statusBreakdown as Array<{ _id: string; count: number }>).map((b) => [b._id, b.count]),
    ) as Record<string, number>,
    pricingTable: pricingTable(),
  });
}

async function sumCost(ownerId: string, sinceDate: Date | null) {
  const completedMatch: Record<string, unknown> = { ownerId, status: "completed" };
  if (sinceDate) completedMatch.completedAt = { $gte: sinceDate };

  const pendingMatch: Record<string, unknown> = {
    ownerId,
    status: { $in: ["queued", "processing"] },
  };
  if (sinceDate) pendingMatch.createdAt = { $gte: sinceDate };

  const [completedAgg, pendingAgg] = await Promise.all([
    Generation.aggregate([
      { $match: completedMatch },
      {
        $group: {
          _id: null,
          actualSum: { $sum: { $ifNull: ["$actualCostUsd", 0] } },
          estimatedSum: { $sum: { $ifNull: ["$estimatedCostUsd", 0] } },
        },
      },
    ]),
    Generation.aggregate([
      { $match: pendingMatch },
      { $group: { _id: null, estimatedSum: { $sum: { $ifNull: ["$estimatedCostUsd", 0] } } } },
    ]),
  ]);

  const completed = completedAgg[0] as { actualSum?: number; estimatedSum?: number } | undefined;
  const pending = pendingAgg[0] as { estimatedSum?: number } | undefined;

  return {
    actual: Number(completed?.actualSum ?? completed?.estimatedSum ?? 0),
    estimatedPending: Number(pending?.estimatedSum ?? 0),
  };
}
