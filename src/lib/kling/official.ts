import { getEnv } from "../env";
import { logger } from "../logger";
import { KlingApiError, shouldRefreshToken } from "./errors";
import { getKlingToken, invalidateKlingToken } from "./jwt";
import type {
  CreateTaskResult,
  Image2VideoInput,
  ImageTaskQueryResult,
  ImageToImageInput,
  KlingProvider,
  KlingTaskStatus,
  MotionControlInput,
  MultiImage2VideoInput,
  SingleImage2ImageInput,
  TaskQueryResult,
} from "./types";

// Image generation uses Kling's "multi-image to image" endpoint. Even when we
// pass a single subject image (n=1), the spec requires the subject_image_list
// array shape.
const IMAGE_TO_IMAGE_CREATE_PATH = "/v1/images/multi-image2image";
const IMAGE_TO_IMAGE_QUERY_PATH = "/v1/images/multi-image2image";
// Single-subject image-to-image and text-to-image share Kling's
// /v1/images/generations endpoint. We pass `image` to switch from t2i to i2i.
const IMAGE_GENERATIONS_PATH = "/v1/images/generations";

type KlingEnvelope<T> = {
  code: number;
  message: string;
  request_id: string;
  data: T;
};

type CreateData = {
  task_id: string;
  task_status: KlingTaskStatus;
  task_info?: { external_task_id?: string };
  created_at: number;
  updated_at: number;
};

type QueryData = CreateData & {
  task_status_msg?: string;
  task_result?: {
    videos?: Array<{
      id: string;
      url: string;
      watermark_url?: string;
      duration: string;
    }>;
  };
  watermark_info?: { enabled: boolean };
  final_unit_deduction?: string;
};

type ImageQueryData = CreateData & {
  task_status_msg?: string;
  task_result?: {
    images?: Array<{
      index?: number;
      url: string;
      watermark_url?: string;
    }>;
  };
  watermark_info?: { enabled: boolean };
  final_unit_deduction?: string;
};

class OfficialKlingProvider implements KlingProvider {
  async createMotionControlTask(
    input: MotionControlInput,
  ): Promise<CreateTaskResult> {
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      image_url: input.imageUrl,
      video_url: input.videoUrl,
      keep_original_sound: input.keepOriginalSound === false ? "no" : "yes",
      character_orientation: input.characterOrientation,
      mode: input.mode,
      external_task_id: input.externalTaskId,
    };
    if (input.prompt) body.prompt = input.prompt;
    if (input.watermarkEnabled) body.watermark_info = { enabled: true };
    if (input.callbackUrl) body.callback_url = input.callbackUrl;

    const data = await this.request<CreateData>(
      "POST",
      "/v1/videos/motion-control",
      body,
    );

