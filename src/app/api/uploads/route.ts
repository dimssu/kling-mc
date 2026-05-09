import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { MediaAsset } from "@/models";
import type { MediaAssetDoc } from "@/models";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { makeUploadKey, uploadObjectStream } from "@/lib/storage";
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
import { toApi } from "@/lib/serialize";
import {
  PERCEPTUAL_DUPE_THRESHOLD,
  findClosestPerceptualMatch,
} from "@/lib/perceptual-hash";
import { computeAssetHashes } from "@/lib/asset-hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["source_video", "reference_image"]);

export async function POST(req: Request) {
  await connectMongo();
  const tmpPath = join(tmpdir(), `kmc-upload-${randomUUID()}`);
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

    // Two-tier duplicate detection. Runs for *every* upload regardless of
    // kind, and looks across the whole owner's library — so the same image
    // re-uploaded via any form (motion-control reference, image-gen subject,
    // carousel subject, multi-image-to-video reference, …) gets flagged, and
    // re-uploads of an image you previously generated also get flagged.
    //
    //   1. SHA-256 byte-exact match  — catches identical files
    //   2. dHash perceptual near-match (images only) — catches re-encodes,
    //      format swaps, EXIF strips, light edits
    //
    // Videos skip the perceptual tier (sharp can't decode them) but still
    // get the SHA tier — re-uploads of the same MP4 are flagged.
    const env = getEnv();
    const buf = await readFile(tmpPath);
    const { contentHash, perceptualHash } = await computeAssetHashes(buf, sniffed);

    const exactDuplicate: MediaAssetDoc | null = await MediaAsset.findOne({
      ownerId: env.DEFAULT_USER_ID,
      contentHash,
    }).lean();

    let perceptualDuplicate: { row: MediaAssetDoc; distance: number } | null = null;

    // Only run the perceptual sweep when SHA didn't already hit and we have
    // a fingerprint to compare. The exact-match dialog is the right surface
    // when both tiers would fire.
    if (!exactDuplicate && perceptualHash) {
      // Pull just { _id, perceptualHash } for every fingerprinted row in
      // this owner's library (any kind), then Hamming-scan in memory.
      // 64-bit hash + Brian Kernighan popcount — comfortably under 1 ms
      // per 1000 rows.
      const candidates = (await MediaAsset.find(
        {
          ownerId: env.DEFAULT_USER_ID,
          perceptualHash: { $ne: null },
        },
        { _id: 1, perceptualHash: 1 },
      ).lean()) as Array<{ _id: string; perceptualHash: string | null }>;

      const closest = findClosestPerceptualMatch(
        candidates,
        perceptualHash,
        PERCEPTUAL_DUPE_THRESHOLD,
      );
      if (closest) {
        // Re-fetch the full doc so the dialog has filename / dimensions /
        // createdAt to show.
        const fullDoc = await MediaAsset.findById(closest.row._id).lean();
        if (fullDoc) {
          perceptualDuplicate = { row: fullDoc, distance: closest.distance };
        }
      }
    }

    const force =
      String(parsed.fields.force ?? "").toLowerCase() === "true" ||
      parsed.fields.force === "1";

    if (exactDuplicate && !force) {
      return NextResponse.json(
        {
          duplicate: true,
          duplicateKind: "exact",
          contentHash,
          existingAsset: toApi(exactDuplicate),
          message:
            "An identical image is already in your library. Confirm to upload anyway.",
        },
        { status: 409 },
      );
    }

    if (perceptualDuplicate && !force) {
      return NextResponse.json(
        {
          duplicate: true,
          duplicateKind: "perceptual",
          contentHash,
          perceptualHash,
          distance: perceptualDuplicate.distance,
          existingAsset: toApi(perceptualDuplicate.row),
          message:
            "This image looks the same as one already in your library. Confirm to upload anyway.",
        },
        { status: 409 },
      );
    }

    const ext = extForMime(sniffed);
    const storageKey = makeUploadKey(env.DEFAULT_USER_ID, kind, ext);

    await uploadObjectStream({
      key: storageKey,
      body: createReadStream(tmpPath),
      contentType: sniffed,
    });

    const safeFilename = sanitizeFilename(parsed.file.filename) || `${randomUUID()}.${ext}`;
    const asset = await MediaAsset.create({
      ownerId: env.DEFAULT_USER_ID,
      kind,
      filename: safeFilename,
      mimeType: sniffed,
      sizeBytes: tmpStat.size,
      durationSec: probe?.durationSec ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      storageKey,
      contentHash,
      perceptualHash,
    });

    return NextResponse.json({ asset: toApi(asset.toObject()) });
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
