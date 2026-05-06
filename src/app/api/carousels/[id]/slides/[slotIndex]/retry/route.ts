import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; slotIndex: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id, slotIndex } = await ctx.params;
  const slot = Number(slotIndex);
  if (!Number.isFinite(slot) || slot < 0) {
    return NextResponse.json({ error: "Invalid slotIndex" }, { status: 400 });
  }

  const carousel = await prisma.imageCarousel.findUnique({ where: { id } });
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const slide = await prisma.imageGeneration.findFirst({
    where: { carouselId: id, slotIndex: slot },
  });
  if (!slide) {
    return NextResponse.json({ error: "Slide not found" }, { status: 404 });
  }
  if (slide.status !== "failed") {
    return NextResponse.json(
      { error: `Slide is not failed (current: ${slide.status})` },
      { status: 400 },
    );
  }

  const queue = getImageGenerationQueue();
  // Remove any leftover BullMQ entry for this jobId so the re-add isn't a
  // no-op. BullMQ refuses to re-add a job with an existing jobId.
  try {
    await queue.remove(slide.id);
  } catch {
    // Job not present is fine.
  }

  await prisma.imageGeneration.update({
    where: { id: slide.id },
    data: {
      status: "queued",
      errorCode: null,
      errorMessage: null,
      providerTaskId: null,
      submittedAt: null,
      completedAt: null,
    },
  });

  // If the carousel had been written to "partial" or "failed", flip back so
  // the GET endpoint will re-derive on next poll.
  if (carousel.status === "partial" || carousel.status === "failed") {
    await prisma.imageCarousel.update({
      where: { id },
      data: { status: "processing", caption: null, captionTags: [], captionGeneratedAt: null, completedAt: null },
    });
  }

  await queue.add(
    "image-to-image",
    { imageGenerationId: slide.id },
    { jobId: slide.id },
  );

  logger.info({ carouselId: id, slotIndex: slot, slideId: slide.id }, "Slide retry queued");

  return NextResponse.json({ ok: true });
}
