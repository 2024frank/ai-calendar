import "server-only";
import sharp from "sharp";
import { fetchPublicBytes, resolveUrlSecrets } from "./fetchPage";

export const MAX_POSTER_IMAGES = 4;

const POSTER_HEIGHT = 900;
const MAX_POSTER_WIDTH = 1_600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 45 KB becomes at most 60 KB after base64 encoding, safely inside MySQL TEXT.
export const MAX_INLINE_IMAGE_BYTES = 45_000;

/** Convert arbitrary image bytes to a compact JPEG safe for the inline column. */
export async function fitInlineImage(input: Buffer): Promise<Buffer | null> {
  const attempts = [
    { width: 1_000, quality: 76 },
    { width: 840, quality: 66 },
    { width: 680, quality: 56 },
    { width: 520, quality: 46 },
  ];

  for (const attempt of attempts) {
    try {
      const output = await sharp(input, {
        failOn: "error",
        limitInputPixels: 40_000_000,
        sequentialRead: true,
      })
        .rotate()
        .resize({
          width: attempt.width,
          height: attempt.width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: attempt.quality, mozjpeg: true })
        .toBuffer();
      if (output.length && output.length <= MAX_INLINE_IMAGE_BYTES) return output;
    } catch {
      return null;
    }
  }
  return null;
}

/** Fetch an image with a hard byte ceiling so a huge file cannot exhaust memory. */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  const fetched = await fetchPublicBytes(resolveUrlSecrets(url), {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: 15_000,
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  return fetched.ok ? Buffer.from(fetched.bytes) : null;
}

/**
 * Download each poster, scale them to one height and join them side by side,
 * returning a single JPEG. This is how an Apollo announcement covering several
 * films ends up with one picture showing every film in it.
 *
 * Returns null when nothing could be decoded, so the caller can fall back.
 */
export async function mergePosterImages(urls: string[]): Promise<Buffer | null> {
  const wanted = urls.filter(Boolean).slice(0, MAX_POSTER_IMAGES);
  if (!wanted.length) return null;

  // Decode one at a time: four full-size posters held at once is a lot of memory
  // for a serverless process.
  const parts: { data: Buffer; width: number; height: number }[] = [];
  for (const url of wanted) {
    try {
      const raw = await fetchImageBytes(url);
      if (!raw) continue;
      const out = await sharp(raw, {
        failOn: "error",
        limitInputPixels: 40_000_000,
        sequentialRead: true,
      })
        .resize({
          width: MAX_POSTER_WIDTH,
          height: POSTER_HEIGHT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88 })
        .toBuffer({ resolveWithObject: true });
      parts.push({ data: out.data, width: out.info.width, height: out.info.height });
    } catch {
      // Skip an unreadable poster; the rest still merge.
    }
  }
  if (!parts.length) return null;
  if (parts.length === 1) return fitInlineImage(parts[0].data);

  const totalWidth = parts.reduce((sum, p) => sum + p.width, 0);
  if (!Number.isSafeInteger(totalWidth) || totalWidth <= 0) return null;

  // Size the canvas to the posters themselves. Using a fixed height left a
  // black band under anything shorter than the nominal height.
  const canvasHeight = Math.max(...parts.map((p) => p.height));

  let x = 0;
  const overlays = parts.map((p) => {
    const item = { input: p.data, left: x, top: Math.round((canvasHeight - p.height) / 2) };
    x += p.width;
    return item;
  });

  const merged = await sharp({
    create: {
      width: totalWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(overlays)
    .jpeg({ quality: 85 })
    .toBuffer();
  return fitInlineImage(merged);
}
