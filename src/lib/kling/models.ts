/**
 * Kling image-generation model registry.
 *
 * Kling exposes several image endpoints with different model support and
 * pricing. We keep the source of truth here so the form, validation, pricing
 * sidebar, worker, and SDK all agree.
 *
 * Endpoints in this codebase:
 *   - "multi-image2image" → /v1/images/multi-image2image
 *     1–4 subject images plus optional scene/style. ≥2 refs total required.
 *   - "image2image" → /v1/images/generations  (with `image` field set)
 *     Single subject. The same endpoint also handles text-to-image when no
 *     image is supplied; we don't expose that mode yet.
 */

export type KlingImageEndpoint = "multi-image2image" | "image2image";

export type KlingImageModel =
  | "kling-v1"
  | "kling-v1-5"
  | "kling-v2"
  | "kling-v2-new"
  | "kling-v2-1";

/**
 * Reference type for /v1/images/generations when an image is supplied.
 * Only kling-v1-5 and kling-v2-1 honor this — others ignore it.
 */
export type KlingImageReference = "subject" | "face";

type ModelSpec = {
  label: string;
  /** Per-endpoint per-image pricing in USD (from Kling's pricing table). */
  pricePerImage: Partial<Record<KlingImageEndpoint, number>>;
  /** Whether this model accepts the optional image_reference parameter. */
  supportsImageReference: boolean;
  /** Order shown in dropdowns. Lower = first. */
  sortKey: number;
};

export const KLING_IMAGE_MODELS: Record<KlingImageModel, ModelSpec> = {
  "kling-v1": {
    label: "Kling v1",
    pricePerImage: { "image2image": 0.0035 },
    supportsImageReference: false,
    sortKey: 10,
  },
  "kling-v1-5": {
    label: "Kling v1.5",
    pricePerImage: { "image2image": 0.028 },
    supportsImageReference: true,
    sortKey: 20,
  },
  "kling-v2": {
    label: "Kling v2",
    pricePerImage: { "image2image": 0.028, "multi-image2image": 0.056 },
    supportsImageReference: false,
    sortKey: 30,
  },
  "kling-v2-new": {
    label: "Kling v2 (restyle)",
    pricePerImage: { "image2image": 0.028 },
    supportsImageReference: false,
    sortKey: 40,
  },
  "kling-v2-1": {
    label: "Kling v2.1",
    pricePerImage: { "image2image": 0.028, "multi-image2image": 0.056 },
    supportsImageReference: true,
    sortKey: 50,
  },
};

export function modelsForEndpoint(endpoint: KlingImageEndpoint): KlingImageModel[] {
  return (Object.keys(KLING_IMAGE_MODELS) as KlingImageModel[])
    .filter((m) => KLING_IMAGE_MODELS[m].pricePerImage[endpoint] != null)
    .sort((a, b) => KLING_IMAGE_MODELS[a].sortKey - KLING_IMAGE_MODELS[b].sortKey);
}

export function pricePerImage(
  model: KlingImageModel,
  endpoint: KlingImageEndpoint,
): number {
  return KLING_IMAGE_MODELS[model]?.pricePerImage[endpoint] ?? 0;
}

export function defaultModelForEndpoint(_endpoint: KlingImageEndpoint): KlingImageModel {
  return "kling-v2-1";
}

export function modelLabel(model: KlingImageModel): string {
  return KLING_IMAGE_MODELS[model]?.label ?? model;
}

export function modelSupportsImageReference(model: KlingImageModel): boolean {
  return KLING_IMAGE_MODELS[model]?.supportsImageReference ?? false;
}

/** All known model IDs as a tuple for Zod enums. */
export const ALL_KLING_IMAGE_MODELS = [
  "kling-v1",
  "kling-v1-5",
  "kling-v2",
  "kling-v2-new",
  "kling-v2-1",
] as const satisfies readonly KlingImageModel[];

export const ALL_KLING_IMAGE_ENDPOINTS = [
  "multi-image2image",
  "image2image",
] as const satisfies readonly KlingImageEndpoint[];
