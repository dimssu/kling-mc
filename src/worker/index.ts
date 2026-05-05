// Load .env.local before anything imports getEnv. tsx watch's hot-reload
// re-runs this file but does NOT re-spawn the outer dotenv-cli wrapper, so
// the env must be loaded inside the worker process itself for reloads to
// continue working.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

import { Worker } from "bullmq";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  MOTION_CONTROL_QUEUE,
  IMAGE_GEN_QUEUE,
  getMotionControlQueue,
  getImageGenerationQueue,
  getRedisConnection,
  type MotionControlJobData,
  type ImageGenerationJobData,
} from "@/lib/queue";
import { handleMotionControlJob } from "./handlers/motion-control";
import { handleImageGenerationJob } from "./handlers/image-to-image";
import { prisma } from "@/lib/db";

async function main() {
  const env = getEnv();
  logger.info(
    {
      queues: [MOTION_CONTROL_QUEUE, IMAGE_GEN_QUEUE],
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

  const workers = [motionWorker, imageWorker];

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
  for (const w of workers) {
    w.on("error", (err) => logger.error({ err: err.message }, "Worker error"));
  }

  process.on("SIGINT", () => shutdown(workers));
  process.on("SIGTERM", () => shutdown(workers));
}

async function shutdown(workers: Worker[]): Promise<void> {
  logger.info("Shutting down workers");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

async function resumeOrphanedJobs(): Promise<void> {
  const motionOrphans = await prisma.generation.findMany({
    where: { status: "processing" },
    select: { id: true },
  });
  const imageOrphans = await prisma.imageGeneration.findMany({
    where: { status: "processing" },
    select: { id: true },
  });
  if (motionOrphans.length === 0 && imageOrphans.length === 0) return;

  logger.info(
    { motionCount: motionOrphans.length, imageCount: imageOrphans.length },
    "Re-enqueuing orphaned in-flight generations",
  );

  if (motionOrphans.length) {
    const queue = getMotionControlQueue();
    for (const o of motionOrphans) {
      await queue.add(
        "motion-control",
        { generationId: o.id },
        { jobId: `resume-${o.id}-${Date.now()}` },
      );
    }
  }
  if (imageOrphans.length) {
    const queue = getImageGenerationQueue();
    for (const o of imageOrphans) {
      await queue.add(
        "image-to-image",
        { imageGenerationId: o.id },
        { jobId: `resume-img-${o.id}-${Date.now()}` },
      );
    }
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Worker bootstrap failed");
  process.exit(1);
});
