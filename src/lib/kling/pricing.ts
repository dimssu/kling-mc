export type KlingMode = "std" | "pro";
export type KlingModel = "kling-v2-6" | "kling-v3";

// Video rates: USD per 5 seconds of generated output (motion control etc.)
const RATE_USD_PER_5S: Record<KlingModel, Record<KlingMode, number>> = {
  "kling-v2-6": { std: 0.20, pro: 0.33 },
  "kling-v3": { std: 0.375, pro: 0.50 },
};

// Image-gen uses a different model namespace (kling-v2 / kling-v2-1) than
// motion-control video (kling-v2-6 / kling-v3). Per-image rates below are
// placeholders — override once you confirm your account's actual pricing.
export type KlingImageModel = "kling-v2" | "kling-v2-1";
const IMAGE_RATE_USD: Record<KlingImageModel, number> = {
  "kling-v2": 0.014,
  "kling-v2-1": 0.020,
};

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

export function estimateImageCostUsd(model: KlingImageModel, n = 1): number {
  const rate = IMAGE_RATE_USD[model] ?? 0;
  return Number((rate * Math.max(1, n)).toFixed(4));
}

export function imageDeductionToUsd(
  model: KlingImageModel,
  finalUnitDeduction: string | null | undefined,
  n = 1,
): number | null {
  if (finalUnitDeduction == null) return estimateImageCostUsd(model, n);
  const units = Number(finalUnitDeduction);
  if (!Number.isFinite(units)) return estimateImageCostUsd(model, n);
  // Treat each "unit" as one image at the model's rate.
  return Number((units * (IMAGE_RATE_USD[model] ?? 0)).toFixed(4));
}

export function pricingTable() {
  return RATE_USD_PER_5S;
}

export function imagePricingTable() {
  return IMAGE_RATE_USD;
}
