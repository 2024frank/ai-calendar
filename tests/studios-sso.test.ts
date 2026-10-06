import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { jwtVerify } from "jose";
import * as sso from "../src/lib/studiosSso";
import { safeNextPath } from "../src/lib/safeNext";
import { loadRoute } from "./helpers/load-route";

const SECRET = "s".repeat(40);
const STATE = "a1".repeat(32);
const PROD = "https://studios.communityhb.tech/api/auth-callback";

describe("studios SSO return allowlist", () => {
  it("allows the built-in production callbacks exactly", () => {
    for (const url of sso.STUDIOS_DEFAULT_RETURN_URLS) assert.equal(sso.isAllowedReturn(url, undefined), true);
  });

  it("rejects prefix, scheme, path, query and host tricks", () => {
    for (const bad of [
      PROD + "/",
      PROD + "?x=1",
      PROD + "#h",
      PROD + "/extra",
      "http://studios.communityhb.tech/api/auth-callback",
      "https://studios.communityhb.tech.evil.com/api/auth-callback",
      "https://evil.com/?https://studios.communityhb.tech/api/auth-callback",
      "https://studios.communityhb.tech@evil.com/api/auth-callback",
      "https://studios.communityhb.tech/api/auth-callback ",
      "https://STUDIOS.communityhb.tech/api/auth-callback",
      "https://studios.communityhb.tech",
      "",
    ]) {
      assert.equal(sso.isAllowedReturn(bad, undefined), false, bad);
    }
    assert.equal(sso.isAllowedReturn(null, undefined), false);
  });

  it("adds trimmed entries from STUDIOS_RETURN_URLS and still matches exactly", () => {
    const extra = " http://127.0.0.1:8322/api/auth-callback , ,https://studios-preview.example/api/auth-callback";
    assert.equal(sso.isAllowedReturn("http://127.0.0.1:8322/api/auth-callback", extra), true);
    assert.equal(sso.isAllowedReturn("https://studios-preview.example/api/auth-callback", extra), true);
    assert.equal(sso.isAllowedReturn("http://127.0.0.1:8322/api/auth-callback?x=1", extra), false);
    assert.equal(sso.isAllowedReturn("http://127.0.0.1:8323/api/auth-callback", extra), false);
    assert.equal(sso.isAllowedReturn("", extra), false);
  });
});

describe("studios SSO state and secret", () => {
  it("accepts only 64 lowercase hex characters", () => {
    assert.equal(sso.isValidState(STATE), true);
    for (const bad of ["", "abc", "A1".repeat(32), "g1".repeat(32), STATE + "0", STATE.slice(1), null, undefined]) {
      assert.equal(sso.isValidState(bad as string | null), false);
    }
  });

  it("requires a secret of 32 or more characters", () => {
    assert.equal(sso.isUsableSecret(undefined), false);
    assert.equal(sso.isUsableSecret("short"), false);
    assert.equal(sso.isUsableSecret("x".repeat(31)), false);
    assert.equal(sso.isUsableSecret("x".repeat(32)), true);
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/review?source=12#pending"), "/review?source=12#pending");
    const sso = "/api/sso/studios?state=" + STATE + "&return=" + encodeURIComponent(PROD);
    assert.equal(safeNextPath(sso), sso);
  });

  it("falls back for anything that could leave the origin", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://x",
      "http://x/",
      "javascript:alert(1)",
      "evil.com",
      "",
      "/\t/evil.com",
      "/a\\b",
      "/a\nb",
    ]) {
      assert.equal(safeNextPath(bad), "/dashboard", JSON.stringify(bad));
    }
    assert.equal(safeNextPath(null), "/dashboard");
    assert.equal(safeNextPath(undefined), "/dashboard");
    assert.equal(safeNextPath("//evil.com", "/home"), "/home");
  });
});

