import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const VideoGenerationSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    ownerId: { type: String, required: true },
    status: { type: String, required: true }, // queued | processing | completed | failed
    provider: { type: String, default: "kling_official" },
    providerTaskId: {
      type: String,
      default: null,
      index: {
        unique: true,
        partialFilterExpression: { providerTaskId: { $type: "string" } },
      },
    },
    externalTaskId: { type: String, required: true, index: { unique: true } },

    // "multi-image2video" (v1.6 only) | "image2video" (single subject + optional tail)
    endpoint: { type: String, default: "multi-image2video" },

    referenceImageIds: { type: [String], default: [] },
    tailImageId: { type: String, default: null },
    cfgScale: { type: Number, default: null },
    // V2.6 + Pro mode only. Doubles the Pro rate.
    enableAudio: { type: Boolean, default: false },
    outputAssetId: {
      type: String,
      default: null,
      index: {
        unique: true,
        partialFilterExpression: { outputAssetId: { $type: "string" } },
      },
    },

    prompt: { type: String, default: null },
    negativePrompt: { type: String, default: null },
    modelName: { type: String, required: true },
    mode: { type: String, required: true },
    duration: { type: String, default: "5" }, // "5" | "10"
    aspectRatio: { type: String, default: "16:9" },
    watermarkEnabled: { type: Boolean, default: false },

    estimatedCostUsd: { type: Number, required: true },
    actualCostUsd: { type: Number, default: null },
    finalUnitDeduction: { type: String, default: null },
    errorCode: { type: Number, default: null },
    errorMessage: { type: String, default: null },
    rawProviderPayload: { type: Schema.Types.Mixed, default: null },
    isFavorite: { type: Boolean, default: false },

    captionPackEnabled: { type: Boolean, default: false },
    caption: { type: String, default: null },
    captionTags: { type: [String], default: [] },
    captionLocation: { type: String, default: null },
    captionAccessibility: { type: String, default: null },
    captionPackGeneratedAt: { type: Date, default: null },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false },
);

VideoGenerationSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
VideoGenerationSchema.index({ ownerId: 1, isFavorite: 1 });
VideoGenerationSchema.index({ status: 1, submittedAt: 1 });

VideoGenerationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});
VideoGenerationSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
VideoGenerationSchema.pre("updateOne", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
VideoGenerationSchema.pre("updateMany", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

export type VideoGenerationDoc = InferSchemaType<typeof VideoGenerationSchema> & {
  _id: string;
};

export const VideoGeneration: Model<VideoGenerationDoc> =
  (mongoose.models.VideoGeneration as Model<VideoGenerationDoc>) ??
  mongoose.model<VideoGenerationDoc>("VideoGeneration", VideoGenerationSchema);
