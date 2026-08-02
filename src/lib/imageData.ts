// MySQL TEXT stores at most 65,535 bytes. Keep enough headroom that valid
// inline images remain safe across UTF-8 connectors and SQL modes.
export const MAX_BASE64_IMAGE_CHARS = 60_000;

export function imageMimeType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Normalize and validate agent-supplied JPEG/PNG/GIF/WebP base64. */
export function normalizeImageBase64(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const compact = value.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (
    compact.length < 100 ||
    compact.length > MAX_BASE64_IMAGE_CHARS ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    return null;
  }
  const head = Buffer.from(compact.slice(0, 32), "base64");
  return imageMimeType(head) ? compact : null;
}
