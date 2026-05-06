// Load .env.local before anything imports getEnv. tsx watch's hot-reload
// re-runs this file but does NOT re-spawn the outer dotenv-cli wrapper, so
// the env must be loaded inside the worker process itself for reloads to
// continue working.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

import { Worker } from "bullmq";
import mongoose from "mongoose";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  MOTION_CONTROL_QUEUE,
  IMAGE_GEN_QUEUE,
  CAROUSEL_FINALIZE_QUEUE,
  getMotionControlQueue,
  getImageGenerationQueue,
  getRedisConnection,
  type MotionControlJobData,
  type ImageGenerationJobData,
  type CarouselFinalizeJobData,
} from "@/lib/queue";
import { connectMongo } from "@/lib/mongo";
import { Generation, ImageGeneration } from "@/models";
import { handleMotionControlJob } from "./handlers/motion-control";
import { handleImageGenerationJob } from "./handlers/image-to-image";
import { handleCarouselFinalizeJob } from "./handlers/carousel-finalize";

async function main() {
  const env = getEnv();
  await connectMongo();
  logger.info(
    {
      queues: [MOTION_CONTROL_QUEUE, IMAGE_GEN_QUEUE, CAROUSEL_FINALIZE_QUEUE],
      concurrency: env.MAX_CONCURRENT_GENERATIONS,
      kling: env.KLING_BASE_URL,
    },
    "Starting Kling workers",
  );

  await resumeOrphanedJobs();

  const motionWorker = new Worker<MotionControlJobData>(
    MOTION_CONTROL_QUEUE,
    async (job) => {
      const log = logger.child({ jobId: job.id, generationId: job.data.generationId });
      log.info("Picked up motion-control job");
      await handleMotionControlJob(job.data.generationId);
      log.info("Motion-control job done");
    },
    { connection: getRedisConnection(), concurrency: env.MAX_CONCURRENT_GENERATIONS },
  );

  const imageWorker = new Worker<ImageGenerationJobData>(
    IMAGE_GEN_QUEUE,
    async (job) => {
      const log = logger.child({
        jobId: job.id,
        imageGenerationId: job.data.imageGenerationId,
      });
      log.info("Picked up image-generation job");
      await handleImageGenerationJob(job.data.imageGenerationId);
      log.info("Image-generation job done");
    },
    { connection: getRedisConnection(), concurrency: env.MAX_CONCURRENT_GENERATIONS },
  );

  const carouselFinalizeWorker = new Worker<CarouselFinalizeJobData>(
    CAROUSEL_FINALIZE_QUEUE,
    async (job) => {
      const log = logger.child({ jobId: job.id, carouselId: job.data.carouselId });
      log.info("Picked up carousel-finalize job");
      await handleCarouselFinalizeJob(job.data.carouselId);
      log.info("Carousel-finalize job done");
    },
    { connection: getRedisConnection(), concurrency: 2 },
  );

  const workers = [motionWorker, imageWorker, carouselFinalizeWorker];

  motionWorker.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, generationId: job?.data?.generationId, err: err.message },
      "Motion-control job failed",
    ),
  );
  imageWorker.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, imageGenerationId: job?.data?.imageGenerationId, err: err.message },
      "Image-generation job failed",
    ),
  );
  carouselFinalizeWorker.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, carouselId: job?.data?.carouselId, err: err.message },
      "Carousel-finalize job failed",
    ),
  );
  for (const w of workers) {
    w.on("error", (err) => logger.error({ err: err.message }, "Worker error"));
  }

  process.on("SIGINT", () => shutdown(workers));
  process.on("SIGTERM", () => shutdown(workers));
}

async function shutdown(workers: Worker[]): Promise<void> {
  logger.info("Shutting down workers");
  await Promise.all(workers.map((w) => w.close()));
  await mongoose.disconnect();
  process.exit(0);
}

async function resumeOrphanedJobs(): Promise<void> {
  const [motionOrphans, imageOrphans] = await Promise.all([
    Generation.find({ status: "processing" }).select({ _id: 1 }).lean(),
    ImageGeneration.find({ status: "processing" }).select({ _id: 1 }).lean(),
  ]);
  if (motionOrphans.length === 0 && imageOrphans.length === 0) return;

  logger.info(
    { motionCount: motionOrphans.length, imageCount: imageOrphans.length },
    "Re-enqueuing orphaned in-flight generations",
  );

  if (motionOrphans.length) {
    const queue = getMotionControlQueue();
    for (const o of motionOrphans) {
      const id = String(o._id);
      await queue.add(
        "motion-control",
        { generationId: id },
        { jobId: `resume-${id}-${Date.now()}` },
      );
    }
  }
  if (imageOrphans.length) {
    const queue = getImageGenerationQueue();
    for (const o of imageOrphans) {
      const id = String(o._id);
      await queue.add(
        "image-to-image",
        { imageGenerationId: id },
        { jobId: `resume-img-${id}-${Date.now()}` },
      );
    }
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Worker bootstrap failed");
  process.exit(1);
});
