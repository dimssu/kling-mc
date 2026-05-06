import type { Logger } from "pino";
import { Decimal, type InputJsonValue } from "@/generated/prisma/runtime/library";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getKlingProvider } from "@/lib/kling";
import { KlingApiError } from "@/lib/kling/errors";
import { imageDeductionToUsd, type KlingImageModel } from "@/lib/kling/pricing";
import type {
  KlingImageEndpoint,
} from "@/lib/kling/models";
import type { KlingImageAspectRatio } from "@/lib/kling/types";
import { downloadToBuffer, getKlingFetchUrl, getPublicUrl, uploadObject } from "@/lib/storage";
import { sniffMime, extForMime } from "@/lib/mime-sniff";
import { getEnv } from "@/lib/env";
import { signGid } from "@/lib/webhook-auth";
import { generateCaptionPack, isLlmConfigured } from "@/lib/gemini";

const POLL_PHASES: Array<{ untilSec: number; intervalMs: number }> = [
  { untilSec: 60, intervalMs: 5_000 },
  { untilSec: 5 * 60, intervalMs: 15_000 },
  { untilSec: 20 * 60, intervalMs: 30_000 },
];
const HARD_TIMEOUT_MS = 20 * 60 * 1000;

export async function handleImageGenerationJob(imageGenerationId: string): Promise<void> {
  const log = logger.child({ imageGenerationId });
  const imageGen = await prisma.imageGeneration.findUniqueOrThrow({
    where: { id: imageGenerationId },
    include: { sceneImage: true, styleImage: true },
  });

  if (imageGen.status === "completed" || imageGen.status === "failed") {
    log.info({ status: imageGen.status }, "Skipping job — already terminal");
    return;
  }

  const env = getEnv();
  const provider = getKlingProvider();
  let providerTaskId = imageGen.providerTaskId;

  const endpoint = (imageGen.endpoint as KlingImageEndpoint) || "multi-image2image";

  if (!providerTaskId) {
    // Resolve subject MediaAssets in the order the user picked them.
    const subjects = await prisma.mediaAsset.findMany({
      where: { id: { in: imageGen.subjectImageIds } },
    });
    const byId = new Map(subjects.map((a) => [a.id, a]));
    const subjectImageUrls: string[] = [];
    for (const sid of imageGen.subjectImageIds) {
      const a = byId.get(sid);
      if (!a) {
        await markFailed(imageGen.id, new Error(`Subject image ${sid} not found`));
        return;
      }
      subjectImageUrls.push(getKlingFetchUrl(a.storageKey));
    }
    const sceneImageUrl = imageGen.sceneImage
      ? getKlingFetchUrl(imageGen.sceneImage.storageKey)
      : undefined;
    const styleImageUrl = imageGen.styleImage
      ? getKlingFetchUrl(imageGen.styleImage.storageKey)
      : undefined;

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
        ? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/kling?gid=${encodeURIComponent(imageGen.id)}&sig=${signGid(imageGen.id)}`
        : undefined;

    try {
      let result;
      if (endpoint === "image2image") {
        if (!subjectImageUrls[0]) {
          await markFailed(imageGen.id, new Error("image2image requires a subject image"));
          return;
        }
        if (!imageGen.prompt) {
          await markFailed(imageGen.id, new Error("image2image requires a prompt"));
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
      await prisma.imageGeneration.update({
        where: { id: imageGen.id },
        data: { providerTaskId, status: "processing", submittedAt: new Date() },
      });
      log.info({ providerTaskId }, "Kling image task created");
    } catch (err) {
      const retryable = err instanceof KlingApiError && err.retryable;
      if (!retryable) {
        await markFailed(imageGen.id, err);
        return;
      }
      throw err;
    }
  }

  await pollUntilTerminal(imageGen.id, providerTaskId, endpoint, log);
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
      await prisma.imageGeneration.update({
        where: { id: imageGenerationId },
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

  await prisma.imageGeneration.update({
    where: { id: imageGenerationId },
    data: {
      status: "failed",
      errorMessage: "Polling timeout exceeded (20 minutes)",
      completedAt: new Date(),
    },
  });
  log.error("Polling timed out");
}

async function finalizeSuccess(
  imageGenerationId: string,
  result: Awaited<ReturnType<ReturnType<typeof getKlingProvider>["getImageToImageTask"]>>,
  log: Logger,
): Promise<void> {
  if (!result.imageUrl) {
    await prisma.imageGeneration.update({
      where: { id: imageGenerationId },
      data: {
        status: "failed",
        errorMessage: "Provider returned succeed without an image URL",
        completedAt: new Date(),
        rawProviderPayload: toJsonValue(result.rawPayload),
      },
    });
    return;
  }

  const imageGen = await prisma.imageGeneration.findUniqueOrThrow({ where: { id: imageGenerationId } });
  if (imageGen.status === "completed") {
    log.info("Already completed by another worker — skipping finalize");
    return;
  }

  log.info({ imageUrl: result.imageUrl }, "Downloading generated image");
  const { buffer, contentType } = await downloadToBuffer(result.imageUrl);

  // Prefer the magic-byte-sniffed type over what Kling claims, in case the
  // server set a generic content-type.
  const sniffed = sniffMime(buffer.subarray(0, 12));
  const finalContentType = sniffed ?? contentType;
  const ext = extForMime(sniffed) === "bin" ? guessImageExt(contentType) : extForMime(sniffed);

  const storageKey = `image-generations/${imageGen.ownerId}/${imageGen.id}.${ext}`;
  await uploadObject({ key: storageKey, body: buffer, contentType: finalContentType, contentLength: buffer.length });

  const actualCostUsd = imageDeductionToUsd(
    imageGen.modelName as KlingImageModel,
    result.finalUnitDeduction,
    imageGen.n,
    (imageGen.endpoint as KlingImageEndpoint) || "multi-image2image",
  );

  await prisma.$transaction(async (tx) => {
    const outputAsset = await tx.mediaAsset.create({
      data: {
        ownerId: imageGen.ownerId,
        kind: "generated_image",
        filename: `${imageGen.id}.${ext}`,
        mimeType: finalContentType,
        sizeBytes: buffer.length,
        storageKey,
      },
    });
    const updated = await tx.imageGeneration.updateMany({
      where: { id: imageGenerationId, status: { not: "completed" } },
      data: {
        status: "completed",
        outputAssetId: outputAsset.id,
        completedAt: new Date(),
        finalUnitDeduction: result.finalUnitDeduction,
        actualCostUsd: actualCostUsd != null ? new Decimal(actualCostUsd) : null,
        rawProviderPayload: toJsonValue(result.rawPayload),
      },
    });
    if (updated.count === 0) throw new RaceLostError();
  }).catch((err) => {
    if (err instanceof RaceLostError) {
      log.info("Lost finalize race; rolled back");
      return;
    }
    throw err;
  });

  log.info({ publicUrl: getPublicUrl(storageKey) }, "Image generation completed");

  // Caption pack: post-finalize, never fatal.
  if (imageGen.captionPackEnabled && isLlmConfigured()) {
    try {
      log.info("Generating caption pack");
      const pack = await generateCaptionPack({
        mediaKind: "image",
        prompt: imageGen.prompt,
        facts: { aspectRatio: imageGen.aspectRatio },
      });
      await prisma.imageGeneration.update({
        where: { id: imageGenerationId },
        data: {
          caption: pack.caption,
          captionTags: pack.tags,
          captionLocation: pack.location,
          captionAccessibility: pack.accessibilityText,
          captionPackGeneratedAt: new Date(),
        },
      });
      log.info("Caption pack saved");
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Caption pack generation failed (non-fatal)",
      );
    }
  }
}

class RaceLostError extends Error {
  constructor() { super("race-lost"); }
}

async function markFailed(imageGenerationId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof KlingApiError ? err.code : null;
  await prisma.imageGeneration.update({
    where: { id: imageGenerationId },
    data: { status: "failed", errorMessage: message, errorCode: code, completedAt: new Date() },
  });
}

function guessImageExt(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function toJsonValue(v: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as InputJsonValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
