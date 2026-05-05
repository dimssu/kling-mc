import { getEnv } from "../env";
import { logger } from "../logger";
import { KlingApiError, shouldRefreshToken } from "./errors";
import { getKlingToken, invalidateKlingToken } from "./jwt";
import type {
  CreateTaskResult,
  ImageTaskQueryResult,
  ImageToImageInput,
  KlingProvider,
  KlingTaskStatus,
  MotionControlInput,
  TaskQueryResult,
} from "./types";

// PLACEHOLDER paths and field names for the Kling image-to-image endpoint.
// I haven't been able to fetch the verbatim spec for this endpoint yet — these
// are extrapolated from Kling's other documented endpoints (Motion Control,
// Lip-Sync) and from third-party aggregators that wrap the same model.
// Verify against the official portal before relying on it for production.
const IMAGE_TO_IMAGE_CREATE_PATH = "/v1/images/generations";
const IMAGE_TO_IMAGE_QUERY_PATH = "/v1/images/generations";

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
    }>;
  };
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
    const body: Record<string, unknown> = {
      model_name: input.modelName,
      image: input.imageUrl,
      external_task_id: input.externalTaskId,
    };
    if (input.prompt) body.prompt = input.prompt;
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.imageFidelity != null) body.image_fidelity = input.imageFidelity;
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
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

    const firstImage = data.task_result?.images?.[0];

    return {
      providerTaskId: data.task_id,
      externalTaskId: data.task_info?.external_task_id ?? null,
      status: data.task_status,
      statusMessage: data.task_status_msg ?? null,
      imageUrl: firstImage?.url ?? null,
      finalUnitDeduction: data.final_unit_deduction ?? null,
      rawPayload: data,
    };
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

let _instance: OfficialKlingProvider | null = null;
export function getKlingProvider(): KlingProvider {
  if (!_instance) _instance = new OfficialKlingProvider();
  return _instance;
}
