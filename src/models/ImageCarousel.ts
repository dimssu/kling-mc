import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const ImageCarouselSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    ownerId: { type: String, required: true },
    status: { type: String, required: true }, // queued | processing | partial | completed | failed
    n: { type: Number, required: true },
    themePrompt: { type: String, default: null },
    vibeLabel: { type: String, default: null },
    subjectImageId: { type: String, required: true },
    modelName: { type: String, required: true },
    endpoint: { type: String, default: "image2image" },
    imageReference: { type: String, default: null },
    aspectRatio: { type: String, default: null },
    estimatedCostUsd: { type: Number, required: true },

    // Unified caption pack for the carousel as a whole.
    caption: { type: String, default: null },
    captionTags: { type: [String], default: [] },
    captionLocation: { type: String, default: null },
    captionAccessibility: { type: String, default: null },
    captionGeneratedAt: { type: Date, default: null },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
  },
  { _id: false, versionKey: false },
);

ImageCarouselSchema.index({ ownerId: 1, createdAt: -1 });
ImageCarouselSchema.index({ status: 1 });

ImageCarouselSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});
ImageCarouselSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
ImageCarouselSchema.pre("updateOne", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
ImageCarouselSchema.pre("updateMany", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

export type ImageCarouselDoc = InferSchemaType<typeof ImageCarouselSchema> & { _id: string };

export const ImageCarousel: Model<ImageCarouselDoc> =
  (mongoose.models.ImageCarousel as Model<ImageCarouselDoc>) ??
  mongoose.model<ImageCarouselDoc>("ImageCarousel", ImageCarouselSchema);
