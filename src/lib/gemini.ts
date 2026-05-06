import { GoogleGenAI, Type } from "@google/genai";
import { getEnv } from "./env";
import { logger } from "./logger";
import { siyaBriefing, pickRandomCategory, PROMPT_CATEGORIES } from "./siya-profile";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local to use the LLM features.",
    );
  }
  _client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _client;
}

export function isLlmConfigured(): boolean {
  try {
    const env = getEnv();
    return !!env.GEMINI_API_KEY;
  } catch {
    return false;
  }
}

export type CaptionPack = {
  caption: string;
  tags: string[];
  location: string;
  accessibilityText: string;
};

export type CaptionPackInput = {
  // What kind of media we're captioning.
  mediaKind: "video" | "image";
  // Free-text description of what the user generated. We pass the prompt and
  // a short description of the references so the caption sounds informed.
  prompt?: string | null;
  // Optional facts we know about the output (helps with realism).
  facts?: {
    aspectRatio?: string | null;
    durationSec?: number | null;
    location?: string | null; // pre-set if user typed one
  };
};

const CAPTION_RULES = [
  "Caption: 1–2 short lines, max ~140 chars TOTAL. No long paragraphs. Match her register: confident, observant, slightly mysterious. Soft tease, never thirsty.",
  "Tags: 6–10 hashtags WITHOUT the # symbol — the UI adds it. Mix lifestyle / aesthetic / location-flavoured. No spammy growth tags.",
  "Location: a real-feeling place tag (city, neighbourhood, venue) consistent with her bases (Sydney primary, Melbourne, Bali). Make it specific but plausible.",
  "Accessibility text (alt text): one factual sentence, 80–140 chars, describing the visible content for screen readers. NO persona voice in alt text — it's literal description.",
];

const CAPTION_SCHEMA = {
  type: Type.OBJECT,
  required: ["caption", "tags", "location", "accessibilityText"],
  properties: {
    caption: { type: Type.STRING },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    location: { type: Type.STRING },
    accessibilityText: { type: Type.STRING },
  },
};

export async function generateCaptionPack(input: CaptionPackInput): Promise<CaptionPack> {
  const env = getEnv();
  const client = getClient();
  const briefing = siyaBriefing();

  const userBlock = [
    `Media type: ${input.mediaKind}`,
    input.prompt ? `Generation prompt: "${input.prompt}"` : null,
    input.facts?.aspectRatio ? `Aspect ratio: ${input.facts.aspectRatio}` : null,
    input.facts?.durationSec != null ? `Duration: ${input.facts.durationSec}s` : null,
    input.facts?.location ? `Pre-set location hint: ${input.facts.location}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    briefing,
    "",
    "Task: write a social-post caption pack for the media described below. Output strict JSON matching the provided schema.",
    "",
    "Rules:",
    ...CAPTION_RULES.map((r) => `- ${r}`),
    "",
    "Media context:",
    userBlock,
  ].join("\n");

  const res = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.85,
      responseMimeType: "application/json",
      responseSchema: CAPTION_SCHEMA,
    },
  });

  const text = res.text ?? "";
  const parsed = JSON.parse(text) as CaptionPack;
  return {
    caption: String(parsed.caption ?? "").trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean)
      : [],
    location: String(parsed.location ?? "").trim(),
    accessibilityText: String(parsed.accessibilityText ?? "").trim(),
  };
}

export type SuggestedPrompt = {
  prompt: string;
  negativePrompt: string;
  categoryKey: string;
  categoryLabel: string;
  vibe: string;
};

const PROMPT_SCHEMA = {
  type: Type.OBJECT,
  required: ["prompt", "negativePrompt", "vibe"],
  properties: {
    prompt: { type: Type.STRING },
    negativePrompt: { type: Type.STRING },
    vibe: { type: Type.STRING },
  },
};

const PROMPT_RULES = [
  "Write ONE detailed image-generation prompt (50–120 words) describing a single photograph of Siya — a real-looking, cinematic shot.",
  "Be visual and specific: lighting, time of day, location, wardrobe, pose, framing, lens feel, mood. Avoid abstract adjectives.",
  "She is the only subject unless the category implies otherwise. Always cohesive with her brand.",
  "Do NOT invent ages, names, or product names. Do NOT include hashtags or social copy.",
  "End the prompt with a one-line camera/lens hint (e.g. '85mm portrait, shallow depth of field, soft natural light').",
  "Also produce a tight negativePrompt (10–25 short phrases, comma-separated) that suppresses common image-gen failure modes for this scene: things like deformed hands, extra fingers, low quality, blurry, oversaturated, plastic skin, multiple people, watermark, text. Tailor a couple of items to the category (e.g. for night scenes add 'harsh flash, overexposed', for café shots add 'stock photo, cluttered table').",
];

/**
 * Returns a fresh image-generation prompt aligned with Siya's profile.
 * Each call rolls a category from PROMPT_CATEGORIES so successive Suggest
 * clicks produce visibly different posts.
 */
export async function suggestImagePrompt(opts?: {
  avoidCategories?: string[];
}): Promise<SuggestedPrompt> {
  const env = getEnv();
  const client = getClient();
  const briefing = siyaBriefing();

  // Pick a category, optionally avoiding recently-used ones.
  const pool = opts?.avoidCategories
    ? PROMPT_CATEGORIES.filter((c) => !opts.avoidCategories!.includes(c.key))
    : PROMPT_CATEGORIES;
  const cat =
    pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : pickRandomCategory();

  const prompt = [
    briefing,
    "",
    `Task: produce a single image-generation prompt in the "${cat.label}" category. Vibe hint: ${cat.hint}.`,
    "",
    "Rules:",
    ...PROMPT_RULES.map((r) => `- ${r}`),
    "",
    "Return strict JSON: { prompt: string, negativePrompt: string, vibe: string }. The 'vibe' field is 3-6 words describing the post's mood (e.g. 'quiet rooftop confidence').",
  ].join("\n");

  const res = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 1.0,
      topP: 0.95,
      responseMimeType: "application/json",
      responseSchema: PROMPT_SCHEMA,
    },
  });

  const text = res.text ?? "";
  let parsed: { prompt?: string; negativePrompt?: string; vibe?: string };
  try {
    parsed = JSON.parse(text) as { prompt?: string; negativePrompt?: string; vibe?: string };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, text }, "Gemini prompt JSON parse failed");
    throw new Error("Couldn't parse the suggestion. Try again.");
  }
  return {
    prompt: String(parsed.prompt ?? "").trim(),
    negativePrompt: String(parsed.negativePrompt ?? "").trim(),
    categoryKey: cat.key,
    categoryLabel: cat.label,
    vibe: String(parsed.vibe ?? "").trim(),
  };
}