    return {
      providerTaskId: data.task_id,
      status: data.task_status,
      rawPayload: data,
    };
  }

  async getMotionControlTask(taskId: string): Promise<TaskQueryResult> {
    const data = await this.request<QueryData>(
      "GET",
      `/v1/videos/motion-control/${encodeURIComponent(taskId)}`,
    );

    const firstVideo = data.task_result?.videos?.[0];

    return {
      providerTaskId: data.task_id,
      externalTaskId: data.task_info?.external_task_id ?? null,
      status: data.task_status,
      statusMessage: data.task_status_msg ?? null,
      videoUrl: firstVideo?.url ?? null,
      watermarkVideoUrl: firstVideo?.watermark_url ?? null,
      videoDurationSec:
        firstVideo?.duration != null && Number.isFinite(Number(firstVideo.duration))
          ? Number(firstVideo.duration)
          : null,
      finalUnitDeduction: data.final_unit_deduction ?? null,
      rawPayload: data,
    };
  }

  async createImageToImageTask(
    input: ImageToImageInput,
  ): Promise<CreateTaskResult> {
    if (input.subjectImageUrls.length === 0 || input.subjectImageUrls.length > 4) {
      throw new Error("subjectImageUrls must contain between 1 and 4 entries");
    }
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      subject_image_list: input.subjectImageUrls.map((u) => ({ subject_image: u })),
      external_task_id: input.externalTaskId,
    };
    if (input.prompt) body.prompt = input.prompt;
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.sceneImageUrl) body.scene_image = input.sceneImageUrl;
    if (input.styleImageUrl) body.style_image = input.styleImageUrl;
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
    if (input.n != null) body.n = input.n;
    if (input.callbackUrl) body.callback_url = input.callbackUrl;

    const data = await this.request<CreateData>(
      "POST",
      IMAGE_TO_IMAGE_CREATE_PATH,
      body,
    );

    return {
      providerTaskId: data.task_id,
      status: data.task_status,
      rawPayload: data,
    };
  }

  async getImageToImageTask(taskId: string): Promise<ImageTaskQueryResult> {
    const data = await this.request<ImageQueryData>(
      "GET",
      `${IMAGE_TO_IMAGE_QUERY_PATH}/${encodeURIComponent(taskId)}`,
    );
    return mapImageQuery(data);
  }

  async createSingleImage2ImageTask(
    input: SingleImage2ImageInput,
  ): Promise<CreateTaskResult> {
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      prompt: input.prompt,
      image: input.imageUrl,
      external_task_id: input.externalTaskId,
    };
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.imageReference) body.image_reference = input.imageReference;
    if (input.imageFidelity != null) body.image_fidelity = input.imageFidelity;
    if (input.humanFidelity != null) body.human_fidelity = input.humanFidelity;
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
    if (input.n != null) body.n = input.n;
    if (input.callbackUrl) body.callback_url = input.callbackUrl;

    const data = await this.request<CreateData>(
      "POST",
      IMAGE_GENERATIONS_PATH,
      body,
    );

    return {
      providerTaskId: data.task_id,
      status: data.task_status,
      rawPayload: data,
    };
  }

  async getSingleImage2ImageTask(taskId: string): Promise<ImageTaskQueryResult> {
    const data = await this.request<ImageQueryData>(
      "GET",
      `${IMAGE_GENERATIONS_PATH}/${encodeURIComponent(taskId)}`,
    );
    return mapImageQuery(data);
  }

  async createMultiImage2VideoTask(
    input: MultiImage2VideoInput,
  ): Promise<CreateTaskResult> {
    if (input.imageUrls.length === 0 || input.imageUrls.length > 4) {
      throw new Error("imageUrls must contain between 1 and 4 entries");
    }
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      image_list: input.imageUrls.map((u) => ({ image: u })),
      prompt: input.prompt,
      mode: input.mode,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      external_task_id: input.externalTaskId,
    };
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.watermarkEnabled) body.watermark_info = { enabled: true };
    if (input.callbackUrl) body.callback_url = input.callbackUrl;

    const data = await this.request<CreateData>(
      "POST",
      "/v1/videos/multi-image2video",
      body,
    );

    return {
      providerTaskId: data.task_id,
      status: data.task_status,
      rawPayload: data,
    };
  }

  async getMultiImage2VideoTask(taskId: string): Promise<TaskQueryResult> {
    const data = await this.request<QueryData>(
      "GET",
      `/v1/videos/multi-image2video/${encodeURIComponent(taskId)}`,
    );
    return mapVideoQuery(data);
  }

  async createImage2VideoTask(
    input: Image2VideoInput,
  ): Promise<CreateTaskResult> {
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      image: input.imageUrl,
      mode: input.mode,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      external_task_id: input.externalTaskId,
    };
    if (input.tailImageUrl) body.image_tail = input.tailImageUrl;
    if (input.prompt) body.prompt = input.prompt;
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.cfgScale != null) body.cfg_scale = input.cfgScale;
    // Kling's official field is `generate_audio` (defaults to false on the
    // /v1/videos/image2video endpoint). Several wrapper APIs rename this
    // to `enable_audio`/`sound`/etc. on their own surface — those are NOT
    // Kling's wire field. Verified via fal.ai and aimlapi schemas, plus
    // an empirical run where `enable_audio: true` produced a 2.5-unit
    // (no-audio-rate) billing instead of 5 units.
    if (input.enableAudio) body.generate_audio = true;
    if (input.watermarkEnabled) body.watermark_info = { enabled: true };
    if (input.callbackUrl) body.callback_url = input.callbackUrl;

    const data = await this.request<CreateData>(
      "POST",
      "/v1/videos/image2video",
      body,
    );
    return {
      providerTaskId: data.task_id,
      status: data.task_status,
      rawPayload: data,
    };
  }

  async getImage2VideoTask(taskId: string): Promise<TaskQueryResult> {
    const data = await this.request<QueryData>(
      "GET",
      `/v1/videos/image2video/${encodeURIComponent(taskId)}`,
    );
    return mapVideoQuery(data);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const env = getEnv();
    const url = `${env.KLING_BASE_URL.replace(/\/+$/, "")}${path}`;
    const token = getKlingToken();

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    let envelope: KlingEnvelope<T> | undefined;
    try {
      envelope = (await res.json()) as KlingEnvelope<T>;
    } catch {
      throw new KlingApiError(
        -1,
        res.status,
        `Non-JSON response: ${res.status} ${res.statusText}`,
      );
    }

    if (!res.ok || envelope.code !== 0) {
      if (shouldRefreshToken(envelope.code) && attempt === 0) {
        invalidateKlingToken();
        logger.warn(
          { code: envelope.code, requestId: envelope.request_id },
          "Refreshing Kling JWT and retrying once",
        );
        return this.request<T>(method, path, body, 1);
      }

      throw new KlingApiError(
        envelope.code,
        res.status,
        envelope.message || `Kling API error ${envelope.code}`,
        envelope.request_id,
        envelope,
      );
    }

    return envelope.data;
  }
}

function mapVideoQuery(data: QueryData): TaskQueryResult {
  const firstVideo = data.task_result?.videos?.[0];
  return {
    providerTaskId: data.task_id,
    externalTaskId: data.task_info?.external_task_id ?? null,
    status: data.task_status,
    statusMessage: data.task_status_msg ?? null,
    videoUrl: firstVideo?.url ?? null,
    watermarkVideoUrl: firstVideo?.watermark_url ?? null,
    videoDurationSec:
      firstVideo?.duration != null && Number.isFinite(Number(firstVideo.duration))
        ? Number(firstVideo.duration)
        : null,
    finalUnitDeduction: data.final_unit_deduction ?? null,
    rawPayload: data,
  };
}

function mapImageQuery(data: ImageQueryData): ImageTaskQueryResult {
  const rawImages = data.task_result?.images ?? [];
  const images = rawImages.map((img, i) => ({
    index: img.index ?? i,
    url: img.url,
    watermarkUrl: img.watermark_url ?? null,
  }));
  return {
    providerTaskId: data.task_id,
    externalTaskId: data.task_info?.external_task_id ?? null,
    status: data.task_status,
    statusMessage: data.task_status_msg ?? null,
    imageUrl: images[0]?.url ?? null,
    images,
    finalUnitDeduction: data.final_unit_deduction ?? null,
    rawPayload: data,
  };
}

let _instance: OfficialKlingProvider | null = null;
export function getKlingProvider(): KlingProvider {
  if (!_instance) _instance = new OfficialKlingProvider();
  return _instance;
}
