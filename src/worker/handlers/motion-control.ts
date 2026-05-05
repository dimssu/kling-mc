import { extname } from "node:path";
import type { Logger } from "pino";
import { Decimal, type InputJsonValue } from "@/generated/prisma/runtime/library";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getKlingProvider } from "@/lib/kling";
import { KlingApiError } from "@/lib/kling/errors";
import { deductionToUsd, type KlingMode, type KlingModel } from "@/lib/kling/pricing";
import {
  downloadToBuffer,
  getPresignedDownloadUrl,
  getPublicUrl,
  uploadObject,
} from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";
import { getEnv } from "@/lib/env";

const POLL_PHASES: Array<{ untilSec: number; intervalMs: number }> = [
  { untilSec: 60, intervalMs: 5_000 },
  { untilSec: 5 * 60, intervalMs: 15_000 },
  { untilSec: 20 * 60, intervalMs: 30_000 },
];

const HARD_TIMEOUT_MS = 20 * 60 * 1000;

export async function handleMotionControlJob(generationId: string): Promise<void> {
  const log = logger.child({ generationId });
  const generation = await prisma.generation.findUniqueOrThrow({
    where: { id: generationId },
    include: { sourceVideo: true, referenceImage: true },
  });

  if (generation.status === "completed" || generation.status === "failed") {
    log.info({ status: generation.status }, "Skipping job — already terminal");
    return;
  }

  const env = getEnv();
  const provider = getKlingProvider();

  let providerTaskId = generation.providerTaskId;

  if (!providerTaskId) {
    const sourceUrl = await getPresignedDownloadUrl(generation.sourceVideo.storageKey, 3600);
    const referenceUrl = await getPresignedDownloadUrl(
      generation.referenceImage.storageKey,
      3600,
    );

    const callbackUrl = env.ENABLE_KLING_WEBHOOKS
      ? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/kling?gid=${encodeURIComponent(generation.id)}`
      : undefined;

    log.info("Creating Kling task");
    try {
      const result = await provider.createMotionControlTask({
        modelName: generation.modelName as KlingModel,
        mode: generation.mode as KlingMode,
        characterOrientation: generation.characterOrientation as "image" | "video",
        imageUrl: referenceUrl,
        videoUrl: sourceUrl,
        prompt: generation.prompt ?? undefined,
        keepOriginalSound: generation.keepOriginalSound,
        watermarkEnabled: generation.watermarkEnabled,
        callbackUrl,
        externalTaskId: generation.externalTaskId,
      });

      providerTaskId = result.providerTaskId;
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          providerTaskId,
          status: "processing",
          submittedAt: new Date(),
        },
      });
      log.info({ providerTaskId }, "Kling task created");
    } catch (err) {
      await markFailed(generation.id, err);
      throw err;
    }
  }

  await pollUntilTerminal(generation.id, providerTaskId, log);
}

async function pollUntilTerminal(
  generationId: string,
  providerTaskId: string,
  log: Logger,
): Promise<void> {
  const startedAt = Date.now();
  const provider = getKlingProvider();

  while (Date.now() - startedAt < HARD_TIMEOUT_MS) {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    const phase = POLL_PHASES.find((p) => elapsedSec < p.untilSec) ?? POLL_PHASES[POLL_PHASES.length - 1];

    let result;
    try {
      result = await provider.getMotionControlTask(providerTaskId);
    } catch (err) {
      if (err instanceof KlingApiError && err.retryable) {
        log.warn({ err: err.message, code: err.code }, "Retryable poll error, sleeping");
        await sleep(phase.intervalMs);
        continue;
      }
      await markFailed(generationId, err);
      throw err;
    }

    if (result.status === "succeed") {
      await finalizeSuccess(generationId, result, log);
      return;
    }

    if (result.status === "failed") {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "failed",
          errorMessage: result.statusMessage ?? "Generation failed",
          completedAt: new Date(),
          rawProviderPayload: toJsonValue(result.rawPayload),
        },
      });
      log.warn({ statusMessage: result.statusMessage }, "Kling reported failure");
      return;
    }

    await sleep(phase.intervalMs);
  }

  await prisma.generation.update({
    where: { id: generationId },
    data: {
      status: "failed",
      errorMessage: "Polling timeout exceeded (20 minutes)",
      completedAt: new Date(),
    },
  });
  log.error("Polling timed out");
}

async function finalizeSuccess(
  generationId: string,
  result: Awaited<ReturnType<ReturnType<typeof getKlingProvider>["getMotionControlTask"]>>,
  log: Logger,
): Promise<void> {
  if (!result.videoUrl) {
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: "Provider returned succeed without a video URL",
        completedAt: new Date(),
        rawProviderPayload: toJsonValue(result.rawPayload),
      },
    });
    return;
  }

  const generation = await prisma.generation.findUniqueOrThrow({
    where: { id: generationId },
  });

  log.info({ videoUrl: result.videoUrl }, "Downloading generated video");
  const { buffer, contentType } = await downloadToBuffer(result.videoUrl);

  const ext = guessVideoExt(contentType);
  const storageKey = `generations/${generation.ownerId}/${generation.id}.${ext}`;
  await uploadObject({
    key: storageKey,
    body: buffer,
    contentType,
    contentLength: buffer.length,
  });

  const probe = await probeMedia(buffer, ext).catch(() => ({
    width: null,
    height: null,
    durationSec: result.videoDurationSec,
  }));

  const outputAsset = await prisma.mediaAsset.create({
    data: {
      ownerId: generation.ownerId,
      kind: "generated_video",
      filename: `${generation.id}.${ext}`,
      mimeType: contentType,
      sizeBytes: buffer.length,
      durationSec: probe.durationSec ?? result.videoDurationSec,
      width: probe.width,
      height: probe.height,
      storageKey,
    },
  });

  const actualCostUsd = deductionToUsd(
    generation.modelName as KlingModel,
    generation.mode as KlingMode,
    result.finalUnitDeduction,
    probe.durationSec ?? result.videoDurationSec ?? 5,
  );

  await prisma.generation.update({
    where: { id: generationId },
    data: {
      status: "completed",
      outputAssetId: outputAsset.id,
      completedAt: new Date(),
      finalUnitDeduction: result.finalUnitDeduction,
      actualCostUsd: actualCostUsd != null ? new Decimal(actualCostUsd) : null,
      rawProviderPayload: toJsonValue(result.rawPayload),
    },
  });

  log.info({ outputAssetId: outputAsset.id, publicUrl: getPublicUrl(storageKey) }, "Generation completed");
}

async function markFailed(generationId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof KlingApiError ? err.code : null;
  await prisma.generation.update({
    where: { id: generationId },
    data: {
      status: "failed",
      errorMessage: message,
      errorCode: code,
      completedAt: new Date(),
    },
  });
}

function guessVideoExt(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime") || contentType.includes("mov")) return "mov";
  if (contentType.includes("webm")) return "webm";
  return "mp4";
}

function toJsonValue(v: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as InputJsonValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export { extname };
