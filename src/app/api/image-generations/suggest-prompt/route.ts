import { NextResponse } from "next/server";
import { isLlmConfigured, suggestImagePrompt } from "@/lib/gemini";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    avoidCategories?: string[];
  };

  try {
    const suggestion = await suggestImagePrompt({
      avoidCategories: body.avoidCategories,
    });
    return NextResponse.json(suggestion);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Prompt suggestion failed",
    );
    return NextResponse.json(
      { error: "Suggestion failed: " + (err instanceof Error ? err.message : "unknown") },
      { status: 502 },
    );
  }
}
