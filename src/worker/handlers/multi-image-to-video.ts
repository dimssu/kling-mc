import type { Logger } from "pino";
import { connectMongo } from "@/lib/mongo";
import { VideoGeneration, MediaAsset } from "@/models";
import { logger } from "@/lib/logger";
import { getKlingProvider } from "@/lib/kling";
import { KlingApiError } from "@/lib/kling/errors";
import {
  image2VideoDeductionToUsd,
  multiImage2VideoDeductionToUsd,
} from "@/lib/kling/pricing";
import type {
  KlingImage2VideoDuration,
  KlingImage2VideoMode,
  KlingImage2VideoModel,
  KlingMultiImage2VideoDuration,
  KlingMultiImage2VideoMode,
  KlingMultiImage2VideoModel,
  KlingVideoAspectRatio,
} from "@/lib/kling/types";
import {
  downloadToBuffer,
  getKlingFetchUrl,
  getPublicUrl,
  makeOutputKey,
  uploadObject,
} from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";
import { generateCaptionPack, isLlmConfigured } from "@/lib/gemini";
import { computeAssetHashes } from "@/lib/asset-hash";

const POLL_PHASES: Array<{ untilSec: number; intervalMs: number }> = [
  { untilSec: 60, intervalMs: 5_000 },
  { untilSec: 5 * 60, intervalMs: 15_000 },
  { untilSec: 20 * 60, intervalMs: 30_000 },
];

const HARD_TIMEOUT_MS = 20 * 60 * 1000;

export async function handleMultiImageVideoJob(videoGenerationId: string): Promise<void> {
  await connectMongo();
  const log = logger.child({ videoGenerationId });
  const videoGen = await VideoGeneration.findById(videoGenerationId).lean();
  if (!videoGen) throw new Error(`VideoGeneration ${videoGenerationId} not found`);

  if (videoGen.status === "completed" || videoGen.status === "failed") {
    log.info({ status: videoGen.status }, "Skipping job — already terminal");
    return;
  }

  const provider = getKlingProvider();
  let providerTaskId = videoGen.providerTaskId;
  const endpoint = (videoGen.endpoint ?? "multi-image2video") as
    | "multi-image2video"
    | "image2video";

  if (!providerTaskId) {
    const refIds = [
      ...videoGen.referenceImageIds,
      ...(videoGen.tailImageId ? [videoGen.tailImageId] : []),
    ];
    const assets = await MediaAsset.find({ _id: { $in: refIds } }).lean();
    const byId = new Map(assets.map((a) => [String(a._id), a]));

    const imageUrls: string[] = [];
    for (const id of videoGen.referenceImageIds) {
      const a = byId.get(id);
      if (!a) {
        await markFailed(videoGen._id, new Error(`Reference image ${id} not found`));
        return;
      }
      imageUrls.push(getKlingFetchUrl(a.storageKey));
    }
    const tailImageUrl = videoGen.tailImageId
      ? (() => {
          const a = byId.get(videoGen.tailImageId!);
          return a ? getKlingFetchUrl(a.storageKey) : undefined;
        })()
      : undefined;

    log.info(
      { endpoint, imageCount: imageUrls.length, hasTail: !!tailImageUrl },
      "Resolved fetch URLs for Kling",
    );

    try {
      let providerResult;
      if (endpoint === "image2video") {
        if (imageUrls.length !== 1) {
          await markFailed(
            videoGen._id,
            new Error("image2video requires exactly one start image"),
          );
          return;
        }
        providerResult = await provider.createImage2VideoTask({
          modelName: videoGen.modelName as KlingImage2VideoModel,
          mode: videoGen.mode as KlingImage2VideoMode,
          duration: videoGen.duration as KlingImage2VideoDuration,
          aspectRatio: videoGen.aspectRatio as KlingVideoAspectRatio,
          imageUrl: imageUrls[0],
          tailImageUrl,
          prompt: videoGen.prompt ?? undefined,
          negativePrompt: videoGen.negativePrompt ?? undefined,
          cfgScale: videoGen.cfgScale ?? undefined,
          enableAudio: !!videoGen.enableAudio,
          watermarkEnabled: videoGen.watermarkEnabled,
          externalTaskId: videoGen.externalTaskId,
        });
        log.info({ providerTaskId: providerResult.providerTaskId }, "Kling image2video task created");
      } else {
        providerResult = await provider.createMultiImage2VideoTask({
          modelName: videoGen.modelName as KlingMultiImage2VideoModel,
          mode: videoGen.mode as KlingMultiImage2VideoMode,
          duration: videoGen.duration as KlingMultiImage2VideoDuration,
          aspectRatio: videoGen.aspectRatio as KlingVideoAspectRatio,
          imageUrls,
          prompt: videoGen.prompt ?? "",
          negativePrompt: videoGen.negativePrompt ?? undefined,
          watermarkEnabled: videoGen.watermarkEnabled,
          externalTaskId: videoGen.externalTaskId,
        });
        log.info({ providerTaskId: providerResult.providerTaskId }, "Kling multi-image2video task created");
      }
      providerTaskId = providerResult.providerTaskId;
      await VideoGeneration.updateOne(
        { _id: videoGen._id },
        { $set: { providerTaskId, status: "processing", submittedAt: new Date() } },
      );
    } catch (err) {
      const retryable = err instanceof KlingApiError && err.retryable;
      if (!retryable) {
        await markFailed(videoGen._id, err);
        return;
      }
      throw err;
    }
  }

  await pollUntilTerminal(videoGen._id, providerTaskId, endpoint, log);
}

