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
    // SHA-256 of the original bytes (lowercase hex). Used for byte-exact
    // duplicate detection on upload. Nullable so existing rows pre-feature
    // don't fail validation; future uploads always set it.
    contentHash: { type: String, default: null },
    // 64-bit dHash (16 hex chars) for "looks the same" detection — catches
    // re-encodings, format swaps, EXIF-stripped copies, light edits. See
    // src/lib/perceptual-hash.ts. Nullable for the same backfill reason as
    // contentHash. Only populated on reference_image rows.
    perceptualHash: { type: String, default: null },
    isFavorite: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

MediaAssetSchema.index({ ownerId: 1, kind: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerId: 1, isFavorite: 1 });
// Lookup index for the dup-detection path. Sparse so legacy null rows are
// excluded — no extra space cost for pre-feature data.
MediaAssetSchema.index(
  { ownerId: 1, kind: 1, contentHash: 1 },
  { sparse: true, name: "owner_kind_hash" },
);

export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & { _id: string };

export const MediaAsset: Model<MediaAssetDoc> =
  (mongoose.models.MediaAsset as Model<MediaAssetDoc>) ??
  mongoose.model<MediaAssetDoc>("MediaAsset", MediaAssetSchema);
