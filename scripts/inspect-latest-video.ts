/**
 * Quick diagnostic: dump the most recent VideoGenerations and verify
 * whether enableAudio was set and whether Kling reports audio on the file.
 *
 * Usage: pnpm dotenv -e .env.local -- tsx scripts/inspect-latest-video.ts [n]
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

import { connectMongo } from "@/lib/mongo";
import { VideoGeneration } from "@/models";
import { getKlingProvider } from "@/lib/kling";

async function main() {
  const n = Number(process.argv[2] ?? "3");
  await connectMongo();
  const rows = await VideoGeneration.find()
    .sort({ createdAt: -1 })
    .limit(n)
    .lean();

  for (const r of rows) {
    console.log("─".repeat(70));
    console.log({
      id: r._id,
      createdAt: r.createdAt,
      endpoint: r.endpoint,
      modelName: r.modelName,
      mode: r.mode,
      duration: r.duration,
      enableAudio: r.enableAudio,
      status: r.status,
      providerTaskId: r.providerTaskId,
      tailImageId: r.tailImageId,
      outputAssetId: r.outputAssetId,
      finalUnitDeduction: r.finalUnitDeduction,
      actualCostUsd: r.actualCostUsd,
    });

    if (r.providerTaskId && r.endpoint === "image2video") {
      try {
        const provider = getKlingProvider();
        const live = await provider.getImage2VideoTask(r.providerTaskId);
        console.log("Kling task live state:", {
          status: live.status,
          videoUrl: live.videoUrl?.slice(0, 80) + "...",
          finalUnitDeduction: live.finalUnitDeduction,
          videoDurationSec: live.videoDurationSec,
        });
        // Peek into raw payload for any audio-related field Kling may include.
        const raw = live.rawPayload as Record<string, unknown> | undefined;
        if (raw) {
          const taskResult = (raw as { task_result?: unknown }).task_result;
          console.log("raw task_result:", JSON.stringify(taskResult, null, 2));
        }
      } catch (err) {
        console.log("Kling query failed:", (err as Error).message);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
