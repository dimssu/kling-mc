import { NextResponse } from "next/server";
import { isLlmConfigured, suggestVideoPrompt } from "@/lib/gemini";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const suggestion = await suggestVideoPrompt();
    return NextResponse.json(suggestion);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Video prompt suggestion failed",
    );
    return NextResponse.json(
      { error: "Suggestion failed: " + (err instanceof Error ? err.message : "unknown") },
      { status: 502 },
    );
  }
}
