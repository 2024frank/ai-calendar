import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import * as password from "../src/lib/password";
import * as requestBody from "../src/lib/requestBody";
import * as studios from "../src/lib/studiosSso";
import { safeNextPath } from "../src/lib/safeNext";
import { loadRoute } from "./helpers/load-route";

const SECRET = "s".repeat(40);
const PASSWORD = "correct horse battery";

type Row = { user: Record<string, unknown>; communityStatus: string | null } | undefined;

const activeUser = {
  id: 7,
  email: "ada@example.org",
  name: "Ada",
  role: "community_admin",
  communityId: 3,
  passwordHash: password.hashPassword(PASSWORD),
  mustSetPassword: false,
  status: "active",
};

/** Real route and real shared login check; only the database, limiter and logger are replaced. */
function load(opts: { row?: Row; limited?: boolean } = {}) {
  const keys: string[] = [];
  const logged: unknown[] = [];
  const query = { from: () => query, leftJoin: () => query, where: () => query, limit: async () => (opts.row ? [opts.row] : []) };
  const passwordLogin = loadRoute<Record<string, unknown>>(new URL("../src/lib/passwordLogin.ts", import.meta.url), {
    "@/db": { db: { select: () => query } },
    "@/db/schema": schema,
    "@/lib/password": password,
    "@/lib/rateLimit": {
      rateLimit: async (key: string) => {
        keys.push(key);
        return !opts.limited;
      },
    },
  });
  const { POST } = loadRoute<{ POST(req: Request): Promise<Response> }>(
    new URL("../src/app/api/studios/login/route.ts", import.meta.url),
    {
      "@/lib/activity": { logActivity: async (entry: unknown) => void logged.push(entry) },
      "@/lib/passwordLogin": passwordLogin,
      "@/lib/rateLimit": { clientKey: () => "request-ip" },
      "@/lib/requestBody": requestBody,
      "@/lib/studiosSso": studios,
    },
  );
  return { POST, keys, logged };
}

