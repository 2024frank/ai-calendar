import "server-only";
import { assertPublicHttpUrl, isPublicHttpUrl } from "./publicUrl";

export type FetchedPage = {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  contentType: string;
  bytes: number;
  text: string;
  /** Raw body, kept for sources parsed deterministically (e.g. Veezi). */
  html: string;
  jsonLd: unknown[];
  feeds: { type: string; href: string }[];
  image: string | null;
  error?: string;
};

function extractImage(html: string, base: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) {
      try {
        const u = new URL(m[1], base).toString();
        if (u.startsWith("https://") || u.startsWith("http://")) return u;
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

// Opus has a 1M context, so the old 45k cap was needlessly severe: a 360KB
// events API was cut to its first ~10 records, dropping fields mid-object.
// Structured payloads get far more room than prose-heavy HTML.
const MAX_TEXT_HTML = 120_000;
const MAX_TEXT_DATA = 400_000;
const MAX_REDIRECTS = 4;

/**
 * Source URLs may carry a `{PLACEHOLDER}` for a credential that must not live in
 * the database or be shown in the UI. Only this allowlist is ever substituted,
 * so an admin cannot craft a source URL that exfiltrates arbitrary env vars.
 */
const URL_SECRETS = ["APOLLO_VEEZI_SITE_TOKEN"] as const;

export function resolveUrlSecrets(url: string): string {
  let out = url;
  for (const key of URL_SECRETS) {
    const value = process.env[key];
    if (value) out = out.split(`{${key}}`).join(value);
  }
  return out;
}

function redactUrlSecrets(value: string): string {
  let out = value;
  for (const key of URL_SECRETS) {
    const secret = process.env[key];
    if (secret) out = out.split(secret).join(`{${key}}`);
  }
  return out;
}

export async function readResponseBytesLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response_too_large");
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export type PublicBytesResponse = {
  ok: boolean;
  status: number;
  contentType: string;
  finalUrl: string;
  bytes: Uint8Array;
};

/** Fetch a bounded public resource while validating every redirect hop. */
export async function fetchPublicBytes(
  rawUrl: string,
  {
    maxBytes,
    timeoutMs = 20_000,
    headers,
  }: { maxBytes: number; timeoutMs?: number; headers?: Record<string, string> },
): Promise<PublicBytesResponse> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(current);
    const response = await fetch(current, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      headers,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect_without_location");
      if (hop === MAX_REDIRECTS) throw new Error("too_many_redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: current,
      bytes: await readResponseBytesLimited(response, maxBytes),
    };
  }
  throw new Error("too_many_redirects");
}

/**
 * Does the URL path end in a real image extension? CommunityHub rejects an
 * image URL without one ("Unsupported image extension ''"), so any URL that
 * fails this must be re-hosted by us as a .jpg.
 */
export function hasImageExtension(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  } catch {
    return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url);
  }
}

/** Generic site furniture that must never be used as an event image. */
export function isGenericImage(url: string): boolean {
  // Icons are vector; event photos are not.
  if (/\.svg(\?|$)/i.test(url)) return true;
  // Chrome directories: headers, logos, icons, sprites.
  if (/\/(headers?|logos?|icons?|sprites?|badges?|buttons?)\//i.test(url)) return true;
  return /(\/|[-_])(share|logo|default|placeholder|banner|header|footer|icon|favicon|avatar|sprite|spacer|blank|bg|background)([-_.\d]|\/|$)/i.test(
    url,
  );
}

/**
 * Keep each image's URL inline as a marker so the model can associate the real
 * per-event photo with the event it sits next to. Stripping <img> entirely was
 * why every event on a listing page fell back to the site's share graphic.
 */
function imageMarkers(html: string, base: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const raw =
      /(?:\bdata-src|\bdata-lazy-src|\bdata-original|\bsrc)=["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\bsrcset=["']([^"'\s,]+)/i.exec(tag)?.[1];
    if (!raw || raw.startsWith("data:")) return " ";
    try {
      const abs = new URL(raw, base).toString();
      if (!/^https?:/i.test(abs)) return " ";
      if (isGenericImage(abs)) return " ";
      return ` [IMAGE: ${abs}] `;
    } catch {
      return " ";
    }
  });
}

function htmlToText(html: string, base = "https://example.org"): string {
  return imageMarkers(html, base)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

function extractFeeds(html: string, base: string): { type: string; href: string }[] {
  const feeds: { type: string; href: string }[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const type = /type=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!href) continue;
    if (/rss|atom|calendar/i.test(type) || (/alternate/i.test(rel) && /xml|calendar/i.test(type))) {
      try {
        feeds.push({ type, href: new URL(href, base).toString() });
      } catch {
        /* skip bad href */
      }
    }
  }
  const inline = html.match(/https?:\/\/[^\s"'<>]+\.ics\b/gi) ?? [];
  for (const href of inline.slice(0, 5)) feeds.push({ type: "text/calendar", href });
  return feeds;
}

// A COMPLETE modern-Chrome navigation fingerprint. Many venue sites sit behind
// Cloudflare or another WAF that 403s anything missing the sec-ch-ua / sec-fetch
// headers a real browser sends. This is the same bypass the agents use from the
// sandbox, so the server's own fetches (image rescue, discovery, extraction)
// pass the same bot walls without a per-source workaround.
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,text/calendar;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "upgrade-insecure-requests": "1",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

export async function fetchPage(rawUrl: string, timeoutMs = 20_000): Promise<FetchedPage> {
  // Fetch with the real credential, but report the placeholder form so the
  // token never reaches run timelines, logs, or the UI.
  const url = resolveUrlSecrets(rawUrl);
  const base: FetchedPage = {
    ok: false,
    status: 0,
    url: rawUrl,
    finalUrl: rawUrl,
    contentType: "",
    bytes: 0,
    text: "",
    html: "",
    jsonLd: [],
    feeds: [],
    image: null,
  };
  if (!isPublicHttpUrl(url)) return { ...base, error: "blocked_non_public_url" };

  try {
    const fetched = await fetchPublicBytes(url, {
      maxBytes: MAX_TEXT_DATA,
      timeoutMs,
      headers: BROWSER_HEADERS,
    });
    const current = fetched.finalUrl;
    const contentType = fetched.contentType;
    const body = new TextDecoder().decode(fetched.bytes);
    const safeBody = redactUrlSecrets(body);
    const isHtml = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
    const text = redactUrlSecrets(isHtml ? htmlToText(body, current) : safeBody);
    return {
      ok: fetched.ok,
      status: fetched.status,
      url: rawUrl,
      finalUrl: redactUrlSecrets(current),
      contentType,
      bytes: fetched.bytes.byteLength,
      text: text.slice(0, isHtml ? MAX_TEXT_HTML : MAX_TEXT_DATA),
      html: isHtml ? safeBody : "",
      jsonLd: isHtml ? extractJsonLd(safeBody) : [],
      feeds: isHtml
        ? extractFeeds(safeBody, current).map((feed) => ({
            ...feed,
            href: redactUrlSecrets(feed.href),
          }))
        : [],
      image: isHtml ? redactUrlSecrets(extractImage(safeBody, current) ?? "") || null : null,
    };
  } catch (e) {
    const name = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
    return { ...base, error: name };
  }
}
