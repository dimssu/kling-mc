import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ImageCarousel, ImageGeneration, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getCarouselFinalizeQueue } from "@/lib/queue";
import { deleteObject } from "@/lib/storage";
import { toApi } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type SlideStatus = "queued" | "processing" | "completed" | "failed" | string;

function deriveStatus(slideStatuses: SlideStatus[]): string {
  if (slideStatuses.length === 0) return "queued";
  const completed = slideStatuses.filter((s) => s === "completed").length;
  const failed = slideStatuses.filter((s) => s === "failed").length;
  const total = slideStatuses.length;
  if (completed === total) return "completed";
  if (failed === total) return "failed";
  if (completed + failed === total) return "partial";
  if (slideStatuses.some((s) => s === "processing")) return "processing";
  return "queued";
}

export async function GET(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;

  const carousel = await ImageCarousel.findById(id).lean();
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const slides = await ImageGeneration.find({ carouselId: id })
    .sort({ slotIndex: 1 })
    .lean();
  const outputIds = slides.map((s) => s.outputAssetId).filter((x): x is string => !!x);
  const outputs = outputIds.length
    ? await MediaAsset.find({ _id: { $in: outputIds } }).lean()
    : [];
  const outputMap = new Map(outputs.map((a) => [String(a._id), a]));

  const subjectImage = await MediaAsset.findById(carousel.subjectImageId).lean();

  const derived = deriveStatus(slides.map((s) => s.status));

  // Persist the derived status idempotently so list views don't have to re-derive.
  let nextCarousel = carousel;
  if (derived !== carousel.status) {
    nextCarousel = (await ImageCarousel.findByIdAndUpdate(
      id,
      { $set: { status: derived } },
      { new: true, lean: true },
    ))!;
  }

  // Trigger the unified caption job once all slides reach a terminal state.
  const allTerminal =
    slides.length > 0 && slides.every((s) => s.status === "completed" || s.status === "failed");
  const anyCompleted = slides.some((s) => s.status === "completed");
  if (allTerminal && anyCompleted && !nextCarousel.caption) {
    try {
      const queue = getCarouselFinalizeQueue();
      await queue.add(
        "carousel-finalize",
        { carouselId: id },
        { jobId: `finalize-${id}` },
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, carouselId: id },
        "Failed to enqueue carousel-finalize (non-fatal — next GET will retry)",
      );
    }
  }

  const enrichedSlides = slides.map((s) => ({
    ...s,
    outputAsset: s.outputAssetId ? (outputMap.get(s.outputAssetId) ?? null) : null,
  }));

  return NextResponse.json({
    carousel: toApi({
      ...nextCarousel,
      slides: enrichedSlides,
      subjectImage,
    }),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await connectMongo();
  const env = getEnv();
  const { id } = await ctx.params;

  const carousel = await ImageCarousel.findById(id).lean();
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const slides = await ImageGeneration.find({ carouselId: id }).lean();
  const outputIds = slides.map((s) => s.outputAssetId).filter((x): x is string => !!x);
  const outputs = outputIds.length
    ? await MediaAsset.find({ _id: { $in: outputIds } }).lean()
    : [];

  // Delete carousel + all child slides + all output media assets.
  await ImageCarousel.deleteOne({ _id: id });
  await ImageGeneration.deleteMany({ carouselId: id });
  if (outputIds.length) {
    await MediaAsset.deleteMany({ _id: { $in: outputIds } });
  }

  for (const a of outputs) {
    try {
      await deleteObject(a.storageKey);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, storageKey: a.storageKey },
        "Output object delete failed after carousel delete — manual cleanup required",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