async function pollUntilTerminal(
  videoGenerationId: string,
  providerTaskId: string,
  endpoint: "multi-image2video" | "image2video",
  log: Logger,
): Promise<void> {
  const startedAt = Date.now();
  const provider = getKlingProvider();

  while (Date.now() - startedAt < HARD_TIMEOUT_MS) {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    const phase =
      POLL_PHASES.find((p) => elapsedSec < p.untilSec) ??
      POLL_PHASES[POLL_PHASES.length - 1];

    let result;
    try {
      result =
        endpoint === "image2video"
          ? await provider.getImage2VideoTask(providerTaskId)
          : await provider.getMultiImage2VideoTask(providerTaskId);
    } catch (err) {
      // Only a Kling API error with retryable=false is a true hard failure.
      // Everything else (network blips, DNS hiccups, undici `fetch failed`,
      // timeouts, AbortError) gets retried — the 20-minute hard timeout
      // still bounds the loop, and if Kling itself marked the task failed
      // a later poll will surface the real `task_status_msg`. Previously a
      // single transient blip overwrote the real Kling reason with a
      // generic "fetch failed" in the DB.
      const isHardKlingError = err instanceof KlingApiError && !err.retryable;
      if (isHardKlingError) {
        await markFailed(videoGenerationId, err);
        return;
      }
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Transient poll error, sleeping",
      );
      await sleep(phase.intervalMs);
      continue;
    }

    if (result.status === "succeed") {
      await finalizeSuccess(videoGenerationId, result, log);
      return;
    }

    if (result.status === "failed") {
      await VideoGeneration.updateOne(
        { _id: videoGenerationId },
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

  // Last-ditch query — if Kling did finalize in the gap between our last
  // poll and the hard timeout, capture the real status_msg instead of a
  // generic "timeout" message.
  try {
    const final =
      endpoint === "image2video"
        ? await provider.getImage2VideoTask(providerTaskId)
        : await provider.getMultiImage2VideoTask(providerTaskId);
    if (final.status === "succeed") {
      await finalizeSuccess(videoGenerationId, final, log);
      return;
    }
    if (final.status === "failed") {
      await VideoGeneration.updateOne(
        { _id: videoGenerationId },
        {
          $set: {
            status: "failed",
            errorMessage: final.statusMessage ?? "Generation failed",
            completedAt: new Date(),
            rawProviderPayload: final.rawPayload ?? null,
          },
        },
      );
      log.warn({ statusMessage: final.statusMessage }, "Kling reported failure at timeout");
      return;
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Final Kling query failed — recording polling timeout",
    );
  }

  await VideoGeneration.updateOne(
    { _id: videoGenerationId },
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
  videoGenerationId: string,
  result: Awaited<ReturnType<ReturnType<typeof getKlingProvider>["getMultiImage2VideoTask"]>>,
  log: Logger,
): Promise<void> {
  // Image2video and multi-image2video share the TaskQueryResult shape, so this
  // function works for both. The branch on endpoint only matters for cost calc.
  if (!result.videoUrl) {
    await VideoGeneration.updateOne(
      { _id: videoGenerationId },
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

  const videoGen = await VideoGeneration.findById(videoGenerationId).lean();
  if (!videoGen) return;
  if (videoGen.status === "completed") {
    log.info("Already completed by another worker — skipping finalize");
    return;
  }

  log.info({ videoUrl: result.videoUrl }, "Downloading generated video");
  const { buffer, contentType } = await downloadToBuffer(result.videoUrl);

  const ext = guessVideoExt(contentType);
  const storageKey = makeOutputKey(videoGen.ownerId, videoGen._id, ext);
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

  const fallbackDur = finalDuration ?? Number(videoGen.duration ?? "5");
  const actualCostUsd =
    (videoGen.endpoint ?? "multi-image2video") === "image2video"
      ? image2VideoDeductionToUsd(
          videoGen.modelName as KlingImage2VideoModel,
          videoGen.mode as KlingImage2VideoMode,
          result.finalUnitDeduction,
          fallbackDur,
          !!videoGen.enableAudio,
        )
      : multiImage2VideoDeductionToUsd(
          videoGen.modelName as KlingMultiImage2VideoModel,
          videoGen.mode as KlingMultiImage2VideoMode,
          result.finalUnitDeduction,
          fallbackDur,
        );

  // Hash on the way in so future uploads can be dedupe-checked against
  // generated content too (videos: SHA only — sharp can't decode video).
  const hashes = await computeAssetHashes(buffer, contentType);

  const outputAsset = await MediaAsset.create({
    ownerId: videoGen.ownerId,
    kind: "generated_video",
    filename: `${videoGen._id}.${ext}`,
    mimeType: contentType,
    sizeBytes: buffer.length,
    durationSec: finalDuration,
    width: probe.width,
    height: probe.height,
    storageKey,
    contentHash: hashes.contentHash,
    perceptualHash: hashes.perceptualHash,
  });

  const won = await VideoGeneration.updateOne(
    { _id: videoGenerationId, status: { $ne: "completed" } },
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

  log.info({ publicUrl: getPublicUrl(storageKey) }, "Multi-image video generation completed");

  if (videoGen.captionPackEnabled && isLlmConfigured()) {
    try {
      log.info("Generating caption pack");
      const pack = await generateCaptionPack({
        mediaKind: "video",
        prompt: videoGen.prompt,
        facts: { durationSec: finalDuration },
      });
      await VideoGeneration.updateOne(
        { _id: videoGenerationId },
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

async function markFailed(videoGenerationId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof KlingApiError ? err.code : null;
  await VideoGeneration.updateOne(
    { _id: videoGenerationId },
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
