import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { generateCaptionPack, isLlmConfigured } from "@/lib/gemini";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const env = getEnv();
  const { id } = await ctx.params;
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { outputAsset: true },
  });
  if (!generation || generation.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (generation.status !== "completed") {
    return NextResponse.json(
      { error: "Caption pack is only available for completed generations." },
      { status: 400 },
    );
  }

  try {
    const pack = await generateCaptionPack({
      mediaKind: "video",
      prompt: generation.prompt,
      facts: { durationSec: generation.outputAsset?.durationSec ?? null },
    });
    const updated = await prisma.generation.update({
      where: { id },
      data: {
        captionPackEnabled: true,
        caption: pack.caption,
        captionTags: pack.tags,
        captionLocation: pack.location,
        captionAccessibility: pack.accessibilityText,
        captionPackGeneratedAt: new Date(),
      },
    });
    return NextResponse.json({ generation: updated });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Caption pack regeneration failed",
    );
    return NextResponse.json(
      { error: "Caption pack generation failed: " + (err instanceof Error ? err.message : "unknown") },
      { status: 502 },
    );
  }
}
