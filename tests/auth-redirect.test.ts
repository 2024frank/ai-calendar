import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

describe("magic-link redirect", () => {
  async function location(next: string) {
    // The route's authentication boundary is supplied a valid token/account;
    // the redirect parser and Response implementation remain real.
    const db = {
      select() {
        const query = { from: () => query, where: () => query,
          limit: async () => [{ id: 1, userId: 1, status: "active", expiresAt: new Date(Date.now() + 60000) }] };
        return query;
      },
      update() {
        return { set: () => ({ where: async () => [{ affectedRows: 1 }] }) };
      },
    };
    const { GET } = loadRoute<{ GET(req: Request): Promise<Response> }>(
      new URL("../src/app/api/auth/verify/route.ts", import.meta.url),
      { "@/db": { db }, "@/db/schema": schema, "@/lib/auth": { createSession: async () => undefined } },
    );
    const url = new URL("https://calendar.example/api/auth/verify?token=valid");
    url.searchParams.set("next", next);
    return (await GET(new Request(url))).headers.get("location")!;
  }

  it("keeps ordinary review links and their filters", async () => {
    assert.equal(await location("/review?source=12#pending"), "https://calendar.example/review?source=12#pending");
  });

  it("never redirects an authenticated user to an external origin", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example"]) {
      const redirect = new URL(await location(next));
      assert.equal(redirect.origin, "https://calendar.example", next);
    }
  });
});
