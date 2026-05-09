import type { Logger } from "pino";
import { connectMongo } from "@/lib/mongo";
import { ImageGeneration, MediaAsset } from "@/models";
import { logger } from "@/lib/logger";
import { getKlingProvider } from "@/lib/kling";
import { KlingApiError } from "@/lib/kling/errors";
import { imageDeductionToUsd, type KlingImageModel } from "@/lib/kling/pricing";
import type { KlingImageEndpoint } from "@/lib/kling/models";
import type { KlingImageAspectRatio } from "@/lib/kling/types";
import {
  downloadToBuffer,
  getKlingFetchUrl,
  getPublicUrl,
  makeOutputKey,
  uploadObject,
} from "@/lib/storage";
import { sniffMime, extForMime } from "@/lib/mime-sniff";
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

export async function handleImageGenerationJob(imageGenerationId: string): Promise<void> {
  await connectMongo();
  const log = logger.child({ imageGenerationId });
  const imageGen = await ImageGeneration.findById(imageGenerationId).lean();
  if (!imageGen) throw new Error(`ImageGeneration ${imageGenerationId} not found`);

  if (imageGen.status === "completed" || imageGen.status === "failed") {
    log.info({ status: imageGen.status }, "Skipping job — already terminal");
    return;
  }

  const env = getEnv();
  const provider = getKlingProvider();
  let providerTaskId = imageGen.providerTaskId;

  const endpoint = (imageGen.endpoint as KlingImageEndpoint) || "multi-image2image";

  if (!providerTaskId) {
    // Resolve all referenced MediaAssets in one round-trip.
    const refIds = [
      ...imageGen.subjectImageIds,
      imageGen.sceneImageId,
      imageGen.styleImageId,
    ].filter((x): x is string => !!x);
    const assets = await MediaAsset.find({ _id: { $in: refIds } }).lean();
    const byId = new Map(assets.map((a) => [String(a._id), a]));

    const subjectImageUrls: string[] = [];
    for (const sid of imageGen.subjectImageIds) {
      const a = byId.get(sid);
      if (!a) {
        await markFailed(imageGen._id, new Error(`Subject image ${sid} not found`));
        return;
      }
      subjectImageUrls.push(getKlingFetchUrl(a.storageKey));
    }
    const sceneImage = imageGen.sceneImageId ? byId.get(imageGen.sceneImageId) : null;
    const styleImage = imageGen.styleImageId ? byId.get(imageGen.styleImageId) : null;
    const sceneImageUrl = sceneImage ? getKlingFetchUrl(sceneImage.storageKey) : undefined;
    const styleImageUrl = styleImage ? getKlingFetchUrl(styleImage.storageKey) : undefined;

    log.info(
      {
        endpoint,
        subjectCount: subjectImageUrls.length,
        hasScene: !!sceneImageUrl,
        hasStyle: !!styleImageUrl,
      },
      "Resolved fetch URLs for Kling",
    );

    const callbackUrl =
      env.ENABLE_KLING_WEBHOOKS && env.WEBHOOK_SECRET
        ? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/kling?gid=${encodeURIComponent(imageGen._id)}&sig=${signGid(imageGen._id)}`
        : undefined;

    try {
      let result;
      if (endpoint === "image2image") {
        if (!subjectImageUrls[0]) {
          await markFailed(imageGen._id, new Error("image2image requires a subject image"));
          return;
        }
        if (!imageGen.prompt) {
          await markFailed(imageGen._id, new Error("image2image requires a prompt"));
          return;
        }
        log.info("Creating Kling single-image2image task");
        result = await provider.createSingleImage2ImageTask({
          modelName: imageGen.modelName as KlingImageModel,
          imageUrl: subjectImageUrls[0],
          prompt: imageGen.prompt,
          negativePrompt: imageGen.negativePrompt ?? undefined,
          imageReference:
            (imageGen.imageReference as "subject" | "face" | null) ?? undefined,
          aspectRatio: (imageGen.aspectRatio ?? undefined) as
            | KlingImageAspectRatio
            | undefined,
          n: imageGen.n,
          callbackUrl,
          externalTaskId: imageGen.externalTaskId,
        });
      } else {
        log.info("Creating Kling multi-image2image task");
        result = await provider.createImageToImageTask({
          modelName: imageGen.modelName as KlingImageModel,
          subjectImageUrls,
          sceneImageUrl,
          styleImageUrl,
          prompt: imageGen.prompt ?? undefined,
          negativePrompt: imageGen.negativePrompt ?? undefined,
          aspectRatio: (imageGen.aspectRatio ?? undefined) as
            | KlingImageAspectRatio
            | undefined,
          n: imageGen.n,
          callbackUrl,
          externalTaskId: imageGen.externalTaskId,
        });
      }
      providerTaskId = result.providerTaskId;
      await ImageGeneration.updateOne(
        { _id: imageGen._id },
        { $set: { providerTaskId, status: "processing", submittedAt: new Date() } },
      );
      log.info({ providerTaskId }, "Kling image task created");
    } catch (err) {
      const retryable = err instanceof KlingApiError && err.retryable;
      if (!retryable) {
        await markFailed(imageGen._id, err);
        return;
      }
      throw err;
    }
  }

  await pollUntilTerminal(imageGen._id, providerTaskId, endpoint, log);
}

async function pollUntilTerminal(
  imageGenerationId: string,
  providerTaskId: string,
  endpoint: KlingImageEndpoint,
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
        endpoint === "image2image"
          ? await provider.getSingleImage2ImageTask(providerTaskId)
          : await provider.getImageToImageTask(providerTaskId);
    } catch (err) {
      if (err instanceof KlingApiError && err.retryable) {
        log.warn({ err: err.message, code: err.code }, "Retryable poll error, sleeping");
        await sleep(phase.intervalMs);
        continue;
      }
      await markFailed(imageGenerationId, err);
      return;
    }

    if (result.status === "succeed") {
      await finalizeSuccess(imageGenerationId, result, log);
      return;
    }
    if (result.status === "failed") {
      await ImageGeneration.updateOne(
        { _id: imageGenerationId },
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

  await ImageGeneration.updateOne(
    { _id: imageGenerationId },
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
  imageGenerationId: string,
  result: Awaited<ReturnType<ReturnType<typeof getKlingProvider>["getImageToImageTask"]>>,
  log: Logger,
): Promise<void> {
  if (!result.imageUrl) {
    await ImageGeneration.updateOne(
      { _id: imageGenerationId },
      {
        $set: {
          status: "failed",
          errorMessage: "Provider returned succeed without an image URL",
          completedAt: new Date(),
          rawProviderPayload: result.rawPayload ?? null,
        },
      },
    );
    return;
  }

  const imageGen = await ImageGeneration.findById(imageGenerationId).lean();
  if (!imageGen) return;
  if (imageGen.status === "completed") {
    log.info("Already completed by another worker — skipping finalize");
    return;
  }

  log.info({ imageUrl: result.imageUrl }, "Downloading generated image");
  const { buffer, contentType } = await downloadToBuffer(result.imageUrl);

  // Prefer the magic-byte-sniffed type over what Kling claims.
  const sniffed = sniffMime(buffer.subarray(0, 12));
  const finalContentType = sniffed ?? contentType;
  const ext =
    extForMime(sniffed) === "bin" ? guessImageExt(contentType) : extForMime(sniffed);

  const storageKey = makeOutputKey(imageGen.ownerId, imageGen._id, ext);
  await uploadObject({
    key: storageKey,
    body: buffer,
    contentType: finalContentType,
    contentLength: buffer.length,
  });

  const actualCostUsd = imageDeductionToUsd(
    imageGen.modelName as KlingImageModel,
    result.finalUnitDeduction,
    imageGen.n,
    (imageGen.endpoint as KlingImageEndpoint) || "multi-image2image",
  );

  // Hash on the way in so any future upload of this same generated image
  // (e.g. user re-uploads it as a reference) gets flagged as a duplicate.
  const hashes = await computeAssetHashes(buffer, finalContentType);

  const outputAsset = await MediaAsset.create({
    ownerId: imageGen.ownerId,
    kind: "generated_image",
    filename: `${imageGen._id}.${ext}`,
    mimeType: finalContentType,
    sizeBytes: buffer.length,
    storageKey,
    contentHash: hashes.contentHash,
    perceptualHash: hashes.perceptualHash,
  });

  const won = await ImageGeneration.updateOne(
    { _id: imageGenerationId, status: { $ne: "completed" } },
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

  log.info({ publicUrl: getPublicUrl(storageKey) }, "Image generation completed");

  if (imageGen.captionPackEnabled && isLlmConfigured()) {
    try {
      log.info("Generating caption pack");
      const pack = await generateCaptionPack({
        mediaKind: "image",
        prompt: imageGen.prompt,
        facts: { aspectRatio: imageGen.aspectRatio },
      });
      await ImageGeneration.updateOne(
        { _id: imageGenerationId },
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

async function markFailed(imageGenerationId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof KlingApiError ? err.code : null;
  await ImageGeneration.updateOne(
    { _id: imageGenerationId },
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

function guessImageExt(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