describe("studios SSO token", () => {
  const session = { uid: 7, email: "a@b.org", name: "Ada", role: "community_admin" as const, communityId: 3 };

  it("carries the contract claims and expires after 120 seconds", async () => {
    const now = 1_800_000_000;
    const token = await sso.signStudiosToken({ session, state: STATE, secret: SECRET, now });
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
      issuer: "ai-calendar",
      audience: "ch-studios",
      currentDate: new Date((now + 1) * 1000),
    });
    assert.equal(protectedHeader.alg, "HS256");
    assert.equal(payload.sub, "7");
    assert.equal(payload.email, "a@b.org");
    assert.equal(payload.name, "Ada");
    assert.equal(payload.role, "community_admin");
    assert.equal(payload.communityId, 3);
    assert.equal(payload.state, STATE);
    assert.equal(payload.iat, now);
    assert.equal(payload.exp, now + 120);
  });

  it("is rejected after expiry and under a different secret", async () => {
    const now = 1_800_000_000;
    const token = await sso.signStudiosToken({ session, state: STATE, secret: SECRET, now });
    const key = new TextEncoder().encode(SECRET);
    await assert.rejects(jwtVerify(token, key, { currentDate: new Date((now + 121) * 1000) }));
    await assert.rejects(
      jwtVerify(token, new TextEncoder().encode("o".repeat(40)), { currentDate: new Date((now + 1) * 1000) }),
    );
  });
});

describe("studios SSO route", () => {
  const saved = { secret: process.env.STUDIOS_SSO_SECRET, urls: process.env.STUDIOS_RETURN_URLS, app: process.env.APP_URL };
  afterEach(() => {
    for (const [key, value] of [["STUDIOS_SSO_SECRET", saved.secret], ["STUDIOS_RETURN_URLS", saved.urls], ["APP_URL", saved.app]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function load(session: unknown) {
    return loadRoute<{ GET(req: Request): Promise<Response> }>(
      new URL("../src/app/api/sso/studios/route.ts", import.meta.url),
      { "@/lib/auth": { getSession: async () => session }, "@/lib/studiosSso": sso },
    ).GET;
  }
  const call = (get: (r: Request) => Promise<Response>, state: string, ret: string) =>
    get(new Request(`https://calendar.example/api/sso/studios?state=${state}&return=${encodeURIComponent(ret)}`));
  const signedIn = { uid: 7, email: "a@b.org", name: "Ada", role: "platform_admin", communityId: null, canReviewAllSources: true };

  it("rejects a bad state or unlisted return with 400 and never redirects", async () => {
    process.env.STUDIOS_SSO_SECRET = SECRET;
    delete process.env.APP_URL;
    const get = load(signedIn);
    for (const res of [await call(get, "nope", PROD), await call(get, STATE, "https://evil.com/api/auth-callback")]) {
      assert.equal(res.status, 400);
      assert.equal(res.headers.get("location"), null);
    }
  });

  it("returns 503 when the secret is missing or short", async () => {
    delete process.env.APP_URL;
    const get = load(signedIn);
    delete process.env.STUDIOS_SSO_SECRET;
    assert.equal((await call(get, STATE, PROD)).status, 503);
    process.env.STUDIOS_SSO_SECRET = "short";
    assert.equal((await call(get, STATE, PROD)).status, 503);
  });

  it("sends signed-out users to login with the original query preserved", async () => {
    process.env.STUDIOS_SSO_SECRET = SECRET;
    delete process.env.APP_URL;
    const res = await call(load(null), STATE, PROD);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.origin, "https://calendar.example");
    assert.equal(location.pathname, "/login");
    const next = location.searchParams.get("next")!;
    assert.equal(safeNextPath(next), next);
    assert.equal(next, `/api/sso/studios?state=${STATE}&return=${encodeURIComponent(PROD)}`);
  });

  it("redirects signed-in users to the return URL with a verifiable token", async () => {
    process.env.STUDIOS_SSO_SECRET = SECRET;
    const res = await call(load(signedIn), STATE, PROD);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const location = res.headers.get("location")!;
    assert.ok(location.startsWith(PROD + "?token="));
    const token = new URL(location).searchParams.get("token")!;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), { issuer: "ai-calendar", audience: "ch-studios" });
    assert.equal(payload.sub, "7");
    assert.equal(payload.state, STATE);
    assert.equal(payload.role, "platform_admin");
    assert.equal(payload.exp! - payload.iat!, 120);
  });

  it("honors extra allowed return URLs from the environment", async () => {
    process.env.STUDIOS_SSO_SECRET = SECRET;
    process.env.STUDIOS_RETURN_URLS = "http://127.0.0.1:8322/api/auth-callback";
    const res = await call(load(signedIn), STATE, "http://127.0.0.1:8322/api/auth-callback");
    assert.equal(res.status, 302);
    assert.ok(res.headers.get("location")!.startsWith("http://127.0.0.1:8322/api/auth-callback?token="));
  });
});
