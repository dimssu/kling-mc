import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getCarouselFinalizeQueue } from "@/lib/queue";
import { deleteObject } from "@/lib/storage";

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
  const env = getEnv();
  const { id } = await ctx.params;

  const carousel = await prisma.imageCarousel.findUnique({
    where: { id },
    include: {
      slides: {
        orderBy: { slotIndex: "asc" },
        include: { outputAsset: true },
      },
    },
  });
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve the subject MediaAsset for the UI (parent-level reference). Same
  // pattern as ImageGeneration's subjectImageIds — stored as plain string,
  // resolved on read.
  const subjectImage = await prisma.mediaAsset.findUnique({
    where: { id: carousel.subjectImageId },
  });

  const derived = deriveStatus(carousel.slides.map((s) => s.status));

  // Persist the derived status idempotently so list views don't have to
  // re-derive. Skip the write if it's already in sync.
  let nextCarousel = carousel;
  if (derived !== carousel.status) {
    nextCarousel = await prisma.imageCarousel.update({
      where: { id: carousel.id },
      data: { status: derived },
      include: {
        slides: {
          orderBy: { slotIndex: "asc" },
          include: { outputAsset: true },
        },
      },
    });
  }

  // Trigger the unified caption job once all slides reach a terminal state
  // and we don't yet have a caption. The handler is idempotent.
  const allTerminal =
    nextCarousel.slides.length > 0 &&
    nextCarousel.slides.every(
      (s) => s.status === "completed" || s.status === "failed",
    );
  const anyCompleted = nextCarousel.slides.some((s) => s.status === "completed");
  if (allTerminal && anyCompleted && !nextCarousel.caption) {
    try {
      const queue = getCarouselFinalizeQueue();
      await queue.add(
        "carousel-finalize",
        { carouselId: nextCarousel.id },
        // Stable jobId so repeated GETs don't fan out duplicate finalize jobs.
        { jobId: `finalize-${nextCarousel.id}` },
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, carouselId: nextCarousel.id },
        "Failed to enqueue carousel-finalize (non-fatal — next GET will retry)",
      );
    }
  }

  return NextResponse.json({ carousel: { ...nextCarousel, subjectImage } });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const env = getEnv();
  const { id } = await ctx.params;

  const carousel = await prisma.imageCarousel.findUnique({
    where: { id },
    include: {
      slides: { include: { outputAsset: true } },
    },
  });
  if (!carousel || carousel.ownerId !== env.DEFAULT_USER_ID) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Collect output assets before delete; ImageGeneration has @relation
  // onDelete: Cascade from the carousel side, so children disappear with the
  // parent, but their output MediaAssets are linked via outputAssetId (no
  // cascade) and need explicit cleanup.
  const outputs = carousel.slides
    .map((s) => s.outputAsset)
    .filter((a): a is NonNullable<typeof a> => !!a);

  await prisma.$transaction(async (tx) => {
    await tx.imageCarousel.delete({ where: { id } });
    if (outputs.length) {
      await tx.mediaAsset.deleteMany({
        where: { id: { in: outputs.map((a) => a.id) } },
      });
    }
  });

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
