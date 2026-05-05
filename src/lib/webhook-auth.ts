import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

export function signGid(generationId: string): string {
  const env = getEnv();
  if (!env.WEBHOOK_SECRET) return "";
  return createHmac("sha256", env.WEBHOOK_SECRET).update(generationId).digest("hex");
}

export function verifyGid(generationId: string, sig: string | null): boolean {
  const env = getEnv();
  if (!env.WEBHOOK_SECRET) return false;
  if (!sig || sig.length !== 64) return false;
  const expected = signGid(generationId);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}
