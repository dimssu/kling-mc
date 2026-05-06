export type KlingMode = "std" | "pro";
export type KlingModel = "kling-v2-6" | "kling-v3";

// Video rates: USD per 5 seconds of generated output (motion control etc.)
const RATE_USD_PER_5S: Record<KlingModel, Record<KlingMode, number>> = {
  "kling-v2-6": { std: 0.20, pro: 0.33 },
  "kling-v3": { std: 0.375, pro: 0.50 },
};

// Image-gen uses a different model namespace from motion-control video.
// Pricing varies per (model, endpoint) — see models.ts for the full registry.
// This file re-exports the model type and adds USD-cost helpers.
import {
  type KlingImageEndpoint,
  type KlingImageModel as RegistryImageModel,
  KLING_IMAGE_MODELS,
  pricePerImage,
} from "./models";

export type KlingImageModel = RegistryImageModel;

export function estimateCostUsd(
  model: KlingModel,
  mode: KlingMode,
  durationSec: number,
): number {
  const ratePer5s = RATE_USD_PER_5S[model]?.[mode];
  if (ratePer5s == null) return 0;
  const seconds = Math.max(1, Math.round(durationSec));
  return Number(((seconds / 5) * ratePer5s).toFixed(4));
}

export function deductionToUsd(
  model: KlingModel,
  mode: KlingMode,
  finalUnitDeduction: string | null | undefined,
  fallbackDurationSec: number,
): number | null {
  const units = finalUnitDeduction == null ? NaN : Number(finalUnitDeduction);
  if (!Number.isFinite(units)) {
    return estimateCostUsd(model, mode, fallbackDurationSec);
  }
  return estimateCostUsd(model, mode, units);
}

export function estimateImageCostUsd(
  model: KlingImageModel,
  n = 1,
  endpoint: KlingImageEndpoint = "multi-image2image",
): number {
  const rate = pricePerImage(model, endpoint);
  return Number((rate * Math.max(1, n)).toFixed(4));
}

export function imageDeductionToUsd(
  model: KlingImageModel,
  finalUnitDeduction: string | null | undefined,
  n = 1,
  endpoint: KlingImageEndpoint = "multi-image2image",
): number | null {
  const rate = pricePerImage(model, endpoint);
  if (finalUnitDeduction == null) return estimateImageCostUsd(model, n, endpoint);
  const units = Number(finalUnitDeduction);
  if (!Number.isFinite(units)) return estimateImageCostUsd(model, n, endpoint);
  return Number((units * rate).toFixed(4));
}

export function pricingTable() {
  return RATE_USD_PER_5S;
}

// Multi-image-to-video uses kling-v1-6. Pricing here mirrors Kling's published
// rates for image-to-video on v1-6 — this is a per-5-second figure and the
// final deduction is reconciled on completion via finalUnitDeduction.
import type {
  KlingMultiImage2VideoMode,
  KlingMultiImage2VideoModel,
} from "./types";

const MULTI_IMAGE_VIDEO_RATE_USD_PER_5S: Record<
  KlingMultiImage2VideoModel,
  Record<KlingMultiImage2VideoMode, number>
> = {
  "kling-v1-6": { std: 0.28, pro: 0.49 },
};

export function estimateMultiImage2VideoCostUsd(
  model: KlingMultiImage2VideoModel,
  mode: KlingMultiImage2VideoMode,
  durationSec: number,
): number {
  const ratePer5s = MULTI_IMAGE_VIDEO_RATE_USD_PER_5S[model]?.[mode];
  if (ratePer5s == null) return 0;
  const seconds = Math.max(1, Math.round(durationSec));
  return Number(((seconds / 5) * ratePer5s).toFixed(4));
}

export function multiImage2VideoDeductionToUsd(
  model: KlingMultiImage2VideoModel,
  mode: KlingMultiImage2VideoMode,
  finalUnitDeduction: string | null | undefined,
  fallbackDurationSec: number,
): number | null {
  const units = finalUnitDeduction == null ? NaN : Number(finalUnitDeduction);
  if (!Number.isFinite(units)) {
    return estimateMultiImage2VideoCostUsd(model, mode, fallbackDurationSec);
  }
  return estimateMultiImage2VideoCostUsd(model, mode, units);
}

export function multiImage2VideoPricingTable() {
  return MULTI_IMAGE_VIDEO_RATE_USD_PER_5S;
}

export function imagePricingTable() {
  // Flatten the registry into a {model: rate} map keyed by primary endpoint
  // so callers that don't care about endpoint dispatch still get useful data.
  const out: Record<string, number> = {};
  for (const [model, spec] of Object.entries(KLING_IMAGE_MODELS)) {
    // Prefer the highest-fidelity endpoint price (multi-image2image > image2image).
    out[model] =
      spec.pricePerImage["multi-image2image"] ??
      spec.pricePerImage["image2image"] ??
      0;
  }
  return out;
}
