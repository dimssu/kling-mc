import { z } from "zod";

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-quicktime",
] as const;

export const IMAGE_LIMITS = {
  maxSizeBytes: 10 * 1024 * 1024,
  minDimensionPx: 300,
  maxDimensionPx: 65536,
  minAspect: 1 / 2.5,
  maxAspect: 2.5,
} as const;

export const VIDEO_LIMITS = {
  maxSizeBytes: 100 * 1024 * 1024,
  minDimensionPx: 340,
  maxDimensionPx: 3850,
  minAspect: 1 / 2.5,
  maxAspect: 2.5,
  minDurationSec: 3,
  maxDurationSec: 30,
  maxDurationOrientationImage: 10,
  maxDurationOrientationVideo: 30,
} as const;

export type MediaValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateImageFile(input: {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}): MediaValidationResult {
  if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, reason: `Unsupported image format ${input.mimeType}. Use JPG/JPEG/PNG.` };
  }
  if (input.sizeBytes > IMAGE_LIMITS.maxSizeBytes) {
    return { ok: false, reason: `Image exceeds 10 MB (got ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB).` };
  }
  if (input.width != null && input.height != null) {
    if (input.width < IMAGE_LIMITS.minDimensionPx || input.height < IMAGE_LIMITS.minDimensionPx) {
      return { ok: false, reason: `Image dimensions must be ≥ ${IMAGE_LIMITS.minDimensionPx}px on each side.` };
    }
    if (input.width > IMAGE_LIMITS.maxDimensionPx || input.height > IMAGE_LIMITS.maxDimensionPx) {
      return { ok: false, reason: `Image dimensions must be ≤ ${IMAGE_LIMITS.maxDimensionPx}px on each side.` };
    }
    const aspect = input.width / input.height;
    if (aspect < IMAGE_LIMITS.minAspect || aspect > IMAGE_LIMITS.maxAspect) {
      return { ok: false, reason: `Image aspect ratio must be between 1:2.5 and 2.5:1.` };
    }
  }
  return { ok: true };
}

export function validateVideoFile(input: {
  mimeType: string;
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
  characterOrientation?: "image" | "video";
}): MediaValidationResult {
  if (!(SUPPORTED_VIDEO_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, reason: `Unsupported video format ${input.mimeType}. Use MP4/MOV.` };
  }
  if (input.sizeBytes > VIDEO_LIMITS.maxSizeBytes) {
    return { ok: false, reason: `Video exceeds 100 MB (got ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB).` };
  }
  if (input.durationSec != null) {
    if (input.durationSec < VIDEO_LIMITS.minDurationSec) {
      return { ok: false, reason: `Video must be at least ${VIDEO_LIMITS.minDurationSec} seconds.` };
    }
    if (input.durationSec > VIDEO_LIMITS.maxDurationSec) {
      return { ok: false, reason: `Video must be at most ${VIDEO_LIMITS.maxDurationSec} seconds.` };
    }
    if (input.characterOrientation === "image" && input.durationSec > VIDEO_LIMITS.maxDurationOrientationImage) {
      return {
        ok: false,
        reason: `When character orientation is "image", video must be ≤ ${VIDEO_LIMITS.maxDurationOrientationImage} seconds.`,
      };
    }
  }
  if (input.width != null && input.height != null) {
    if (input.width < VIDEO_LIMITS.minDimensionPx || input.height < VIDEO_LIMITS.minDimensionPx) {
      return { ok: false, reason: `Video dimensions must be ≥ ${VIDEO_LIMITS.minDimensionPx}px on each side.` };
    }
    if (input.width > VIDEO_LIMITS.maxDimensionPx || input.height > VIDEO_LIMITS.maxDimensionPx) {
      return { ok: false, reason: `Video dimensions must be ≤ ${VIDEO_LIMITS.maxDimensionPx}px on each side.` };
    }
    const aspect = input.width / input.height;
    if (aspect < VIDEO_LIMITS.minAspect || aspect > VIDEO_LIMITS.maxAspect) {
      return { ok: false, reason: `Video aspect ratio must be between 1:2.5 and 2.5:1.` };
    }
  }
  return { ok: true };
}

export const createGenerationSchema = z.object({
  sourceVideoId: z.string().min(1),
  referenceImageId: z.string().min(1),
  prompt: z.string().max(2500).optional(),
  modelName: z.enum(["kling-v2-6", "kling-v3"]),
  mode: z.enum(["std", "pro"]),
  characterOrientation: z.enum(["image", "video"]),
  keepOriginalSound: z.boolean().default(true),
  watermarkEnabled: z.boolean().default(false),
});

export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;

export const createImageGenerationSchema = z.object({
  referenceImageId: z.string().min(1),
  prompt: z.string().max(2500).optional(),
  negativePrompt: z.string().max(2500).optional(),
  modelName: z.enum(["kling-v2", "kling-v2-1"]),
  aspectRatio: z
    .enum(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"])
    .optional(),
  // Number of generated images, 1..9. v0 ships with 1.
  n: z.number().int().min(1).max(9).default(1),
});

export type CreateImageGenerationInput = z.infer<typeof createImageGenerationSchema>;
