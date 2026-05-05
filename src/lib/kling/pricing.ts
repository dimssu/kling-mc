export type KlingMode = "std" | "pro";
export type KlingModel = "kling-v2-6" | "kling-v3";

const RATE_USD_PER_5S: Record<KlingModel, Record<KlingMode, number>> = {
  "kling-v2-6": { std: 0.20, pro: 0.33 },
  "kling-v3": { std: 0.375, pro: 0.50 },
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

export function pricingTable() {
  return RATE_USD_PER_5S;
}
