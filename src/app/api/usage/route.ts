import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { pricingTable } from "@/lib/kling/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
    prisma.generation.groupBy({
      by: ["status"],
      where: { ownerId },
      _count: { _all: true },
    }),
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
      statusBreakdown.map((b: { status: string; _count: { _all: number } }) => [
        b.status,
        b._count._all,
      ]),
    ) as Record<string, number>,
    pricingTable: pricingTable(),
  });
}

async function sumCost(ownerId: string, sinceDate: Date | null) {
  const completed = await prisma.generation.aggregate({
    where: {
      ownerId,
      status: "completed",
      ...(sinceDate ? { completedAt: { gte: sinceDate } } : {}),
    },
    _sum: { actualCostUsd: true, estimatedCostUsd: true },
  });
  const pending = await prisma.generation.aggregate({
    where: {
      ownerId,
      status: { in: ["queued", "processing"] },
      ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
    },
    _sum: { estimatedCostUsd: true },
  });

  return {
    actual: Number(completed._sum.actualCostUsd ?? completed._sum.estimatedCostUsd ?? 0),
    estimatedPending: Number(pending._sum.estimatedCostUsd ?? 0),
  };
}
