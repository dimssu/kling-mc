import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const ImageGenerationSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    ownerId: { type: String, required: true },
    status: { type: String, required: true },
    provider: { type: String, default: "kling_official" },
    providerTaskId: { type: String, default: null, index: { unique: true, sparse: true } },
    externalTaskId: { type: String, required: true, index: { unique: true } },
    endpoint: { type: String, default: "multi-image2image" },

    subjectImageIds: { type: [String], default: [] },
    sceneImageId: { type: String, default: null },
    styleImageId: { type: String, default: null },
    outputAssetId: { type: String, default: null, index: { unique: true, sparse: true } },

    prompt: { type: String, default: null },
    negativePrompt: { type: String, default: null },
    modelName: { type: String, required: true },
    aspectRatio: { type: String, default: null },
    n: { type: Number, default: 1 },
    imageReference: { type: String, default: null },

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

    // Carousel membership
    carouselId: { type: String, default: null },
    slotIndex: { type: Number, default: null },
    poseLabel: { type: String, default: null },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false },
);

ImageGenerationSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
ImageGenerationSchema.index({ ownerId: 1, isFavorite: 1 });
ImageGenerationSchema.index({ status: 1, submittedAt: 1 });
ImageGenerationSchema.index({ carouselId: 1, slotIndex: 1 });

ImageGenerationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});
ImageGenerationSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
ImageGenerationSchema.pre("updateOne", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
ImageGenerationSchema.pre("updateMany", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

export type ImageGenerationDoc = InferSchemaType<typeof ImageGenerationSchema> & {
  _id: string;
};

export const ImageGeneration: Model<ImageGenerationDoc> =
  (mongoose.models.ImageGeneration as Model<ImageGenerationDoc>) ??
  mongoose.model<ImageGenerationDoc>("ImageGeneration", ImageGenerationSchema);
