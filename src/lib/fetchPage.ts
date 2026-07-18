import "server-only";

export type FetchedPage = {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  contentType: string;
  bytes: number;
  text: string;
  jsonLd: unknown[];
  feeds: { type: string; href: string }[];
  error?: string;
};

const MAX_TEXT = 45_000;

/** Reject private/loopback targets (SSRF guard). */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h.endsWith(".local") ||
      h === "127.0.0.1" ||
      h === "::1" ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h)
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  return html
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
    if (
      /rss|atom|calendar/i.test(type) ||
      (/alternate/i.test(rel) && /xml|calendar/i.test(type))
    ) {
      try {
        feeds.push({ type, href: new URL(href, base).toString() });
      } catch {
        /* skip bad href */
      }
    }
  }
  // Common calendar export paths referenced inline
  const inline = html.match(/https?:\/\/[^\s"'<>]+\.ics\b/gi) ?? [];
  for (const href of inline.slice(0, 5)) feeds.push({ type: "text/calendar", href });
  return feeds;
}

export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchedPage> {
  const base: FetchedPage = {
    ok: false,
    status: 0,
    url,
    finalUrl: url,
    contentType: "",
    bytes: 0,
    text: "",
    jsonLd: [],
    feeds: [],
  };
  if (!isPublicHttpUrl(url)) return { ...base, error: "blocked_non_public_url" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; AI-Calendar/1.0; +https://ai-calendar.uhurued.com)",
        accept: "text/html,application/xhtml+xml,application/xml,text/calendar,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const isHtml = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
    const text = isHtml ? htmlToText(body) : body;
    return {
      ok: res.ok,
      status: res.status,
      url,
      finalUrl: res.url || url,
      contentType,
      bytes: body.length,
      text: text.slice(0, MAX_TEXT),
      jsonLd: isHtml ? extractJsonLd(body) : [],
      feeds: isHtml ? extractFeeds(body, res.url || url) : [],
    };
  } catch (e) {
    return { ...base, error: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
