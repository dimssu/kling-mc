/**
 * One-shot backfill for MediaAsset hashes across the whole library:
 *   - SHA-256 contentHash    → byte-exact dedupe (every kind)
 *   - 64-bit dHash perceptualHash → "looks the same" dedupe (image kinds only —
 *                                  sharp can't decode video)
 *
 * Streams each object from S3 once, computes both hashes in the same pass,
 * writes them back. After backfill, groups by each hash to surface clusters
 * that were already in the library.
 *
 * Covers every kind: reference_image, source_video, generated_image,
 * generated_video. Run order: oldest first, so the report's "first row of a
 * cluster" lines up with what showed up in the library first.
 *
 * Idempotent: skips rows whose hashes are already populated. Safe to re-run
 * after adding new hash types in the future.
 *
 * Run: pnpm backfill:hashes
 *      pnpm backfill:hashes --dry-run   # compute + report, don't write
 */

import { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { computeAssetHashes, isImageMime } from "@/lib/asset-hash";
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

  // Need contentHash (every kind) OR perceptualHash (only when applicable for
  // mime). For videos, missing perceptualHash isn't fixable, so we exclude
  // them from the "needs perceptual" branch — otherwise the script would loop
  // forever flagging them as needing work it can't do.
  const filter = {
    $or: [
      // Any kind missing the universal SHA hash.
      { contentHash: null },
      { contentHash: { $exists: false } },
      // Image kinds missing the perceptual hash.
      {
        mimeType: /^image\//,
        $or: [{ perceptualHash: null }, { perceptualHash: { $exists: false } }],
      },
    ],
  };

  const total = await MediaAsset.countDocuments(filter);

  if (total === 0) {
    console.log("✓ Nothing to backfill — every asset already has the hashes it can have.");
    await reportClusters();
    await mongoose.disconnect();
    return;
  }

  console.log(
    `Backfilling hashes for ${total} asset${total === 1 ? "" : "s"} across all kinds${dryRun ? " (DRY RUN)" : ""}…`,
  );

  let scanned = 0;
  let updated = 0;
  let failed = 0;

  // Stream the cursor so we don't hold all docs in memory if the library
  // gets big later.
  const cursor = MediaAsset.find(filter).sort({ createdAt: 1 }).cursor();

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

      // Buffer the whole object once: sharp needs the full bytes to decode,
      // and SHA-256 over a Buffer is essentially free. Reference images are
      // capped at 10 MB by the upload limits — fine to hold in memory.
      const body =
        res.Body instanceof Readable
          ? res.Body
          : Readable.fromWeb(res.Body as never);
      const chunks: Buffer[] = [];
      for await (const c of body) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      }
      const buf = Buffer.concat(chunks);

      // Single hash pass via the shared helper — same code paths as live
      // uploads/worker outputs use, so output is consistent across surfaces.
      const computed = await computeAssetHashes(buf, doc.mimeType ?? "");
      const update: { contentHash?: string; perceptualHash?: string } = {};
      if (!doc.contentHash) update.contentHash = computed.contentHash;
      if (!doc.perceptualHash && computed.perceptualHash) {
        update.perceptualHash = computed.perceptualHash;
      }

      if (Object.keys(update).length === 0) {
        // Already had everything we'd want. Shouldn't happen given filter,
        // but defensive.
        continue;
      }

      if (!dryRun) {
        await MediaAsset.updateOne({ _id: id }, { $set: update });
      }
      updated++;
      const idShort = id.slice(0, 8);
      const sha = (update.contentHash ?? doc.contentHash ?? "").slice(0, 12);
      const ph =
        (update.perceptualHash ?? doc.perceptualHash) ??
        (isImageMime(doc.mimeType ?? "") ? "(failed)" : "(n/a video)");
      console.log(
        `  ${dryRun ? "·" : "✓"} [${doc.kind}] ${idShort}  sha:${sha}…  ph:${ph}  ${doc.filename}`,
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
  type Row = {
    id: string;
    filename: string;
    sizeBytes: number;
    createdAt: Date;
    kind: string;
  };

  // ── Tier 1: byte-identical clusters (exact SHA-256 collisions) ────────
  // Cross-kind: a generated image and a re-uploaded copy of it should both
  // show up in the same cluster.
  const exactClusters = (await MediaAsset.aggregate([
    {
      $match: {
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
            kind: "$kind",
          },
        },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $sort: { count: -1 } },
  ])) as Array<{ _id: string; count: number; rows: Row[] }>;

  console.log("");
  if (exactClusters.length === 0) {
    console.log("✓ No byte-identical duplicate clusters.");
  } else {
    console.log(
      `⚠ Found ${exactClusters.length} byte-identical cluster${exactClusters.length === 1 ? "" : "s"}:`,
    );
    for (const c of exactClusters) {
      printCluster(c._id, c.rows);
    }
  }

  // ── Tier 2: perceptual clusters (look the same, bytes differ) ─────────
  // Group rows that aren't byte-equal but ARE perceptually identical
  // (Hamming distance 0 on dHash). For looser matches we'd need an O(n²)
  // pairwise scan; the dHash==dHash bucket catches the most common case
  // (re-exports, format swaps) cheaply via Mongo aggregation.
  const exactHashes = new Set(exactClusters.map((c) => c._id));
  const phashClusters = (await MediaAsset.aggregate([
    {
      $match: {
        perceptualHash: { $ne: null, $exists: true },
      },
    },
    {
      $group: {
        _id: "$perceptualHash",
        count: { $sum: 1 },
        // Track distinct contentHashes so we can filter out clusters that
        // are *only* byte-identical (already reported in tier 1).
        distinctSha: { $addToSet: "$contentHash" },
        rows: {
          $push: {
            id: "$_id",
            filename: "$filename",
            sizeBytes: "$sizeBytes",
            createdAt: "$createdAt",
            kind: "$kind",
            contentHash: "$contentHash",
          },
        },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $sort: { count: -1 } },
  ])) as Array<{
    _id: string;
    count: number;
    distinctSha: (string | null)[];
    rows: (Row & { contentHash: string | null })[];
  }>;

  // Skip clusters where every row already showed up under the byte-exact
  // section — they're not interesting, just the same finding viewed twice.
  const interesting = phashClusters.filter((c) => {
    const distinctNonNull = c.distinctSha.filter((s): s is string => !!s);
    return (
      distinctNonNull.length >= 2 ||
      distinctNonNull.some((sha) => !exactHashes.has(sha))
    );
  });

  console.log("");
  if (interesting.length === 0) {
    console.log("✓ No perceptual clusters beyond the byte-identical ones above.");
  } else {
    console.log(
      `⚠ Found ${interesting.length} perceptual cluster${interesting.length === 1 ? "" : "s"} (same image, different bytes):`,
    );
    for (const c of interesting) {
      printCluster(c._id, c.rows);
    }
  }

  if (exactClusters.length > 0 || interesting.length > 0) {
    console.log("");
    console.log("Tip: delete older copies via the Library UI to clean up S3.");
  }
}

function printCluster(
  hash: string,
  rows: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    createdAt: Date;
    kind?: string;
  }>,
) {
  console.log("");
  console.log(`  ${hash.slice(0, 16)}… — ${rows.length} copies`);
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  for (const r of sorted) {
    const kb = (r.sizeBytes / 1024).toFixed(1);
    const when = new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " ");
    const kindTag = r.kind ? `[${r.kind}] ` : "";
    console.log(
      `    ${String(r.id).slice(0, 8)}  ${kb.padStart(7)} KB  ${when}  ${kindTag}${r.filename}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
