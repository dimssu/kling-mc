import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "./env";

export const MOTION_CONTROL_QUEUE = "motion-control" as const;
export const IMAGE_GEN_QUEUE = "image-to-image" as const;
export const CAROUSEL_FINALIZE_QUEUE = "carousel-finalize" as const;

export type MotionControlJobData = {
  generationId: string;
};

export type ImageGenerationJobData = {
  imageGenerationId: string;
};

export type CarouselFinalizeJobData = {
  carouselId: string;
};

let _connection: ConnectionOptions | null = null;
export function getRedisConnection(): ConnectionOptions {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = {
    host: new URL(env.REDIS_URL).hostname,
    port: Number(new URL(env.REDIS_URL).port || 6379),
    maxRetriesPerRequest: null,
  };
  return _connection;
}

let _redisClient: IORedis | null = null;
export function getRedisClient(): IORedis {
  if (_redisClient) return _redisClient;
  const env = getEnv();
  _redisClient = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _redisClient;
}

let _motionQueue: Queue<MotionControlJobData> | null = null;
export function getMotionControlQueue(): Queue<MotionControlJobData> {
  if (_motionQueue) return _motionQueue;
  _motionQueue = new Queue<MotionControlJobData>(MOTION_CONTROL_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600 * 24, count: 1000 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });
  return _motionQueue;
}

let _imageGenQueue: Queue<ImageGenerationJobData> | null = null;
export function getImageGenerationQueue(): Queue<ImageGenerationJobData> {
  if (_imageGenQueue) return _imageGenQueue;
  _imageGenQueue = new Queue<ImageGenerationJobData>(IMAGE_GEN_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600 * 24, count: 1000 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });
  return _imageGenQueue;
}

let _carouselFinalizeQueue: Queue<CarouselFinalizeJobData> | null = null;
export function getCarouselFinalizeQueue(): Queue<CarouselFinalizeJobData> {
  if (_carouselFinalizeQueue) return _carouselFinalizeQueue;
  _carouselFinalizeQueue = new Queue<CarouselFinalizeJobData>(
    CAROUSEL_FINALIZE_QUEUE,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600 * 24, count: 500 },
        removeOnFail: { age: 3600 * 24 * 7 },
      },
    },
  );
  return _carouselFinalizeQueue;
}
