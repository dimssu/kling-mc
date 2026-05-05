// Load .env.local before anything imports getEnv. tsx watch's hot-reload
// re-runs this file but does NOT re-spawn the outer dotenv-cli wrapper, so
// the env must be loaded inside the worker process itself for reloads to
// continue working.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

import { Worker } from "bullmq";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { MOTION_CONTROL_QUEUE, getRedisConnection, type MotionControlJobData } from "@/lib/queue";
import { handleMotionControlJob } from "./handlers/motion-control";
import { prisma } from "@/lib/db";

async function main() {
  const env = getEnv();
  logger.info(
    {
      queue: MOTION_CONTROL_QUEUE,
      concurrency: env.MAX_CONCURRENT_GENERATIONS,
      kling: env.KLING_BASE_URL,
    },
    "Starting motion-control worker",
  );

  await resumeOrphanedJobs();

  const worker = new Worker<MotionControlJobData>(
    MOTION_CONTROL_QUEUE,
    async (job) => {
      const log = logger.child({ jobId: job.id, generationId: job.data.generationId });
      log.info("Picked up job");
      await handleMotionControlJob(job.data.generationId);
      log.info("Job done");
    },
    {
      connection: getRedisConnection(),
      concurrency: env.MAX_CONCURRENT_GENERATIONS,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, generationId: job?.data?.generationId, err: err.message },
      "Job failed",
    );
  });
  worker.on("error", (err) => logger.error({ err: err.message }, "Worker error"));

  process.on("SIGINT", () => shutdown(worker));
  process.on("SIGTERM", () => shutdown(worker));
}

async function shutdown(worker: Worker): Promise<void> {
  logger.info("Shutting down worker");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

async function resumeOrphanedJobs(): Promise<void> {
  const orphans = await prisma.generation.findMany({
    where: { status: "processing" },
    select: { id: true, providerTaskId: true },
  });
  if (orphans.length === 0) return;
  logger.info({ count: orphans.length }, "Re-enqueuing orphaned in-flight generations");
  const { getMotionControlQueue } = await import("@/lib/queue");
  const queue = getMotionControlQueue();
  for (const o of orphans) {
    await queue.add(
      "motion-control",
      { generationId: o.id },
      { jobId: `resume-${o.id}-${Date.now()}` },
    );
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Worker bootstrap failed");
  process.exit(1);
});
