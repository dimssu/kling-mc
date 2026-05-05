import type { KlingMode, KlingModel } from "./pricing";

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

export interface KlingProvider {
  createMotionControlTask(input: MotionControlInput): Promise<CreateTaskResult>;
  getMotionControlTask(taskId: string): Promise<TaskQueryResult>;
}
