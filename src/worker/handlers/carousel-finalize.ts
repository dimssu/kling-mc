import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateCarouselCaptionPack, isLlmConfigured } from "@/lib/gemini";

export async function handleCarouselFinalizeJob(carouselId: string): Promise<void> {
  const log = logger.child({ carouselId });

  const carousel = await prisma.imageCarousel.findUnique({
    where: { id: carouselId },
    include: {
      slides: {
        orderBy: { slotIndex: "asc" },
      },
    },
  });

  if (!carousel) {
    log.warn("Carousel not found — skipping finalize");
    return;
  }

  if (carousel.caption) {
    log.info("Caption already present — skipping finalize");
    return;
  }

  // Caption pack only makes sense once every slide is terminal. If anything
  // is still in flight, bail; the GET route will re-enqueue when it flips.
  const terminal = carousel.slides.every(
    (s) => s.status === "completed" || s.status === "failed",
  );
  if (!terminal) {
    log.info("Slides not all terminal — skipping finalize");
    return;
  }

  const completedSlides = carousel.slides.filter((s) => s.status === "completed");
  if (completedSlides.length === 0) {
    log.info("No completed slides — marking carousel failed");
    await prisma.imageCarousel.update({
      where: { id: carouselId },
      data: { status: "failed", completedAt: new Date() },
    });
    return;
  }

  if (!isLlmConfigured()) {
    log.warn("LLM not configured — marking carousel complete without caption");
    await prisma.imageCarousel.update({
      where: { id: carouselId },
      data: {
        status: completedSlides.length === carousel.slides.length ? "completed" : "partial",
        completedAt: new Date(),
      },
    });
    return;
  }

  log.info({ slideCount: completedSlides.length }, "Generating unified carousel caption");
  try {
    const pack = await generateCarouselCaptionPack({
      themePrompt: carousel.themePrompt,
      vibeLabel: carousel.vibeLabel,
      slidePrompts: completedSlides
        .map((s) => s.prompt ?? "")
        .filter((p) => p.length > 0),
      facts: { aspectRatio: carousel.aspectRatio, n: carousel.n },
    });

    await prisma.imageCarousel.update({
      where: { id: carouselId },
      data: {
        caption: pack.caption,
        captionTags: pack.tags,
        captionLocation: pack.location,
        captionAccessibility: pack.accessibilityText,
        captionGeneratedAt: new Date(),
        status: completedSlides.length === carousel.slides.length ? "completed" : "partial",
        completedAt: new Date(),
      },
    });
    log.info("Carousel caption pack saved");
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Carousel caption generation failed (non-fatal)",
    );
    // Still mark the carousel terminal so the UI doesn't spin forever.
    await prisma.imageCarousel.update({
      where: { id: carouselId },
      data: {
        status: completedSlides.length === carousel.slides.length ? "completed" : "partial",
        completedAt: new Date(),
      },
    });
  }
}
