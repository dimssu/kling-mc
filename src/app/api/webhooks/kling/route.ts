import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMotionControlQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getEnv();

  const url = new URL(req.url);
  const generationId = url.searchParams.get("gid");

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  logger.info(
    { generationId, payloadShape: payload && typeof payload === "object" ? Object.keys(payload) : null },
    "Received Kling callback",
  );

  if (!generationId) {
    return NextResponse.json({ ok: true, note: "no gid; ignored" });
  }

  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    select: { id: true, status: true, ownerId: true },
  });
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ ok: true, note: "unknown generation" });
  }

  if (generation.status === "completed" || generation.status === "failed") {
    return NextResponse.json({ ok: true, note: "already terminal" });
  }

  const queue = getMotionControlQueue();
  await queue.add(
    "motion-control",
    { generationId: generation.id },
    { jobId: `webhook-poke-${generation.id}-${Date.now()}` },
  );

  return NextResponse.json({ ok: true });
}
