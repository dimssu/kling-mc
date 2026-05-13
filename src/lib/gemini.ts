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

export type CarouselSlidePrompt = {
  prompt: string;
  negativePrompt: string;
  poseLabel: string;
};

export type CarouselPosePrompts = {
  vibeLabel: string;
  vibe: string;
  slides: CarouselSlidePrompt[];
};

const CAROUSEL_POSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["vibeLabel", "vibe", "slides"],
  properties: {
    vibeLabel: { type: Type.STRING },
    vibe: { type: Type.STRING },
    slides: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["prompt", "negativePrompt", "poseLabel"],
        properties: {
          prompt: { type: Type.STRING },
          negativePrompt: { type: Type.STRING },
          poseLabel: { type: Type.STRING },
        },
      },
    },
  },
};

const CAROUSEL_POSE_RULES = [
  "All slides must share the SAME vibe — same wardrobe, same lighting register, same overall location/setting feel. Vary ONLY pose, expression, framing, and small micro-gesture per slide.",
  "Each slide's prompt is 50–110 words: visual, specific, cinematic. Lighting + lens hint included. Do NOT invent ages, names, or product names.",
  "No two slides should describe the same pose/expression. Use a mix: walking, looking back, soft smile, eyes closed, side profile, hands in hair, candid laugh, contemplative gaze, mid-stride, leaning, etc.",
  "End each prompt with a one-line camera/lens hint (e.g. '85mm portrait, shallow depth of field, soft natural light').",
  "Each slide gets its own tight negativePrompt (10–25 short comma-separated phrases) suppressing image-gen failure modes — deformed hands, extra fingers, low quality, blurry, multiple people, watermark, text, oversaturation, plastic skin. Tailor a couple of phrases per slide based on its specific pose.",
  "poseLabel: 2–4 words describing the slide's pose/expression (e.g. 'looking back, soft smile').",
];

/**
 * Plans a carousel of n distinct pose/expression prompts in one Gemini call.
 * The model sees all n at once so it can self-deduplicate and keep them
 * coherent under a shared vibe.
 */
export async function suggestCarouselPosePrompts(opts: {
  theme?: string;
  n: number;
}): Promise<CarouselPosePrompts> {
  const env = getEnv();
  const client = getClient();
  const briefing = siyaBriefing();
  const n = Math.max(2, Math.min(20, Math.floor(opts.n)));

  // If the user did not provide a theme, sample a category to give the model
  // a unifying anchor.
  const fallback = pickRandomCategory();
  const themeBlock = opts.theme?.trim()
    ? `User-provided theme (use this verbatim as the unifying vibe): "${opts.theme.trim()}"`
    : `No theme provided. Use the "${fallback.label}" category as the unifying vibe (hint: ${fallback.hint}).`;

  const prompt = [
    briefing,
    "",
    `Task: plan a social-media carousel of EXACTLY ${n} image-generation prompts for Siya.`,
    "All slides feature Siya as the only subject. Same person, same outfit, same overall setting and lighting. Each slide is a distinct pose/expression beat.",
    "",
    themeBlock,
    "",
    "Rules:",
    ...CAROUSEL_POSE_RULES.map((r) => `- ${r}`),
    "",
    `Return strict JSON: { vibeLabel: string (2-5 words), vibe: string (one short sentence), slides: array of length ${n} of { prompt, negativePrompt, poseLabel } }.`,
  ].join("\n");

  const res = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.95,
      topP: 0.95,
      responseMimeType: "application/json",
      responseSchema: CAROUSEL_POSE_SCHEMA,
    },
  });

  const text = res.text ?? "";
  let parsed: {
    vibeLabel?: string;
    vibe?: string;
    slides?: Array<{ prompt?: string; negativePrompt?: string; poseLabel?: string }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, text },
      "Gemini carousel JSON parse failed",
    );
    throw new Error("Couldn't plan the carousel. Try again.");
  }

  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
  if (slides.length !== n) {
    throw new Error(
      `Carousel planning returned ${slides.length} slides, expected ${n}. Try again.`,
    );
  }

  return {
    vibeLabel: String(parsed.vibeLabel ?? fallback.label).trim(),
    vibe: String(parsed.vibe ?? "").trim(),
    slides: slides.map((s) => ({
      prompt: String(s.prompt ?? "").trim(),
      negativePrompt: String(s.negativePrompt ?? "").trim(),
      poseLabel: String(s.poseLabel ?? "").trim(),
    })),
  };
}

export type CarouselCaptionInput = {
  themePrompt?: string | null;
  vibeLabel?: string | null;
  slidePrompts: string[];
  facts?: {
    aspectRatio?: string | null;
    n?: number | null;
  };
};

const CAROUSEL_CAPTION_RULES = [
  "Caption: 1–2 short lines, max ~140 chars TOTAL. This is ONE caption for the WHOLE carousel — write as if posting all N slides under one Instagram-style caption. Match Siya's register: confident, observant, slightly mysterious. Soft tease, never thirsty.",
  "Tags: 6–10 hashtags WITHOUT the # symbol — the UI adds it. Mix lifestyle / aesthetic / location-flavoured. No spammy growth tags.",
  "Location: a real-feeling place tag (city, neighbourhood, venue) consistent with her bases (Sydney primary, Melbourne, Bali). Specific but plausible.",
  "Accessibility text (alt text): one factual sentence, 80–140 chars, summarising what's visible across the carousel for screen readers. NO persona voice — literal description.",
];

/**
 * Generates ONE caption pack for an entire carousel. Called by the
 * carousel-finalize worker once all child slides reach a terminal state.
 */
export async function generateCarouselCaptionPack(
  input: CarouselCaptionInput,
): Promise<CaptionPack> {
  const env = getEnv();
  const client = getClient();
  const briefing = siyaBriefing();

  const slidesBlock = input.slidePrompts
    .map((p, i) => `Slide ${i + 1}: ${p}`)
    .join("\n");

  const userBlock = [
    `Carousel of ${input.facts?.n ?? input.slidePrompts.length} images.`,
    input.themePrompt ? `User theme: "${input.themePrompt}"` : null,
    input.vibeLabel ? `Unifying vibe: ${input.vibeLabel}` : null,
    input.facts?.aspectRatio ? `Aspect ratio: ${input.facts.aspectRatio}` : null,
    "",
    "Slides (each is a separate image, sharing the same wardrobe/lighting/setting, varying pose & expression):",
    slidesBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    briefing,
    "",
    "Task: write a single social-post caption pack for the carousel below. The caption covers the whole carousel — not slide-by-slide. Output strict JSON matching the provided schema.",
    "",
    "Rules:",
    ...CAROUSEL_CAPTION_RULES.map((r) => `- ${r}`),
    "",
    "Carousel context:",
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
