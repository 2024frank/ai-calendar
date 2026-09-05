import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import * as password from "../src/lib/password";
import * as requestBody from "../src/lib/requestBody";
import { loadRoute } from "./helpers/load-route";

for (const action of ["login", "request", "forgot", "set-password"]) {
  describe(`authentication input: ${action}`, () => {
    async function submit(body: string) {
      const query = { from: () => query, where: () => query, limit: async () => [] };
      const transaction = { select: () => query };
      const { POST } = loadRoute<{ POST(req: Request): Promise<Response> }>(
        new URL(`../src/app/api/auth/${action}/route.ts`, import.meta.url),
        {
          "@/db": { db: { ...transaction, transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction) } },
          "@/db/schema": schema,
          "@/lib/auth": { createSession: async () => undefined },
          "@/lib/password": password,
          "@/lib/rateLimit": { clientKey: () => "test", rateLimit: async () => true },
          "@/lib/email": {},
          "@/lib/requestBody": requestBody,
        },
      );
      return POST(new Request(`https://calendar.example/api/auth/${action}`, { method: "POST", body }));
    }

    it("returns a validation response for JSON null instead of throwing", async () => {
      assert.equal((await submit("null")).status, 400);
    });

    it("rejects malformed JSON and non-object input", async () => {
      for (const body of ["{bad", "[]", "42", '"text"']) {
        assert.equal((await submit(body)).status, 400, body);
      }
    });

    it("bounds actual received bytes before account lookup or password work", async () => {
      const body = JSON.stringify({ email: "a@example.com", password: "a-long-password-123", token: "test", padding: "a".repeat(16 * 1024) });
      assert.equal((await submit(body)).status, 413);
    });
  });
}
