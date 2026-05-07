/**
 * One-off recovery: query Kling for a stuck VideoGeneration and finalize.
 * Usage: pnpm tsx scripts/recover-video-gen.ts <videoGenerationId>
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

import { connectMongo } from "@/lib/mongo";
import { VideoGeneration, MediaAsset } from "@/models";
import { getKlingProvider } from "@/lib/kling";
import { multiImage2VideoDeductionToUsd } from "@/lib/kling/pricing";
import type {
  KlingMultiImage2VideoMode,
  KlingMultiImage2VideoModel,
} from "@/lib/kling/types";
import {
  downloadToBuffer,
  getPublicUrl,
  makeOutputKey,
  uploadObject,
} from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: tsx scripts/recover-video-gen.ts <videoGenerationId>");
    process.exit(2);
  }

  await connectMongo();
  const vg = await VideoGeneration.findById(id).lean();
  if (!vg) {
    console.error("Not found:", id);
    process.exit(1);
  }
  console.log("Loaded:", {
    id: vg._id,
    status: vg.status,
    providerTaskId: vg.providerTaskId,
    submittedAt: vg.submittedAt,
  });

  if (!vg.providerTaskId) {
    console.error("No providerTaskId — cannot recover");
    process.exit(1);
  }

  const provider = getKlingProvider();
  console.log("Querying Kling…");
  const r = await provider.getMultiImage2VideoTask(vg.providerTaskId);
  console.log("Kling status:", r.status);
  console.log("statusMessage:", r.statusMessage);
  console.log("videoUrl:", r.videoUrl);
  console.log("durationSec:", r.videoDurationSec);
  console.log("finalUnitDeduction:", r.finalUnitDeduction);

  if (r.status === "failed") {
    await VideoGeneration.updateOne(
      { _id: vg._id },
      {
        $set: {
          status: "failed",
          errorMessage: r.statusMessage ?? "Generation failed",
          completedAt: new Date(),
          rawProviderPayload: r.rawPayload ?? null,
        },
      },
    );
    console.log("Marked failed in DB.");
    return;
  }

  if (r.status !== "succeed") {
    console.log(`Still ${r.status} on Kling — nothing to recover yet.`);
    return;
  }

  if (!r.videoUrl) {
    console.error("succeed but no videoUrl from Kling");
    process.exit(1);
  }

  console.log("Downloading from Kling…");
  const { buffer, contentType } = await downloadToBuffer(r.videoUrl);
  const ext = guessVideoExt(contentType);
  const storageKey = makeOutputKey(vg.ownerId, vg._id, ext);
  console.log("Uploading to S3:", storageKey);
  await uploadObject({
    key: storageKey,
    body: buffer,
    contentType,
    contentLength: buffer.length,
  });

  const probe = await probeMedia(buffer, ext).catch(() => ({
    width: null,
    height: null,
    durationSec: r.videoDurationSec,
  }));
  const probedDuration = Number.isFinite(probe.durationSec ?? NaN)
    ? probe.durationSec
    : null;
  const finalDuration =
    probedDuration ??
    (Number.isFinite(r.videoDurationSec ?? NaN) ? r.videoDurationSec : null);

  const actualCostUsd = multiImage2VideoDeductionToUsd(
    vg.modelName as KlingMultiImage2VideoModel,
    vg.mode as KlingMultiImage2VideoMode,
    r.finalUnitDeduction,
    finalDuration ?? Number(vg.duration ?? "5"),
  );

  const outputAsset = await MediaAsset.create({
    ownerId: vg.ownerId,
    kind: "generated_video",
    filename: `${vg._id}.${ext}`,
    mimeType: contentType,
    sizeBytes: buffer.length,
    durationSec: finalDuration,
    width: probe.width,
    height: probe.height,
    storageKey,
  });

  await VideoGeneration.updateOne(
    { _id: vg._id, status: { $ne: "completed" } },
    {
      $set: {
        status: "completed",
        outputAssetId: String(outputAsset._id),
        completedAt: new Date(),
        finalUnitDeduction: r.finalUnitDeduction,
        actualCostUsd: actualCostUsd ?? null,
        rawProviderPayload: r.rawPayload ?? null,
      },
    },
  );

  console.log("Recovered. Public URL:", getPublicUrl(storageKey));
}

function guessVideoExt(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime") || contentType.includes("mov")) return "mov";
  if (contentType.includes("webm")) return "webm";
  return "mp4";
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
