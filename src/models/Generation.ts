import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const GenerationSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    ownerId: { type: String, required: true },
    status: { type: String, required: true }, // queued | processing | completed | failed
    provider: { type: String, default: "kling_official" },
    providerTaskId: { type: String, default: null, index: { unique: true, sparse: true } },
    externalTaskId: { type: String, required: true, index: { unique: true } },
    sourceVideoId: { type: String, required: true },
    referenceImageId: { type: String, required: true },
    outputAssetId: { type: String, default: null, index: { unique: true, sparse: true } },
    prompt: { type: String, default: null },
    modelName: { type: String, required: true },
    mode: { type: String, required: true },
    characterOrientation: { type: String, required: true },
    keepOriginalSound: { type: Boolean, default: true },
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

GenerationSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
GenerationSchema.index({ ownerId: 1, isFavorite: 1 });
GenerationSchema.index({ status: 1, submittedAt: 1 });

GenerationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});
GenerationSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
GenerationSchema.pre("updateOne", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
GenerationSchema.pre("updateMany", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

export type GenerationDoc = InferSchemaType<typeof GenerationSchema> & { _id: string };

export const Generation: Model<GenerationDoc> =
  (mongoose.models.Generation as Model<GenerationDoc>) ??
  mongoose.model<GenerationDoc>("Generation", GenerationSchema);
