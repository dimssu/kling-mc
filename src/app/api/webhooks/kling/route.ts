import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Generation } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMotionControlQueue } from "@/lib/queue";
import { verifyGid } from "@/lib/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const env = getEnv();
  if (!env.WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Webhooks not configured (WEBHOOK_SECRET unset)" },
      { status: 503 },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  const url = new URL(req.url);
  const generationId = url.searchParams.get("gid");
  const sig = url.searchParams.get("sig");

  if (!generationId || !verifyGid(generationId, sig)) {
    logger.warn(
      { generationId: generationId ? "<redacted>" : null, hasSig: !!sig },
      "Webhook rejected: bad signature",
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  logger.info(
    {
      generationId,
      payloadShape:
        payload && typeof payload === "object" ? Object.keys(payload) : null,
    },
    "Received Kling callback",
  );

  await connectMongo();
  const generation = await Generation.findById(generationId)
    .select({ _id: 1, status: 1, ownerId: 1 })
    .lean();
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ ok: true, note: "unknown generation" });
  }

  if (generation.status === "completed" || generation.status === "failed") {
    return NextResponse.json({ ok: true, note: "already terminal" });
  }

  const queue = getMotionControlQueue();
  await queue.add(
    "motion-control",
    { generationId: String(generation._id) },
    { jobId: `webhook-poke-${String(generation._id)}-${Date.now()}` },
  );

  return NextResponse.json({ ok: true });
}
