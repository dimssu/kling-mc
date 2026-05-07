import type { KlingMode, KlingModel } from "./pricing";
import type { KlingImageModel, KlingImageReference } from "./models";

export type CharacterOrientation = "image" | "video";

export type MotionControlInput = {
  modelName: KlingModel;
  mode: KlingMode;
  characterOrientation: CharacterOrientation;
  imageUrl: string;
  videoUrl: string;
  prompt?: string;
  keepOriginalSound?: boolean;
  watermarkEnabled?: boolean;
  callbackUrl?: string;
  externalTaskId: string;
};

// Image-gen aspect ratios per the Kling multi-image2image spec.
export type KlingImageAspectRatio =
  | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";

export type ImageToImageInput = {
  modelName: KlingImageModel;
  // Required: 1–4 subject images. We keep them as URLs for the wire format
  // (worker resolves them from MediaAsset.storageKey via getKlingFetchUrl).
  subjectImageUrls: string[];
  // Optional reference images.
  sceneImageUrl?: string;
  styleImageUrl?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: KlingImageAspectRatio;
  n?: number; // 1–9, default 1
  callbackUrl?: string;
  externalTaskId: string;
};

/**
 * Input for /v1/images/generations with `image` set — i.e. single-subject
 * image-to-image. Same endpoint also handles text-to-image when `imageUrl`
 * is omitted, but we don't expose that mode yet.
 */
export type SingleImage2ImageInput = {
  modelName: KlingImageModel;
  imageUrl: string;
  prompt: string; // Required by Kling on this endpoint.
  negativePrompt?: string;
  imageReference?: KlingImageReference; // kling-v1-5 / kling-v2-1 only
  imageFidelity?: number; // 0..1, defaults Kling-side to 0.5
  humanFidelity?: number; // 0..1, face-reference only
  aspectRatio?: KlingImageAspectRatio;
  n?: number; // 1..9
  callbackUrl?: string;
  externalTaskId: string;
};

export type CreateTaskResult = {
  providerTaskId: string;
  status: KlingTaskStatus;
  rawPayload: unknown;
};

export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "failed";

export type TaskQueryResult = {
  providerTaskId: string;
  externalTaskId: string | null;
  status: KlingTaskStatus;
  statusMessage: string | null;
  videoUrl: string | null;
  watermarkVideoUrl: string | null;
  videoDurationSec: number | null;
  finalUnitDeduction: string | null;
  rawPayload: unknown;
};

export type GeneratedImage = {
  index: number;
  url: string;
  watermarkUrl: string | null;
};

export type ImageTaskQueryResult = {
  providerTaskId: string;
  externalTaskId: string | null;
  status: KlingTaskStatus;
  statusMessage: string | null;
  // First image, for the common n=1 path.
  imageUrl: string | null;
  // Full list when n>1.
  images: GeneratedImage[];
  finalUnitDeduction: string | null;
  rawPayload: unknown;
};

// /v1/videos/image2video — generate a video from a single image (with optional
// end frame). The endpoint accepts a wider model menu than multi-image2video.
// We expose the std/pro tier here; Master models and v3.0 (per-second pricing)
// are deferred until they earn a separate flow.
export type KlingImage2VideoModel =
  | "kling-v1"
  | "kling-v1-5"
  | "kling-v1-6"
  | "kling-v2-1"
  | "kling-v2-5-turbo"
  | "kling-v2-6";

export type KlingImage2VideoMode = "std" | "pro";
export type KlingImage2VideoDuration = "5" | "10";

export type Image2VideoInput = {
  modelName: KlingImage2VideoModel;
  mode: KlingImage2VideoMode;
  duration: KlingImage2VideoDuration;
  aspectRatio: KlingVideoAspectRatio;
  imageUrl: string;
  /** Optional end-frame image. If supplied, the generated video transitions
   *  from `imageUrl` (start frame) to `tailImageUrl` (end frame). */
  tailImageUrl?: string;
  prompt?: string;
  negativePrompt?: string;
  /** Optional 0..1 — controls how strictly the prompt is followed. */
  cfgScale?: number;
  watermarkEnabled?: boolean;
  callbackUrl?: string;
  externalTaskId: string;
};

// /v1/videos/multi-image2video — generate a video from up to 4 reference images.
export type KlingMultiImage2VideoModel = "kling-v1-6";
export type KlingMultiImage2VideoMode = "std" | "pro";
export type KlingMultiImage2VideoDuration = "5" | "10";
export type KlingVideoAspectRatio = "16:9" | "9:16" | "1:1";

export type MultiImage2VideoInput = {
  modelName: KlingMultiImage2VideoModel;
  mode: KlingMultiImage2VideoMode;
  duration: KlingMultiImage2VideoDuration;
  aspectRatio: KlingVideoAspectRatio;
  // 1–4 reference images (URLs we hand Kling to fetch).
  imageUrls: string[];
  prompt: string;
  negativePrompt?: string;
  watermarkEnabled?: boolean;
  callbackUrl?: string;
  externalTaskId: string;
};

export interface KlingProvider {
  createMotionControlTask(input: MotionControlInput): Promise<CreateTaskResult>;
  getMotionControlTask(taskId: string): Promise<TaskQueryResult>;
  createImageToImageTask(input: ImageToImageInput): Promise<CreateTaskResult>;
  getImageToImageTask(taskId: string): Promise<ImageTaskQueryResult>;
  createSingleImage2ImageTask(input: SingleImage2ImageInput): Promise<CreateTaskResult>;
  getSingleImage2ImageTask(taskId: string): Promise<ImageTaskQueryResult>;
  createMultiImage2VideoTask(input: MultiImage2VideoInput): Promise<CreateTaskResult>;
  getMultiImage2VideoTask(taskId: string): Promise<TaskQueryResult>;
  createImage2VideoTask(input: Image2VideoInput): Promise<CreateTaskResult>;
  getImage2VideoTask(taskId: string): Promise<TaskQueryResult>;
}
