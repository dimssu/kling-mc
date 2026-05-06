import { connectMongo } from "@/lib/mongo";
import { ImageCarousel, ImageGeneration } from "@/models";
import { logger } from "@/lib/logger";
import { generateCarouselCaptionPack, isLlmConfigured } from "@/lib/gemini";

export async function handleCarouselFinalizeJob(carouselId: string): Promise<void> {
  await connectMongo();
  const log = logger.child({ carouselId });

  const carousel = await ImageCarousel.findById(carouselId).lean();
  if (!carousel) {
    log.warn("Carousel not found — skipping finalize");
    return;
  }

  if (carousel.caption) {
    log.info("Caption already present — skipping finalize");
    return;
  }

  const slides = await ImageGeneration.find({ carouselId })
    .sort({ slotIndex: 1 })
    .lean();

  // Caption pack only makes sense once every slide is terminal.
  const terminal = slides.every(
    (s) => s.status === "completed" || s.status === "failed",
  );
  if (!terminal) {
    log.info("Slides not all terminal — skipping finalize");
    return;
  }

  const completedSlides = slides.filter((s) => s.status === "completed");
  if (completedSlides.length === 0) {
    log.info("No completed slides — marking carousel failed");
    await ImageCarousel.updateOne(
      { _id: carouselId },
      { $set: { status: "failed", completedAt: new Date() } },
    );
    return;
  }

  const finalStatus =
    completedSlides.length === slides.length ? "completed" : "partial";

  if (!isLlmConfigured()) {
    log.warn("LLM not configured — marking carousel complete without caption");
    await ImageCarousel.updateOne(
      { _id: carouselId },
      { $set: { status: finalStatus, completedAt: new Date() } },
    );
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

    await ImageCarousel.updateOne(
      { _id: carouselId },
      {
        $set: {
          caption: pack.caption,
          captionTags: pack.tags,
          captionLocation: pack.location,
          captionAccessibility: pack.accessibilityText,
          captionGeneratedAt: new Date(),
          status: finalStatus,
          completedAt: new Date(),
        },
      },
    );
    log.info("Carousel caption pack saved");
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Carousel caption generation failed (non-fatal)",
    );
    await ImageCarousel.updateOne(
      { _id: carouselId },
      { $set: { status: finalStatus, completedAt: new Date() } },
    );
  }
}
