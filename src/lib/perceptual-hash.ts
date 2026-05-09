/**
 * Perceptual hashing for "looks the same to a human" duplicate detection.
 *
 * Algorithm: dHash (difference hash) by Neal Krawetz.
 *  1. Decode + downscale to 9×8 grayscale (sharp handles every common format).
 *  2. For each of the 8 rows, walk the 9 pixels left→right and emit a bit per
 *     adjacent pair: `1` if the left pixel is brighter, `0` otherwise.
 *  3. Result: 8 × 8 = 64 bits → 16 hex chars.
 *
 * Why dHash over pHash/aHash:
 *  - Robust to recompression, format changes, EXIF strips, light blur, slight
 *    color/brightness shifts. Catches every "I just re-saved it" case.
 *  - Pure pixel-gradient direction — no DCT, no float math, deterministic
 *    across machines.
 *  - 64 bits is enough to comfortably separate same-image-different-encoding
 *    (Hamming distance 0-3) from genuinely-different-but-similar images
 *    (typically ≥ 15).
 *
 * Threshold guidance (out of 64):
 *   0       byte-equivalent or identical pixels
 *   ≤ 4     same image, re-encoded / metadata stripped / minor compression
 *   ≤ 8     same image, mild edit (slight crop, light filter, resize)
 *   9-15    similar — possibly cropped / different framing of same scene
 *   ≥ 20    visually distinct
 */

import sharp from "sharp";

export const DHASH_BITS = 64;

/** How close two dHashes must be to be flagged as a duplicate. Conservative
 *  enough that "different but similar" images don't trigger; loose enough to
 *  catch ChatGPT re-saves and PNG↔JPEG conversions. Tune in env if needed. */
export const PERCEPTUAL_DUPE_THRESHOLD = 8;

/** Compute a 64-bit dHash from any image buffer/path. Returns 16 lowercase
 *  hex chars. Throws if sharp can't decode the image. */
export async function perceptualHashFromBuffer(buf: Buffer): Promise<string> {
  // .raw() gives us a Uint8Array of grayscale pixel values directly — no
  // need to round-trip through PNG.
  const { data } = await sharp(buf, { failOn: "none" })
    .grayscale()
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (data.length !== 9 * 8) {
    throw new Error(
      `perceptualHash: expected 72 grayscale pixels, got ${data.length}`,
    );
  }

  // 8 rows × 8 comparisons = 64 bits, packed MSB-first per row, each row a byte.
  const bytes = new Uint8Array(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    const off = row * 9;
    for (let col = 0; col < 8; col++) {
      const left = data[off + col];
      const right = data[off + col + 1];
      if (left > right) byte |= 1 << (7 - col);
    }
    bytes[row] = byte;
  }

  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hamming distance between two dHashes encoded as hex strings. Lower is
 *  more similar; 0 means identical. Throws if lengths differ. */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(
      `hammingDistanceHex: length mismatch ${a.length} vs ${b.length}`,
    );
  }
  let dist = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    // Brian Kernighan popcount — at most 8 iters per byte.
    let v = x;
    while (v) {
      dist++;
      v &= v - 1;
    }
  }
  return dist;
}

/** Find the closest existing perceptual hash within a threshold. Returns
 *  the row whose hash is nearest to `hash` (lowest Hamming distance), or
 *  null if none are within `maxDistance`. O(n) over candidates — fine for
 *  per-user libraries up to ~10K images. */
export function findClosestPerceptualMatch<T extends { perceptualHash: string | null | undefined }>(
  candidates: readonly T[],
  hash: string,
  maxDistance: number = PERCEPTUAL_DUPE_THRESHOLD,
): { row: T; distance: number } | null {
  let best: { row: T; distance: number } | null = null;
  for (const row of candidates) {
    if (!row.perceptualHash || row.perceptualHash.length !== hash.length) continue;
    const d = hammingDistanceHex(row.perceptualHash, hash);
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { row, distance: d };
      if (d === 0) break; // Can't get any closer.
    }
  }
  return best;
}
