import jwt from "jsonwebtoken";
import { getEnv } from "../env";

let cached: { token: string; expiresAt: number } | null = null;

export function getKlingToken(now = Math.floor(Date.now() / 1000)): string {
  if (cached && cached.expiresAt - now > 60) return cached.token;

  const env = getEnv();
  const exp = now + env.KLING_TOKEN_TTL_SECONDS;
  const payload = {
    iss: env.KLING_ACCESS_KEY,
    exp,
    nbf: now - 5,
  };
  const token = jwt.sign(payload, env.KLING_SECRET_KEY, {
    algorithm: "HS256",
    noTimestamp: true,
  });

  cached = { token, expiresAt: exp };
  return token;
}

export function invalidateKlingToken(): void {
  cached = null;
}
