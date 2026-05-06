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
    isFavorite: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

MediaAssetSchema.index({ ownerId: 1, kind: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerId: 1, isFavorite: 1 });

export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & { _id: string };

export const MediaAsset: Model<MediaAssetDoc> =
  (mongoose.models.MediaAsset as Model<MediaAssetDoc>) ??
  mongoose.model<MediaAssetDoc>("MediaAsset", MediaAssetSchema);
