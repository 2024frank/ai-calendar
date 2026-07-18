import "server-only";
import { lookup } from "dns/promises";

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
const MAX_REDIRECTS = 4;

/** Fast, synchronous reject of obviously-unsafe URLs (scheme, credentials, obvious private hosts). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  // Credentials in the URL are a common SSRF/credential-leak vector.
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  )
    return false;
  return true;
}

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable => treat as unsafe
  const [a, b] = p;
  if (a === 0 || a === 127) return true; // this-host, loopback
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (and 192.0.2.0/24 test)
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return ipv4IsPrivate(address);
  const addr = address.toLowerCase();
  // IPv4-mapped / embedded IPv4 (e.g. ::ffff:169.254.169.254)
  const embedded = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return ipv4IsPrivate(embedded[1]);
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local
  if (addr.startsWith("fe8") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb"))
    return true; // link-local
  if (addr.startsWith("ff")) return true; // multicast
  return false;
}

/** Resolve the hostname and refuse if it points at any private/loopback/link-local address. */
async function assertResolvesPublic(hostname: string): Promise<void> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error("dns_resolution_failed");
  }
  if (!addrs.length) throw new Error("dns_no_records");
  for (const a of addrs) {
    if (isPrivateAddress(a.address, a.family)) throw new Error("blocked_private_ip");
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
    let current = url;
    let res: Response | null = null;

    // Follow redirects by hand so every hop is validated against the private-IP guard.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (!isPublicHttpUrl(current)) throw new Error("blocked_redirect");
      await assertResolvesPublic(u.hostname);

      res = await fetch(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; AI-Calendar/1.0; +https://ai-calendar.uhurued.com)",
          accept:
            "text/html,application/xhtml+xml,application/xml,text/calendar,application/json;q=0.9,*/*;q=0.8",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      break;
    }

    if (!res) throw new Error("no_response");
    if (res.status >= 300 && res.status < 400) throw new Error("too_many_redirects");

    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const isHtml = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
    const text = isHtml ? htmlToText(body) : body;
    return {
      ok: res.ok,
      status: res.status,
      url,
      finalUrl: current,
      contentType,
      bytes: body.length,
      text: text.slice(0, MAX_TEXT),
      jsonLd: isHtml ? extractJsonLd(body) : [],
      feeds: isHtml ? extractFeeds(body, current) : [],
    };
  } catch (e) {
    const name = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
    return { ...base, error: name };
  } finally {
    clearTimeout(timer);
  }
}
