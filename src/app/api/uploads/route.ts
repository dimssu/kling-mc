import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { uploadObjectStream } from "@/lib/storage";
import { parseMultipartToDisk } from "@/lib/multipart";
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
  const tmpPath = join(tmpdir(), `kmc-upload-${randomUUID()}`);
  // Use the larger of the two limits as the initial cap; we'll re-check
  // against the per-kind limit once we know what was uploaded.
  const initialCap = Math.max(IMAGE_LIMITS.maxSizeBytes, VIDEO_LIMITS.maxSizeBytes);

  let parsed;
  try {
    parsed = await parseMultipartToDisk(req, tmpPath, initialCap);
  } catch (err) {
    logger.warn({ err: errMsg(err) }, "Multipart parse failed");
    await unlink(tmpPath).catch(() => {});
    return NextResponse.json(
      { error: "Invalid multipart/form-data: " + errMsg(err) },
      { status: 400 },
    );
  }

  try {
    const kindParse = kindSchema.safeParse(parsed.fields.kind);
    if (!kindParse.success) {
      return NextResponse.json(
        { error: "kind must be 'source_video' or 'reference_image'" },
        { status: 400 },
      );
    }
    const kind = kindParse.data;

    if (!parsed.file) {
      return NextResponse.json({ error: "File is missing" }, { status: 400 });
    }
    if (parsed.file.tooLarge) {
      const limitMb = Math.round(initialCap / 1024 / 1024);
      return NextResponse.json(
        { error: `File exceeds ${limitMb} MB limit and was truncated.` },
        { status: 413 },
      );
    }

    const tmpStat = await stat(tmpPath);
    if (tmpStat.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    // Per-kind size check
    const maxBytes =
      kind === "reference_image" ? IMAGE_LIMITS.maxSizeBytes : VIDEO_LIMITS.maxSizeBytes;
    if (tmpStat.size > maxBytes) {
      const limitMb = Math.round(maxBytes / 1024 / 1024);
      return NextResponse.json(
        {
          error: `File exceeds ${limitMb} MB (got ${(tmpStat.size / 1024 / 1024).toFixed(1)} MB)`,
        },
        { status: 413 },
      );
    }

    // Magic-byte sniff: first 12 bytes only
    const handle = await open(tmpPath, "r");
    let sniffed: ReturnType<typeof sniffMime>;
    try {
      const head = Buffer.alloc(12);
      await handle.read(head, 0, 12, 0);
      sniffed = sniffMime(head);
    } finally {
      await handle.close();
    }

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

    const probe = await probeMediaPath(tmpPath).catch((err) => {
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
            sizeBytes: tmpStat.size,
            width: probe?.width ?? undefined,
            height: probe?.height ?? undefined,
          })
        : validateVideoFile({
            mimeType: sniffed,
            sizeBytes: tmpStat.size,
            width: probe?.width ?? undefined,
            height: probe?.height ?? undefined,
            durationSec: probe?.durationSec ?? undefined,
          });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const ext = extForMime(sniffed);
    const id = randomUUID().replace(/-/g, "");
    const env = getEnv();
    const storageKey = `uploads/${env.DEFAULT_USER_ID}/${kind}/${id}.${ext}`;

    // Stream tmp file → S3 multipart. Memory stays bounded.
    await uploadObjectStream({
      key: storageKey,
      body: createReadStream(tmpPath),
      contentType: sniffed,
    });

    const safeFilename = sanitizeFilename(parsed.file.filename) || `${id}.${ext}`;
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: env.DEFAULT_USER_ID,
        kind,
        filename: safeFilename,
        mimeType: sniffed,
        sizeBytes: tmpStat.size,
        durationSec: probe?.durationSec ?? null,
        width: probe?.width ?? null,
        height: probe?.height ?? null,
        storageKey,
      },
    });

    return NextResponse.json({ asset });
  } catch (err) {
    logger.error({ err: errMsg(err) }, "Upload failed");
    return NextResponse.json({ error: "Upload failed: " + errMsg(err) }, { status: 500 });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function probeMediaPath(path: string) {
  const { spawn } = await import("node:child_process");
  return new Promise<{ width: number | null; height: number | null; durationSec: number | null }>(
    (resolve, reject) => {
      const proc = spawn("ffprobe", [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        path,
      ]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (c) => (stdout += c.toString()));
      proc.stderr.on("data", (c) => (stderr += c.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited ${code}: ${stderr}`));
          return;
        }
        try {
          const out = JSON.parse(stdout) as {
            streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
            format?: { duration?: string };
          };
          const v = out.streams?.find((s) => s.codec_type === "video");
          const duration = parseFloat(out.format?.duration ?? v?.duration ?? "");
          resolve({
            width: v?.width ?? null,
            height: v?.height ?? null,
            durationSec: Number.isFinite(duration) ? duration : null,
          });
        } catch (e) {
          reject(e);
        }
      });
    },
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]/g, "_").slice(0, 200);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
