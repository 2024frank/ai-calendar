import "server-only";
import sharp from "sharp";
import { isPublicHttpUrl, resolveUrlSecrets } from "./fetchPage";

export const MAX_POSTER_IMAGES = 4;

const POSTER_HEIGHT = 900;
const MAX_POSTER_WIDTH = 1_600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Fetch an image with a hard byte ceiling so a huge file cannot exhaust memory. */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  if (!isPublicHttpUrl(url)) return null;
  const res = await fetch(resolveUrlSecrets(url), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength > MAX_IMAGE_BYTES ? null : buf;
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
  const parts: { data: Buffer; width: number }[] = [];
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
      parts.push({ data: out.data, width: out.info.width });
    } catch {
      // Skip an unreadable poster; the rest still merge.
    }
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0].data;

  const totalWidth = parts.reduce((sum, p) => sum + p.width, 0);
  if (!Number.isSafeInteger(totalWidth) || totalWidth <= 0) return null;

  let x = 0;
  const overlays = parts.map((p) => {
    const item = { input: p.data, left: x, top: 0 };
    x += p.width;
    return item;
  });

  return sharp({
    create: {
      width: totalWidth,
      height: POSTER_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(overlays)
    .jpeg({ quality: 85 })
    .toBuffer();
}
