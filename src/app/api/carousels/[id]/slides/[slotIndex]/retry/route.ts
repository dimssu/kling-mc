import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ImageCarousel, ImageGeneration } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getImageGenerationQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; slotIndex: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id, slotIndex } = await ctx.params;
  const slot = Number(slotIndex);
  if (!Number.isFinite(slot) || slot < 0) {
    return NextResponse.json({ error: "Invalid slotIndex" }, { status: 400 });
  }

  const carousel = await ImageCarousel.findById(id).lean();
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const slide = await ImageGeneration.findOne({ carouselId: id, slotIndex: slot }).lean();
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
  // Remove any leftover BullMQ entry for this jobId so the re-add isn't a no-op.
  try {
    await queue.remove(String(slide._id));
  } catch {
    // Job not present is fine.
  }

  await ImageGeneration.updateOne(
    { _id: slide._id },
    {
      $set: {
        status: "queued",
        errorCode: null,
        errorMessage: null,
        providerTaskId: null,
        submittedAt: null,
        completedAt: null,
      },
    },
  );

  if (carousel.status === "partial" || carousel.status === "failed") {
    await ImageCarousel.updateOne(
      { _id: id },
      {
        $set: {
          status: "processing",
          caption: null,
          captionTags: [],
          captionGeneratedAt: null,
          completedAt: null,
        },
      },
    );
  }

  await queue.add(
    "image-to-image",
    { imageGenerationId: String(slide._id) },
    { jobId: String(slide._id) },
  );

  logger.info(
    { carouselId: id, slotIndex: slot, slideId: String(slide._id) },
    "Slide retry queued",
  );

  return NextResponse.json({ ok: true });
}
