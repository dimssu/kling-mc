import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { uploadObject } from "@/lib/storage";
import { probeMedia } from "@/lib/media-probe";
import {
  validateImageFile,
  validateVideoFile,
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
    return NextResponse.json({ error: "kind must be 'source_video' or 'reference_image'" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const env = getEnv();
  const kind = kindParse.data;
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  const allowedTypes =
    kind === "reference_image" ? SUPPORTED_IMAGE_TYPES : SUPPORTED_VIDEO_TYPES;
  if (!(allowedTypes as readonly string[]).includes(mimeType)) {
    return NextResponse.json(
      {
        error: `Unsupported ${kind === "reference_image" ? "image" : "video"} type ${mimeType}. Allowed: ${allowedTypes.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const ext = guessExt(mimeType, file.name);
  const probe = await probeMedia(buffer, ext).catch(() => ({
    width: null,
    height: null,
    durationSec: null,
  }));

  const validation =
    kind === "reference_image"
      ? validateImageFile({
          mimeType,
          sizeBytes: buffer.length,
          width: probe.width ?? undefined,
          height: probe.height ?? undefined,
        })
      : validateVideoFile({
          mimeType,
          sizeBytes: buffer.length,
          width: probe.width ?? undefined,
          height: probe.height ?? undefined,
          durationSec: probe.durationSec ?? undefined,
        });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const id = cuid();
  const storageKey = `uploads/${env.DEFAULT_USER_ID}/${kind}/${id}.${ext}`;

  try {
    await uploadObject({
      key: storageKey,
      body: buffer,
      contentType: mimeType,
      contentLength: buffer.length,
    });
  } catch (err) {
    logger.error({ err: errMsg(err), storageKey }, "Storage upload failed");
    return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      id,
      ownerId: env.DEFAULT_USER_ID,
      kind,
      filename: file.name || `${id}.${ext}`,
      mimeType,
      sizeBytes: buffer.length,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      storageKey,
    },
  });

  return NextResponse.json({ asset });
}

function cuid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function guessExt(mimeType: string, filename: string): string {
  const fromName = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("quicktime")) return "mov";
  return "bin";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