function call(POST: (r: Request) => Promise<Response>, init: { auth?: string | null; body?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${SECRET}`;
  if (init.ip) headers["x-studios-client-ip"] = init.ip;
  return POST(
    new Request("https://calendar.example/api/studios/login", {
      method: "POST",
      headers,
      body: init.body ?? JSON.stringify({ email: "Ada@Example.org ", password: PASSWORD }),
    }),
  );
}

async function withSecret<T>(value: string | undefined, run: () => Promise<T>) {
  const saved = process.env.STUDIOS_SSO_SECRET;
  if (value === undefined) delete process.env.STUDIOS_SSO_SECRET;
  else process.env.STUDIOS_SSO_SECRET = value;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.STUDIOS_SSO_SECRET;
    else process.env.STUDIOS_SSO_SECRET = saved;
  }
}

describe("studios login bearer", () => {
  it("compares the secret exactly and requires 32 characters", () => {
    assert.equal(studios.isUsableSecret(undefined), false);
    assert.equal(studios.isUsableSecret("x".repeat(31)), false);
    assert.equal(studios.isUsableSecret("x".repeat(32)), true);
    assert.equal(studios.bearerMatches(`Bearer ${SECRET}`, SECRET), true);
    for (const bad of [null, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `bearer ${SECRET}`, "Bearer ", `Basic ${SECRET}`]) {
      assert.equal(studios.bearerMatches(bad, SECRET), false, String(bad));
    }
  });
});

describe("studios login route", () => {
  it("returns 503 when the secret is missing or short", async () => {
    const { POST } = load({ row: { user: activeUser, communityStatus: "active" } });
    for (const value of [undefined, "short", "x".repeat(31)]) {
      const res = await withSecret(value, () => call(POST));
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "not_configured" });
    }
  });

  it("returns 401 for a missing or wrong bearer without checking credentials", async () => {
    const { POST, keys } = load({ row: { user: activeUser, communityStatus: "active" } });
    await withSecret(SECRET, async () => {
      for (const auth of [null, "", "Bearer nope", `Bearer ${SECRET}x`, SECRET]) {
        const res = await call(POST, { auth });
        assert.equal(res.status, 401, String(auth));
        assert.deepEqual(await res.json(), { error: "unauthorized" });
        assert.equal(res.headers.get("set-cookie"), null);
      }
    });
    assert.equal(keys.length, 0);
  });

  it("returns 400 for a bad body", async () => {
    const { POST } = load({ row: { user: activeUser, communityStatus: "active" } });
    await withSecret(SECRET, async () => {
      for (const body of ["{bad", "[]", "null", "{}", JSON.stringify({ email: "a@b.org" }), JSON.stringify({ password: "x" }), JSON.stringify({ email: 5, password: "x" }), JSON.stringify({ email: "a@b.org", password: "x".repeat(129) })]) {
        const res = await call(POST, { body });
        assert.equal(res.status, 400, body);
        assert.deepEqual(await res.json(), { error: "bad_request" });
      }
    });
  });

  it("returns the user on success, with no cookie, and logs the sign-in", async () => {
    const { POST, logged } = load({ row: { user: activeUser, communityStatus: "active" } });
    const res = await withSecret(SECRET, () => call(POST));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.deepEqual(await res.json(), { user: { id: 7, email: "ada@example.org", name: "Ada", role: "community_admin", communityId: 3 } });
    assert.equal(logged.length, 1);
    assert.equal((logged[0] as { action: string }).action, "login");
  });

  it("answers a wrong password and an unknown or disabled account with the same generic 401", async () => {
    await withSecret(SECRET, async () => {
      const wrong = await call(load({ row: { user: activeUser, communityStatus: "active" } }).POST, {
        body: JSON.stringify({ email: "ada@example.org", password: "not the password" }),
      });
      const unknown = await call(load({ row: undefined }).POST); // disabled users are filtered by the query too
      const unset = await call(load({ row: { user: { ...activeUser, mustSetPassword: true }, communityStatus: "active" } }).POST);
      for (const res of [wrong, unknown, unset]) {
        assert.equal(res.status, 401);
        assert.equal(res.headers.get("set-cookie"), null);
        assert.deepEqual(await res.json(), { error: "invalid_credentials" });
      }
    });
  });

  it("rejects a suspended community but lets platform admins in", async () => {
    await withSecret(SECRET, async () => {
      const blocked = await call(load({ row: { user: activeUser, communityStatus: "suspended" } }).POST);
      assert.equal(blocked.status, 401);
      assert.deepEqual(await blocked.json(), { error: "invalid_credentials" });
      const noCommunity = await call(load({ row: { user: activeUser, communityStatus: null } }).POST);
      assert.equal(noCommunity.status, 401);

      const admin = { ...activeUser, role: "platform_admin", communityId: null };
      const ok = await call(load({ row: { user: admin, communityStatus: null } }).POST);
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as { user: { communityId: unknown } }).user.communityId, null);
    });
  });

  it("returns 429 with retryAfter when limited", async () => {
    const { POST } = load({ limited: true, row: { user: activeUser, communityStatus: "active" } });
    const res = await withSecret(SECRET, () => call(POST));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("set-cookie"), null);
    const body = (await res.json()) as { error: string; retryAfter: number };
    assert.equal(body.error, "rate_limited");
    assert.equal(body.retryAfter, 600);
    assert.equal(res.headers.get("retry-after"), "600");
  });

  it("keys the throttle on the forwarded Studios client IP, else the request IP", async () => {
    const forwarded = load({ row: { user: activeUser, communityStatus: "active" } });
    await withSecret(SECRET, () => call(forwarded.POST, { ip: "203.0.113.9" }));
    assert.equal(forwarded.keys[0], "login:203.0.113.9:ada@example.org");

    const direct = load({ row: { user: activeUser, communityStatus: "active" } });
    await withSecret(SECRET, () => call(direct.POST));
    assert.equal(direct.keys[0], "login:request-ip:ada@example.org");
  });

  it("never echoes the password", async () => {
    const { POST } = load({ row: { user: activeUser, communityStatus: "active" } });
    await withSecret(SECRET, async () => {
      for (const res of [await call(POST), await call(POST, { auth: "Bearer nope" }), await call(POST, { body: JSON.stringify({ email: "x@y.org", password: PASSWORD + "z" }) })]) {
        assert.equal((await res.text()).includes(PASSWORD), false);
      }
    });
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/review?source=12#pending"), "/review?source=12#pending");
  });

  it("falls back for anything that could leave the origin", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://x", "http://x/", "javascript:alert(1)", "evil.com", "", "/\t/evil.com", "/a\\b", "/a\nb"]) {
      assert.equal(safeNextPath(bad), "/dashboard", JSON.stringify(bad));
    }
    assert.equal(safeNextPath(null), "/dashboard");
    assert.equal(safeNextPath(undefined), "/dashboard");
    assert.equal(safeNextPath("//evil.com", "/home"), "/home");
  });
});
