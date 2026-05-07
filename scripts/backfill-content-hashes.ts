/**
 * One-shot backfill: compute SHA-256 contentHash for every reference_image
 * MediaAsset that doesn't have one yet. Streams each object from S3, hashes
 * it, and writes the hash back on the row. After backfill, groups by hash
 * to surface byte-identical duplicate clusters that were already in the
 * library.
 *
 * Idempotent: re-running finds no candidates and does nothing.
 *
 * Run: pnpm backfill:hashes
 *      pnpm backfill:hashes --dry-run   # compute + report, don't write
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import mongoose from "mongoose";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const env = getEnv();
  await connectMongo();

  const s3 = new S3Client({
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  const total = await MediaAsset.countDocuments({
    kind: "reference_image",
    $or: [{ contentHash: null }, { contentHash: { $exists: false } }],
  });

  if (total === 0) {
    console.log("✓ Nothing to backfill — every reference_image already has a contentHash.");
    await reportClusters();
    await mongoose.disconnect();
    return;
  }

  console.log(
    `Backfilling contentHash for ${total} reference_image row${total === 1 ? "" : "s"}${dryRun ? " (DRY RUN)" : ""}…`,
  );

  let scanned = 0;
  let updated = 0;
  let failed = 0;

  // Stream the cursor so we don't hold all docs in memory if the library
  // gets big later.
  const cursor = MediaAsset.find({
    kind: "reference_image",
    $or: [{ contentHash: null }, { contentHash: { $exists: false } }],
  })
    .sort({ createdAt: 1 })
    .cursor();

  for await (const doc of cursor) {
    scanned++;
    const id = String(doc._id);
    const key = doc.storageKey;
    if (!key) {
      failed++;
      console.log(`  ✗ ${id} — no storageKey`);
      continue;
    }

    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      );
      if (!res.Body) throw new Error("empty body");

      const hash = createHash("sha256");
      // SDK returns a Web ReadableStream in some envs; coerce to Node stream.
      const body =
        res.Body instanceof Readable
          ? res.Body
          : Readable.fromWeb(res.Body as never);
      await pipeline(body, hash);
      const contentHash = hash.digest("hex");

      if (!dryRun) {
        await MediaAsset.updateOne({ _id: id }, { $set: { contentHash } });
      }
      updated++;
      const idShort = id.slice(0, 8);
      console.log(
        `  ${dryRun ? "·" : "✓"} ${idShort}  ${contentHash.slice(0, 12)}…  ${doc.filename}`,
      );
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${id.slice(0, 8)}  ${doc.filename}  — ${msg}`);
      logger.warn({ id, key, err: msg }, "Backfill row failed");
    }
  }

  console.log("");
  console.log(
    `Done: scanned ${scanned}, ${dryRun ? "would update" : "updated"} ${updated}, failed ${failed}.`,
  );

  await reportClusters();
  await mongoose.disconnect();
}

async function reportClusters() {
  // Group by hash and surface anything with 2+ rows. Pure read, runs in both
  // dry-run and real mode (after the writes have landed).
  const clusters = (await MediaAsset.aggregate([
    {
      $match: {
        kind: "reference_image",
        contentHash: { $ne: null, $exists: true },
      },
    },
    {
      $group: {
        _id: "$contentHash",
        count: { $sum: 1 },
        rows: {
          $push: {
            id: "$_id",
            filename: "$filename",
            sizeBytes: "$sizeBytes",
            createdAt: "$createdAt",
          },
        },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $sort: { count: -1 } },
  ])) as Array<{
    _id: string;
    count: number;
    rows: Array<{ id: string; filename: string; sizeBytes: number; createdAt: Date }>;
  }>;

  console.log("");
  if (clusters.length === 0) {
    console.log("No duplicate clusters found in your reference-image library.");
    return;
  }

  console.log(
    `⚠ Found ${clusters.length} duplicate cluster${clusters.length === 1 ? "" : "s"} (byte-identical reference images):`,
  );
  for (const c of clusters) {
    console.log("");
    console.log(`  ${c._id.slice(0, 16)}… — ${c.count} copies`);
    // Sort newest-first so the first row in the printout is the most recent.
    const rows = [...c.rows].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    for (const r of rows) {
      const kb = (r.sizeBytes / 1024).toFixed(1);
      const when = new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " ");
      console.log(
        `    ${String(r.id).slice(0, 8)}  ${kb.padStart(7)} KB  ${when}  ${r.filename}`,
      );
    }
  }
  console.log("");
  console.log(
    "Tip: delete the older copies via the Library UI to clean up your S3 bucket.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
