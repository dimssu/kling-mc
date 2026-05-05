// Tiny magic-byte sniffer for the formats we accept (JPG, PNG, MP4, MOV).
// We do NOT trust client-provided file.type for storage Content-Type.

export type SniffedKind = "image/jpeg" | "image/png" | "video/mp4" | "video/quicktime" | null;

export function sniffMime(buf: Buffer): SniffedKind {
  if (buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // MP4 / MOV: bytes 4-7 = "ftyp", brand at bytes 8-11
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) {
    const brand = buf.slice(8, 12).toString("ascii");
    // QuickTime brand
    if (brand === "qt  " || brand.startsWith("qt")) return "video/quicktime";
    // MP4 brands: isom, iso2, mp41, mp42, avc1, dash, M4V , M4A , msnv, ...
    return "video/mp4";
  }

  return null;
}

export function extForMime(mime: SniffedKind): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    default: return "bin";
  }
}
