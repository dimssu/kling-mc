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
  KlingImage2VideoMode,
  KlingImage2VideoModel,
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

// /v1/videos/image2video — single image to video, broad model menu.
// Per-5-second rates, derived from Kling's prepaid resource package table.
const IMAGE_2_VIDEO_RATE_USD_PER_5S: Record<
  KlingImage2VideoModel,
  Record<KlingImage2VideoMode, number>
> = {
  "kling-v1": { std: 0.14, pro: 0.49 },
  "kling-v1-5": { std: 0.28, pro: 0.49 },
  "kling-v1-6": { std: 0.28, pro: 0.49 },
  "kling-v2-1": { std: 0.28, pro: 0.49 },
  "kling-v2-5-turbo": { std: 0.21, pro: 0.35 },
  "kling-v2-6": { std: 0.21, pro: 0.35 },
};

const IMAGE_2_VIDEO_UNITS_PER_5S: Record<
  KlingImage2VideoModel,
  Record<KlingImage2VideoMode, number>
> = {
  "kling-v1": { std: 1, pro: 3.5 },
  "kling-v1-5": { std: 2, pro: 3.5 },
  "kling-v1-6": { std: 2, pro: 3.5 },
  "kling-v2-1": { std: 2, pro: 3.5 },
  "kling-v2-5-turbo": { std: 1.5, pro: 2.5 },
  "kling-v2-6": { std: 1.5, pro: 2.5 },
};

/**
 * Native-audio surcharge multiplier. Per Kling's price table:
 *   V2.6 Pro 5s no audio:    2.5 u / $0.35
 *   V2.6 Pro 5s with audio:  5.0 u / $0.70   ← exactly 2× pro
 * Only V2.6 Pro supports audio; every other (model, mode) combination
 * ignores enableAudio entirely.
 */
function audioMultiplier(
  model: KlingImage2VideoModel,
  mode: KlingImage2VideoMode,
  enableAudio: boolean,
): number {
  if (!enableAudio) return 1;
  if (model === "kling-v2-6" && mode === "pro") return 2;
  return 1;
}

export function audioSupported(
  model: KlingImage2VideoModel,
  mode: KlingImage2VideoMode,
): boolean {
  return model === "kling-v2-6" && mode === "pro";
}

export function estimateImage2VideoCostUsd(
  model: KlingImage2VideoModel,
  mode: KlingImage2VideoMode,
  durationSec: number,
  enableAudio = false,
): number {
  const ratePer5s = IMAGE_2_VIDEO_RATE_USD_PER_5S[model]?.[mode];
  if (ratePer5s == null) return 0;
  const seconds = Math.max(1, Math.round(durationSec));
  const mult = audioMultiplier(model, mode, enableAudio);
  return Number(((seconds / 5) * ratePer5s * mult).toFixed(4));
}

export function estimateImage2VideoUnits(
  model: KlingImage2VideoModel,
  mode: KlingImage2VideoMode,
  durationSec: number,
  enableAudio = false,
): number {
  const ratePer5s = IMAGE_2_VIDEO_UNITS_PER_5S[model]?.[mode];
  if (ratePer5s == null) return 0;
  const seconds = Math.max(1, Math.round(durationSec));
  const mult = audioMultiplier(model, mode, enableAudio);
  return Number(((seconds / 5) * ratePer5s * mult).toFixed(2));
}

export function image2VideoDeductionToUsd(
  model: KlingImage2VideoModel,
  mode: KlingImage2VideoMode,
  finalUnitDeduction: string | null | undefined,
  fallbackDurationSec: number,
  enableAudio = false,
): number | null {
  // The unit:USD ratio is constant per (model, mode) — audio scales both sides
  // by the same multiplier, so the conversion factor doesn't shift.
  const usdPer5s = IMAGE_2_VIDEO_RATE_USD_PER_5S[model]?.[mode];
  const unitsPer5s = IMAGE_2_VIDEO_UNITS_PER_5S[model]?.[mode];
  if (usdPer5s == null || unitsPer5s == null) return null;
  const units = finalUnitDeduction == null ? NaN : Number(finalUnitDeduction);
  if (!Number.isFinite(units)) {
    return estimateImage2VideoCostUsd(model, mode, fallbackDurationSec, enableAudio);
  }
  return Number((units * (usdPer5s / unitsPer5s)).toFixed(4));
}

export function image2VideoPricingTable() {
  return {
    usd: IMAGE_2_VIDEO_RATE_USD_PER_5S,
    units: IMAGE_2_VIDEO_UNITS_PER_5S,
  };
}

// Same idea for multi-image2video: surface the unit cost the user actually
// pays against their resource package.
const MULTI_IMAGE_VIDEO_UNITS_PER_5S: Record<
  KlingMultiImage2VideoModel,
  Record<KlingMultiImage2VideoMode, number>
> = {
  "kling-v1-6": { std: 2, pro: 3.5 },
};

export function estimateMultiImage2VideoUnits(
  model: KlingMultiImage2VideoModel,
  mode: KlingMultiImage2VideoMode,
  durationSec: number,
): number {
  const ratePer5s = MULTI_IMAGE_VIDEO_UNITS_PER_5S[model]?.[mode];
  if (ratePer5s == null) return 0;
  const seconds = Math.max(1, Math.round(durationSec));
  return Number(((seconds / 5) * ratePer5s).toFixed(2));
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
