import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { uploadObject } from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";
import { sniffMime, extForMime } from "@/lib/mime-sniff";
import {
  validateImageFile,
  validateVideoFile,
  IMAGE_LIMITS,
  VIDEO_LIMITS,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["source_video", "reference_image"]);

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const kindParse = kindSchema.safeParse(formData.get("kind"));
  if (!kindParse.success) {
    return NextResponse.json(
      { error: "kind must be 'source_video' or 'reference_image'" },
      { status: 400 },
    );
  }
  const kind = kindParse.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "File is empty or missing" }, { status: 400 });
  }

  // Pre-buffer size gate — reject before pulling the whole file into memory.
  const maxBytes =
    kind === "reference_image" ? IMAGE_LIMITS.maxSizeBytes : VIDEO_LIMITS.maxSizeBytes;
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / 1024 / 1024);
    return NextResponse.json(
      { error: `File exceeds ${limitMb} MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 413 },
    );
  }

  const env = getEnv();
  const buffer = Buffer.from(await file.arrayBuffer());

  const sniffed = sniffMime(buffer);
  if (!sniffed) {
    return NextResponse.json(
      { error: "Unrecognized file content. Use JPG, PNG, MP4, or MOV." },
      { status: 400 },
    );
  }

  const expectedTypes =
    kind === "reference_image" ? SUPPORTED_IMAGE_TYPES : SUPPORTED_VIDEO_TYPES;
  if (!(expectedTypes as readonly string[]).includes(sniffed)) {
    return NextResponse.json(
      { error: `Sniffed type ${sniffed} doesn't match expected kind ${kind}.` },
      { status: 400 },
    );
  }

  const ext = extForMime(sniffed);
  const probe = await probeMedia(buffer, ext).catch((err) => {
    logger.warn({ err: errMsg(err) }, "ffprobe failed");
    return null;
  });

  if (kind === "source_video" && (probe == null || probe.durationSec == null)) {
    return NextResponse.json(
      { error: "Could not read video metadata (duration/dimensions). Re-encode and retry." },
      { status: 400 },
    );
  }

  const validation =
    kind === "reference_image"
      ? validateImageFile({
          mimeType: sniffed,
          sizeBytes: buffer.length,
          width: probe?.width ?? undefined,
          height: probe?.height ?? undefined,
        })
      : validateVideoFile({
          mimeType: sniffed,
          sizeBytes: buffer.length,
          width: probe?.width ?? undefined,
          height: probe?.height ?? undefined,
          durationSec: probe?.durationSec ?? undefined,
        });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const id = randomUUID().replace(/-/g, "");
  const storageKey = `uploads/${env.DEFAULT_USER_ID}/${kind}/${id}.${ext}`;

  try {
    await uploadObject({
      key: storageKey,
      body: buffer,
      contentType: sniffed,
      contentLength: buffer.length,
    });
  } catch (err) {
    logger.error({ err: errMsg(err), storageKey }, "Storage upload failed");
    return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
  }

  const safeFilename = sanitizeFilename(file.name) || `${id}.${ext}`;
  const asset = await prisma.mediaAsset.create({
    data: {
      ownerId: env.DEFAULT_USER_ID,
      kind,
      filename: safeFilename,
      mimeType: sniffed,
      sizeBytes: buffer.length,
      durationSec: probe?.durationSec ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      storageKey,
    },
  });

  return NextResponse.json({ asset });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]/g, "_").slice(0, 200);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
