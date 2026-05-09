import type { Logger } from "pino";
import { connectMongo } from "@/lib/mongo";
import { Generation, MediaAsset } from "@/models";
import { logger } from "@/lib/logger";
import { getKlingProvider } from "@/lib/kling";
import { KlingApiError } from "@/lib/kling/errors";
import { deductionToUsd, type KlingMode, type KlingModel } from "@/lib/kling/pricing";
import {
  downloadToBuffer,
  getKlingFetchUrl,
  getPublicUrl,
  makeOutputKey,
  uploadObject,
} from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";
import { getEnv } from "@/lib/env";
import { signGid } from "@/lib/webhook-auth";
import { generateCaptionPack, isLlmConfigured } from "@/lib/gemini";
import { computeAssetHashes } from "@/lib/asset-hash";

const POLL_PHASES: Array<{ untilSec: number; intervalMs: number }> = [
  { untilSec: 60, intervalMs: 5_000 },
  { untilSec: 5 * 60, intervalMs: 15_000 },
  { untilSec: 20 * 60, intervalMs: 30_000 },
];

const HARD_TIMEOUT_MS = 20 * 60 * 1000;

export async function handleMotionControlJob(generationId: string): Promise<void> {
  await connectMongo();
  const log = logger.child({ generationId });
  const generation = await Generation.findById(generationId).lean();
  if (!generation) {
    throw new Error(`Generation ${generationId} not found`);
  }

  if (generation.status === "completed" || generation.status === "failed") {
    log.info({ status: generation.status }, "Skipping job — already terminal");
    return;
  }

  const [sourceVideo, referenceImage] = await Promise.all([
    MediaAsset.findById(generation.sourceVideoId).lean(),
    MediaAsset.findById(generation.referenceImageId).lean(),
  ]);
  if (!sourceVideo || !referenceImage) {
    throw new Error(`Missing source/reference asset for generation ${generationId}`);
  }

  const env = getEnv();
  const provider = getKlingProvider();

  let providerTaskId = generation.providerTaskId;

  if (!providerTaskId) {
    const sourceUrl = getKlingFetchUrl(sourceVideo.storageKey);
    const referenceUrl = getKlingFetchUrl(referenceImage.storageKey);
    log.info({ sourceUrl, referenceUrl }, "Resolved fetch URLs for Kling");

    const callbackUrl =
      env.ENABLE_KLING_WEBHOOKS && env.WEBHOOK_SECRET
        ? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/kling?gid=${encodeURIComponent(
            generation._id,
          )}&sig=${signGid(generation._id)}`
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
      await Generation.updateOne(
        { _id: generation._id },
        {
          $set: {
            providerTaskId,
            status: "processing",
            submittedAt: new Date(),
          },
        },
      );
      log.info({ providerTaskId }, "Kling task created");
    } catch (err) {
      const retryable = err instanceof KlingApiError && err.retryable;
      if (!retryable) {
        await markFailed(generation._id, err);
        return;
      }
      throw err;
    }
  }

  await pollUntilTerminal(generation._id, providerTaskId, log);
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
      return;
    }

    if (result.status === "succeed") {
      await finalizeSuccess(generationId, result, log);
      return;
    }

    if (result.status === "failed") {
      await Generation.updateOne(
        { _id: generationId },
        {
          $set: {
            status: "failed",
            errorMessage: result.statusMessage ?? "Generation failed",
            completedAt: new Date(),
            rawProviderPayload: result.rawPayload ?? null,
          },
        },
      );
      log.warn({ statusMessage: result.statusMessage }, "Kling reported failure");
      return;
    }

    await sleep(phase.intervalMs);
  }

  await Generation.updateOne(
    { _id: generationId },
    {
      $set: {
        status: "failed",
        errorMessage: "Polling timeout exceeded (20 minutes)",
        completedAt: new Date(),
      },
    },
  );
  log.error("Polling timed out");
}

async function finalizeSuccess(
  generationId: string,
  result: Awaited<ReturnType<ReturnType<typeof getKlingProvider>["getMotionControlTask"]>>,
  log: Logger,
): Promise<void> {
  if (!result.videoUrl) {
    await Generation.updateOne(
      { _id: generationId },
      {
        $set: {
          status: "failed",
          errorMessage: "Provider returned succeed without a video URL",
          completedAt: new Date(),
          rawProviderPayload: result.rawPayload ?? null,
        },
      },
    );
    return;
  }

  const generation = await Generation.findById(generationId).lean();
  if (!generation) return;

  // Race-dedup: if another worker already finalized this generation, bail before
  // we re-download + re-upload.
  if (generation.status === "completed") {
    log.info("Already completed by another worker — skipping finalize");
    return;
  }

  log.info({ videoUrl: result.videoUrl }, "Downloading generated video");
  const { buffer, contentType } = await downloadToBuffer(result.videoUrl);

  const ext = guessVideoExt(contentType);
  const storageKey = makeOutputKey(generation.ownerId, generation._id, ext);
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

  const probedDuration = Number.isFinite(probe.durationSec ?? NaN)
    ? probe.durationSec
    : null;
  const finalDuration =
    probedDuration ??
    (Number.isFinite(result.videoDurationSec ?? NaN) ? result.videoDurationSec : null);

  const actualCostUsd = deductionToUsd(
    generation.modelName as KlingModel,
    generation.mode as KlingMode,
    result.finalUnitDeduction,
    finalDuration ?? 5,
  );

  // Hash on the way in so future uploads can be dedupe-checked against
  // generated content too (videos: SHA only — sharp can't decode video).
  const hashes = await computeAssetHashes(buffer, contentType);

  // Atomic conditional update: only the worker that flips status from
  // non-completed to completed wins. If we lose, delete the orphan asset.
  const outputAsset = await MediaAsset.create({
    ownerId: generation.ownerId,
    kind: "generated_video",
    filename: `${generation._id}.${ext}`,
    mimeType: contentType,
    sizeBytes: buffer.length,
    durationSec: finalDuration,
    width: probe.width,
    height: probe.height,
    storageKey,
    contentHash: hashes.contentHash,
    perceptualHash: hashes.perceptualHash,
  });

  const won = await Generation.updateOne(
    { _id: generationId, status: { $ne: "completed" } },
    {
      $set: {
        status: "completed",
        outputAssetId: String(outputAsset._id),
        completedAt: new Date(),
        finalUnitDeduction: result.finalUnitDeduction,
        actualCostUsd: actualCostUsd ?? null,
        rawProviderPayload: result.rawPayload ?? null,
      },
    },
  );

  if (won.matchedCount === 0) {
    log.info("Lost finalize race; rolling back orphan asset");
    await MediaAsset.deleteOne({ _id: outputAsset._id });
    return;
  }

  log.info({ publicUrl: getPublicUrl(storageKey) }, "Generation completed");

  // Caption pack: post-finalize, never fatal.
  if (generation.captionPackEnabled && isLlmConfigured()) {
    try {
      log.info("Generating caption pack");
      const pack = await generateCaptionPack({
        mediaKind: "video",
        prompt: generation.prompt,
        facts: { durationSec: finalDuration },
      });
      await Generation.updateOne(
        { _id: generationId },
        {
          $set: {
            caption: pack.caption,
            captionTags: pack.tags,
            captionLocation: pack.location,
            captionAccessibility: pack.accessibilityText,
            captionPackGeneratedAt: new Date(),
          },
        },
      );
      log.info("Caption pack saved");
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Caption pack generation failed (non-fatal)",
      );
    }
  }
}

async function markFailed(generationId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof KlingApiError ? err.code : null;
  await Generation.updateOne(
    { _id: generationId },
    {
      $set: {
        status: "failed",
        errorMessage: message,
        errorCode: code,
        completedAt: new Date(),
      },
    },
  );
}

function guessVideoExt(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime") || contentType.includes("mov")) return "mov";
  if (contentType.includes("webm")) return "webm";
  return "mp4";
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
