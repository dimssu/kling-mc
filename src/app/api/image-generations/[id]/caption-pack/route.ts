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
  const imageGen = await prisma.imageGeneration.findUnique({ where: { id } });
  if (!imageGen || imageGen.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (imageGen.status !== "completed") {
    return NextResponse.json(
      { error: "Caption pack is only available for completed generations." },
      { status: 400 },
    );
  }

  try {
    const pack = await generateCaptionPack({
      mediaKind: "image",
      prompt: imageGen.prompt,
      facts: { aspectRatio: imageGen.aspectRatio },
    });
    const updated = await prisma.imageGeneration.update({
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
    return NextResponse.json({ imageGeneration: updated });
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
