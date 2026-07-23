import { NextRequest, NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-authenticated mutations must originate from this application.
 *
 * SameSite cookies stop cross-site form posts, but sibling subdomains are still
 * the same site. Browsers attach an Origin header to unsafe requests, so reject
 * a foreign one while allowing server-to-server callbacks that omit it.
 */
export function proxy(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return NextResponse.next();

  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();

  const allowed = new Set([req.nextUrl.origin]);
  if (process.env.APP_URL) {
    try {
      allowed.add(new URL(process.env.APP_URL).origin);
    } catch {
      // Readiness reports an invalid APP_URL; the request still uses its origin.
    }
  }

  if (!allowed.has(origin)) {
    return NextResponse.json({ error: "invalid origin" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
