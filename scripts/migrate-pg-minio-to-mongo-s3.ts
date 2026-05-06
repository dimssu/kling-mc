/**
 * One-shot migration from local Postgres + MinIO to MongoDB Atlas + AWS S3.
 *
 * Idempotent: re-running skips already-migrated rows (matched by old _id).
 *
 * Required env vars in .env.local:
 *   - LEGACY_DATABASE_URL          postgres://kling:kling@localhost:5432/kling_mc
 *   - LEGACY_S3_ENDPOINT           http://localhost:9000
 *   - LEGACY_S3_BUCKET             kling-mc-media
 *   - LEGACY_S3_ACCESS_KEY         minioadmin
 *   - LEGACY_S3_SECRET_KEY         minioadmin
 *   - MONGODB_URI / MONGODB_DB     (target Mongo cluster)
 *   - S3_*                         (target AWS S3 — same as runtime config)
 *
 * Run: pnpm migrate:legacy
 */

import { Client as PgClient } from "pg";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset, Generation, ImageGeneration, ImageCarousel } from "@/models";
import { MC_PREFIX } from "@/lib/storage";
import { getEnv } from "@/lib/env";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function streamToBuffer(s: GetObjectCommandOutput["Body"]): Promise<Buffer> {
  if (!s) throw new Error("empty body");
  if (s instanceof Buffer) return s;
  if (typeof (s as Readable).pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const c of s as Readable) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
  if (typeof (s as ReadableStream).getReader === "function") {
    const reader = (s as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const r = await reader.read();
      done = r.done;
      if (r.value) chunks.push(r.value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  throw new Error("unsupported S3 body shape");
}

async function main() {
  const env = getEnv();

  console.log("→ Connecting to legacy Postgres");
  const pg = new PgClient({ connectionString: need("LEGACY_DATABASE_URL") });
  await pg.connect();

  console.log("→ Connecting to legacy MinIO");
  const oldS3 = new S3Client({
    endpoint: need("LEGACY_S3_ENDPOINT"),
    region: "us-east-1",
    credentials: {
      accessKeyId: need("LEGACY_S3_ACCESS_KEY"),
      secretAccessKey: need("LEGACY_S3_SECRET_KEY"),
    },
    forcePathStyle: true,
  });
  const oldBucket = need("LEGACY_S3_BUCKET");

  console.log("→ Connecting to MongoDB");
  await connectMongo();

  // Reconcile indexes against the current schema. If a previous (failed) run
  // created sparse-unique indexes that the new schema replaces with
  // partialFilterExpression ones, syncIndexes drops the old + adds the new.
  // Non-destructive — no document data is touched.
  console.log("→ Syncing indexes against current schema");
  await Promise.all([
    MediaAsset.syncIndexes(),
    Generation.syncIndexes(),
    ImageGeneration.syncIndexes(),
    ImageCarousel.syncIndexes(),
  ]);

  console.log("→ Connecting to new AWS S3");
  const newS3 = new S3Client({
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  const newBucket = env.S3_BUCKET;

  // 1. MediaAsset → MediaAsset (and copy storage objects)
  console.log("\n=== MediaAsset ===");
  const assets = await pg.query(`SELECT * FROM "MediaAsset" ORDER BY "createdAt"`);
  console.log(`Found ${assets.rowCount} rows`);
  for (const r of assets.rows) {
    const id = r.id as string;
    const existing = await MediaAsset.findById(id).lean();
    if (existing) {
      console.log(`  · ${id}  already migrated`);
      continue;
    }

    const oldKey = r.storageKey as string;
    const newKey = `${MC_PREFIX}/${oldKey}`; // prepend `mc/` namespace

    process.stdout.write(`  · ${id}  copying ${oldKey} → ${newKey} ... `);
    try {
      const got = await oldS3.send(
        new GetObjectCommand({ Bucket: oldBucket, Key: oldKey }),
      );
      const buf = await streamToBuffer(got.Body);
      await newS3.send(
        new PutObjectCommand({
          Bucket: newBucket,
          Key: newKey,
          Body: buf,
          ContentType: r.mimeType as string,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log("ok");
    } catch (err) {
      console.log("failed");
      console.warn(`    storage copy failed for ${oldKey}: ${(err as Error).message}`);
      console.warn(`    creating row with original key — fix object before using.`);
    }

    await MediaAsset.create({
      _id: id,
      ownerId: r.ownerId,
      kind: r.kind,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      durationSec: r.durationSec,
      width: r.width,
      height: r.height,
      storageKey: newKey,
      thumbnailKey: r.thumbnailKey ? `${MC_PREFIX}/${r.thumbnailKey}` : null,
      isFavorite: r.isFavorite,
      createdAt: r.createdAt,
    });
  }

  // 2. Generation
  console.log("\n=== Generation ===");
  const gens = await pg.query(`SELECT * FROM "Generation" ORDER BY "createdAt"`);
  console.log(`Found ${gens.rowCount} rows`);
  for (const r of gens.rows) {
    const id = r.id as string;
    const existing = await Generation.findById(id).lean();
    if (existing) {
      console.log(`  · ${id}  already migrated`);
      continue;
    }
    await Generation.create({
      _id: id,
      ownerId: r.ownerId,
      status: r.status,
      provider: r.provider,
      providerTaskId: r.providerTaskId,
      externalTaskId: r.externalTaskId,
      sourceVideoId: r.sourceVideoId,
      referenceImageId: r.referenceImageId,
      outputAssetId: r.outputAssetId,
      prompt: r.prompt,
      modelName: r.modelName,
      mode: r.mode,
      characterOrientation: r.characterOrientation,
      keepOriginalSound: r.keepOriginalSound,
      watermarkEnabled: r.watermarkEnabled,
      estimatedCostUsd: Number(r.estimatedCostUsd),
      actualCostUsd: r.actualCostUsd != null ? Number(r.actualCostUsd) : null,
      finalUnitDeduction: r.finalUnitDeduction,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      rawProviderPayload: r.rawProviderPayload,
      isFavorite: r.isFavorite,
      captionPackEnabled: r.captionPackEnabled,
      caption: r.caption,
      captionTags: r.captionTags ?? [],
      captionLocation: r.captionLocation,
      captionAccessibility: r.captionAccessibility,
      captionPackGeneratedAt: r.captionPackGeneratedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      submittedAt: r.submittedAt,
      completedAt: r.completedAt,
    });
    console.log(`  · ${id}  done`);
  }

  // 3. ImageGeneration
  console.log("\n=== ImageGeneration ===");
  const imgs = await pg.query(`SELECT * FROM "ImageGeneration" ORDER BY "createdAt"`);
  console.log(`Found ${imgs.rowCount} rows`);
  for (const r of imgs.rows) {
    const id = r.id as string;
    const existing = await ImageGeneration.findById(id).lean();
    if (existing) {
      console.log(`  · ${id}  already migrated`);
      continue;
    }
    await ImageGeneration.create({
      _id: id,
      ownerId: r.ownerId,
      status: r.status,
      provider: r.provider,
      providerTaskId: r.providerTaskId,
      externalTaskId: r.externalTaskId,
      endpoint: r.endpoint,
      subjectImageIds: r.subjectImageIds ?? [],
      sceneImageId: r.sceneImageId,
      styleImageId: r.styleImageId,
      outputAssetId: r.outputAssetId,
      prompt: r.prompt,
      negativePrompt: r.negativePrompt,
      modelName: r.modelName,
      aspectRatio: r.aspectRatio,
      n: r.n,
      imageReference: r.imageReference,
      estimatedCostUsd: Number(r.estimatedCostUsd),
      actualCostUsd: r.actualCostUsd != null ? Number(r.actualCostUsd) : null,
      finalUnitDeduction: r.finalUnitDeduction,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      rawProviderPayload: r.rawProviderPayload,
      isFavorite: r.isFavorite,
      captionPackEnabled: r.captionPackEnabled,
      caption: r.caption,
      captionTags: r.captionTags ?? [],
      captionLocation: r.captionLocation,
      captionAccessibility: r.captionAccessibility,
      captionPackGeneratedAt: r.captionPackGeneratedAt,
      carouselId: r.carouselId,
      slotIndex: r.slotIndex,
      poseLabel: r.poseLabel,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      submittedAt: r.submittedAt,
      completedAt: r.completedAt,
    });
    console.log(`  · ${id}  done`);
  }

  // 4. ImageCarousel
  console.log("\n=== ImageCarousel ===");
  const carousels = await pg.query(`SELECT * FROM "ImageCarousel" ORDER BY "createdAt"`);
  console.log(`Found ${carousels.rowCount} rows`);
  for (const r of carousels.rows) {
    const id = r.id as string;
    const existing = await ImageCarousel.findById(id).lean();
    if (existing) {
      console.log(`  · ${id}  already migrated`);
      continue;
    }
    await ImageCarousel.create({
      _id: id,
      ownerId: r.ownerId,
      status: r.status,
      n: r.n,
      themePrompt: r.themePrompt,
      vibeLabel: r.vibeLabel,
      subjectImageId: r.subjectImageId,
      modelName: r.modelName,
      endpoint: r.endpoint,
      imageReference: r.imageReference,
      aspectRatio: r.aspectRatio,
      estimatedCostUsd: Number(r.estimatedCostUsd),
      caption: r.caption,
      captionTags: r.captionTags ?? [],
      captionLocation: r.captionLocation,
      captionAccessibility: r.captionAccessibility,
      captionGeneratedAt: r.captionGeneratedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      completedAt: r.completedAt,
    });
    console.log(`  · ${id}  done`);
  }

  await pg.end();
  console.log("\n✓ Migration complete");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
