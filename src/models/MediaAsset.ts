import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const MediaAssetSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    ownerId: { type: String, required: true },
    // "source_video" | "reference_image" | "generated_video" | "generated_image"
    kind: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    durationSec: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    storageKey: { type: String, required: true },
    thumbnailKey: { type: String, default: null },
    // SHA-256 of the raw bytes (lowercase hex). Populated on every kind
    // (uploaded or generated, image or video) so any future upload can be
    // dedupe-checked against the entire library. Nullable purely for the
    // backfill window — every new MediaAsset.create call sets it.
    contentHash: { type: String, default: null },
    // 64-bit dHash (16 hex chars) for "looks the same" detection — catches
    // re-encodings, format swaps, EXIF strips, light edits. Populated on
    // every image kind (reference_image, generated_image). Null for videos
    // (sharp can't decode them) and for the legacy backfill window.
    // See src/lib/perceptual-hash.ts.
    perceptualHash: { type: String, default: null },
    isFavorite: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

MediaAssetSchema.index({ ownerId: 1, kind: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerId: 1, isFavorite: 1 });
// Cross-kind dedupe lookup. Sparse so legacy null rows are excluded — no
// extra space cost for pre-feature data. We dedupe by ownerId+contentHash
// (without kind) so that an image uploaded twice across different surfaces
// — reference picker, generated output, etc. — is still flagged.
MediaAssetSchema.index(
  { ownerId: 1, contentHash: 1 },
  { sparse: true, name: "owner_hash" },
);

export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & { _id: string };

export const MediaAsset: Model<MediaAssetDoc> =
  (mongoose.models.MediaAsset as Model<MediaAssetDoc>) ??
  mongoose.model<MediaAssetDoc>("MediaAsset", MediaAssetSchema);
