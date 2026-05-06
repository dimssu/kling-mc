import { z } from "zod";

const schema = z.object({
  KLING_ACCESS_KEY: z.string().optional().default(""),
  KLING_SECRET_KEY: z.string().optional().default(""),
  KLING_BASE_URL: z.string().url().default("https://api-singapore.klingai.com"),
  KLING_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(1800),
  KLING_DEFAULT_MODEL: z.enum(["kling-v2-6", "kling-v3"]).default("kling-v2-6"),
  KLING_DEFAULT_MODE: z.enum(["std", "pro"]).default("std"),

  // MongoDB (Atlas or self-hosted). Same cluster as kling-gallery, different DB.
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("kling_mc"),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // AWS S3 (shared bucket with kling-gallery; key prefix `mc/` for this app).
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Public URL base (S3 virtual-hosted style or CloudFront), no trailing slash.
  S3_PUBLIC_URL_BASE: z.string().url(),

  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DEFAULT_USER_ID: z.string().default("local"),
  ENABLE_KLING_WEBHOOKS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  WEBHOOK_SECRET: z.string().default(""),

  MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().min(1).max(20).default(2),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Google Gemini for caption packs + image-prompt suggestions. Optional —
  // the LLM features no-op gracefully if unset.
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // Optional: kling-gallery sync. Used by scripts/sync-to-gallery.ts.
  GALLERY_INGEST_URL: z.string().url().optional().or(z.literal("")).default(""),
  GALLERY_INGEST_TOKEN: z.string().optional().default(""),
});

let cached: z.infer<typeof schema> | null = null;

export function getEnv() {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

export function getEnvLazy() {
  return new Proxy({} as ReturnType<typeof getEnv>, {
    get(_, prop: string) {
      return getEnv()[prop as keyof ReturnType<typeof getEnv>];
    },
  });
}
