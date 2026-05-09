/**
 * Single chokepoint for computing the dedupe fingerprints we store on every
 * MediaAsset row. Keeps the upload route, the worker handlers, and the
 * backfill script in lockstep — change one definition and every entrypoint
 * picks it up.
 *
 *   contentHash    SHA-256 over the raw bytes (lowercase hex). Universal —
 *                  computed for every MediaAsset regardless of kind.
 *   perceptualHash 64-bit dHash (16 hex chars). Only populated for image
 *                  MIMEs since sharp can't decode video. See
 *                  src/lib/perceptual-hash.ts for the algorithm.
 *
 * Buffer-in keeps callers simple: every site that needs to hash already has
 * the bytes in memory (worker downloads via downloadToBuffer, upload route
 * reads its temp file). 10 MB images and 100 MB videos are both fine to
 * pass through Node's heap.
 */

import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { perceptualHashFromBuffer } from "@/lib/perceptual-hash";

export type AssetHashes = {
  contentHash: string;
  perceptualHash: string | null;
};

export async function computeAssetHashes(
  bytes: Buffer,
  mimeType: string,
): Promise<AssetHashes> {
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  let perceptualHash: string | null = null;
  if (isImageMime(mimeType)) {
    try {
      perceptualHash = await perceptualHashFromBuffer(bytes);
    } catch (err) {
      // Don't block writes if sharp can't decode — exact-match dedupe still
      // works via contentHash. Most likely cause: an exotic image variant
      // sharp's libvips wasn't built with support for.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), mimeType },
        "Perceptual hash computation failed; falling back to SHA-only",
      );
    }
  }

  return { contentHash, perceptualHash };
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
