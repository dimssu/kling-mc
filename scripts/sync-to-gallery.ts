/**
 * One-way push from kling-mc → kling-gallery.
 *
 * For every completed generation (motion-control video, image-generation,
 * carousel slide), POST a metadata-only ingest to the gallery's /api/ingest
 * endpoint. Both projects share the same S3 bucket, so the gallery just
 * records the URL — no byte copying.
 *
 * Idempotent: gallery dedups on externalId.
 *
 * Required env in .env.local:
 *   - GALLERY_INGEST_URL    https://kling.dimssu.com/api/ingest
 *   - GALLERY_INGEST_TOKEN  (matches the gallery's INGEST_TOKEN)
 *   - MONGODB_URI / MONGODB_DB
 *   - S3_PUBLIC_URL_BASE
 *
 * Run: pnpm sync:gallery
 */

import { connectMongo } from "@/lib/mongo";
import { Generation, ImageGeneration, ImageCarousel, MediaAsset } from "@/models";
import { getEnv } from "@/lib/env";
import { getPublicUrl } from "@/lib/storage";

type IngestBody = {
  kind: "image" | "video";
  source: "generated";
  externalId: string;
  externalKind: string;
  s3Url: string;
  s3Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  prompt?: string | null;
  caption?: string | null;
  captionTags?: string[];
};

async function postIngest(body: IngestBody): Promise<{ ok: boolean; reason?: string }> {
  const env = getEnv();
  if (!env.GALLERY_INGEST_URL || !env.GALLERY_INGEST_TOKEN) {
    return { ok: false, reason: "GALLERY_INGEST_URL / GALLERY_INGEST_TOKEN not set" };
  }
  const res = await fetch(env.GALLERY_INGEST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GALLERY_INGEST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `${res.status} ${text}` };
  }
  return { ok: true };
}

async function main() {
  const env = getEnv();
  if (!env.GALLERY_INGEST_URL || !env.GALLERY_INGEST_TOKEN) {
    console.error("GALLERY_INGEST_URL or GALLERY_INGEST_TOKEN missing in .env.local");
    process.exit(1);
  }
  await connectMongo();

  // Motion-control videos
  console.log("→ Motion-control videos");
  const vids = await Generation.find({ status: "completed", outputAssetId: { $ne: null } }).lean();
  for (const g of vids) {
    if (!g.outputAssetId) continue;
    const out = await MediaAsset.findById(g.outputAssetId).lean();
    if (!out) continue;
    const r = await postIngest({
      kind: "video",
      source: "generated",
      externalId: `mc_gen_${String(g._id)}`,
      externalKind: "generation",
      s3Url: getPublicUrl(out.storageKey),
      s3Key: out.storageKey,
      filename: out.filename,
      mimeType: out.mimeType,
      sizeBytes: out.sizeBytes,
      width: out.width ?? undefined,
      height: out.height ?? undefined,
      durationSec: out.durationSec ?? undefined,
      prompt: g.prompt,
      caption: g.caption,
      captionTags: g.captionTags ?? [],
    });
    console.log(`  · ${String(g._id)}  ${r.ok ? "ok" : `failed: ${r.reason}`}`);
  }

  // Image generations (excluding carousel slides — those are sent as part of the carousel)
  console.log("→ Image generations");
  const imgs = await ImageGeneration.find({
    status: "completed",
    outputAssetId: { $ne: null },
    carouselId: null,
  }).lean();
  for (const g of imgs) {
    if (!g.outputAssetId) continue;
    const out = await MediaAsset.findById(g.outputAssetId).lean();
    if (!out) continue;
    const r = await postIngest({
      kind: "image",
      source: "generated",
      externalId: `mc_img_${String(g._id)}`,
      externalKind: "image-generation",
      s3Url: getPublicUrl(out.storageKey),
      s3Key: out.storageKey,
      filename: out.filename,
      mimeType: out.mimeType,
      sizeBytes: out.sizeBytes,
      width: out.width ?? undefined,
      height: out.height ?? undefined,
      prompt: g.prompt,
      caption: g.caption,
      captionTags: g.captionTags ?? [],
    });
    console.log(`  · ${String(g._id)}  ${r.ok ? "ok" : `failed: ${r.reason}`}`);
  }

  // Carousel slides — push each completed slide individually so they appear
  // in the gallery grid; carousel parent caption is replicated onto each slide.
  console.log("→ Carousel slides");
  const carousels = await ImageCarousel.find({
    status: { $in: ["completed", "partial"] },
  }).lean();
  for (const c of carousels) {
    const slides = await ImageGeneration.find({
      carouselId: c._id,
      status: "completed",
      outputAssetId: { $ne: null },
    }).lean();
    for (const s of slides) {
      if (!s.outputAssetId) continue;
      const out = await MediaAsset.findById(s.outputAssetId).lean();
      if (!out) continue;
      const r = await postIngest({
        kind: "image",
        source: "generated",
        externalId: `mc_carousel_${String(c._id)}_${s.slotIndex ?? 0}`,
        externalKind: "carousel-slide",
        s3Url: getPublicUrl(out.storageKey),
        s3Key: out.storageKey,
        filename: out.filename,
        mimeType: out.mimeType,
        sizeBytes: out.sizeBytes,
        width: out.width ?? undefined,
        height: out.height ?? undefined,
        prompt: s.prompt,
        caption: c.caption ?? s.caption,
        captionTags: c.captionTags ?? s.captionTags ?? [],
      });
      console.log(
        `  · carousel ${String(c._id)} slot ${s.slotIndex}  ${r.ok ? "ok" : `failed: ${r.reason}`}`,
      );
    }
  }

  console.log("\n✓ Sync complete");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
