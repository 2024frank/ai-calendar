import "server-only";
import { fetchPublicBytes } from "./fetchPage";
import { fitInlineImage } from "./mergePosters";

/**
 * Fetch a remote picture and shrink it into the inline column, so the event's
 * image lives on THIS server from then on and no third-party host can break
 * publishing later. One taxonomy of failures, in the reviewer's words, shared
 * by ingest and publish: a site logo served as SVG and a photo behind a bot
 * wall are different problems with different fixes, and one blank sentence
 * covering all of them told nobody anything.
 */
export type InlineImageFailure =
  | "unreachable"
  | "not_an_image"
  | "vector_image"
  | "too_large"
  | "unreadable";

export const INLINE_IMAGE_FAILURE_TEXT: Record<InlineImageFailure, string> = {
  unreachable:
    "The image host did not serve the picture to us. Replace the image with one on a reachable host.",
  not_an_image:
    "That image link does not return a picture; it returns a web page. Open the link, right-click the picture itself, and use its direct image address.",
  vector_image:
    "That is an SVG logo or banner, not a photo of the event. CommunityHub cannot take SVG. Replace it with the event's own picture.",
  too_large: "That image is over 8MB. Replace it with a smaller one.",
  unreadable: "That image file is damaged and could not be read. Replace it.",
};

export async function inlineRemoteImage(
  url: string,
  timeoutMs = 20_000,
): Promise<{ imageData: string } | { failure: InlineImageFailure }> {
  try {
    const fetched = await fetchPublicBytes(url, {
      maxBytes: 8 * 1024 * 1024,
      timeoutMs,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!fetched.ok) {
      return { failure: fetched.status === 413 ? "too_large" : "unreachable" };
    }
    const buf = Buffer.from(fetched.bytes);
    if (!buf.length) return { failure: "unreachable" };
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49;
    const isWebp = buf.subarray(8, 12).toString() === "WEBP";
    if (!(isJpeg || isPng || isGif || isWebp)) {
      const head = buf.subarray(0, 512).toString("utf8").trim().toLowerCase();
      if (head.startsWith("<svg") || head.includes("<svg") || head.startsWith("<?xml"))
        return { failure: "vector_image" };
      return { failure: "not_an_image" };
    }
    const jpeg = await fitInlineImage(buf);
    if (!jpeg) return { failure: "unreadable" };
    return { imageData: jpeg.toString("base64") };
  } catch {
    return { failure: "unreachable" };
  }
}
