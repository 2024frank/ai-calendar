import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workerTickOptions, workerTick } from "../scripts/worker-tick.mjs";

const env = { AI_CALENDAR_WORKER_URL: "https://calendar.example.org/api/internal/jobs", WORKER_SECRET: "test-only-worker-secret" };
const run = promisify(execFile);

describe("independent worker tick", () => {
  it("requires an explicit endpoint and secret rather than targeting production by default", () => {
    assert.throws(() => workerTickOptions([], {}), /AI_CALENDAR_WORKER_URL/);
    assert.throws(() => workerTickOptions([], { AI_CALENDAR_WORKER_URL: env.AI_CALENDAR_WORKER_URL }), /WORKER_SECRET/);
    assert.deepEqual(workerTickOptions(["--help"], {}), { help: true });
  });

  it("refuses unsafe or ambiguous secret destinations and invalid limits", () => {
    for (const url of ["http://calendar.example.org/api/internal/jobs", "https://user:pw@example.org/api/internal/jobs", "https://example.org/elsewhere", "https://example.org/api/internal/jobs?token=x", "https://example.org/api/internal/jobs#fragment"]) {
      assert.throws(() => workerTickOptions([], { ...env, AI_CALENDAR_WORKER_URL: url }));
    }
    for (const value of ["0", "6", "1.1", "junk"]) assert.throws(() => workerTickOptions(["--limit", value], env));
    assert.throws(() => workerTickOptions(["--secret", "must-not-be-a-cli-argument"], env));
    assert.throws(() => workerTickOptions([], { ...env, WORKER_SECRET: "secret\nheader" }));
  });

  it("supports explicit local staging and bounds request duration", () => {
    const options = workerTickOptions(["--url", "http://127.0.0.1:3000/api/internal/jobs", "--limit", "2", "--timeout-ms", "1000"], env);
    assert.equal(options.url, "http://127.0.0.1:3000/api/internal/jobs?limit=2");
    assert.equal(options.timeoutMs, 1000);
    assert.throws(() => workerTickOptions(["--timeout-ms", "0"], env));
    assert.throws(() => workerTickOptions(["--timeout-ms", "300001"], env));
  });

  it("POSTs only to the configured worker and returns bounded counters, not remote content", async () => {
    const result = await workerTick(workerTickOptions([], env), async (url: string, init: RequestInit) => {
      assert.equal(url, "https://calendar.example.org/api/internal/jobs?limit=1");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only-worker-secret");
      assert.ok(init.signal);
      return new Response(JSON.stringify({ ok: true, recovered: 2, drained: { considered: 1, succeeded: 1, failed: 0 }, remaining: 3, private: "must not be returned" }));
    });
    assert.deepEqual(result, { ok: true, recovered: 2, considered: 1, succeeded: 1, failed: 0, remaining: 3 });
  });

  it("reports failures without echoing response bodies or transport secrets", async () => {
    const options = workerTickOptions([], env);
    await assert.rejects(workerTick(options, async () => new Response("secret response", { status: 503 })), /^Error: Worker returned HTTP 503\.$/);
    await assert.rejects(workerTick(options, async () => { throw new Error("secret transport detail"); }), /^Error: Worker request failed or timed out; delivery may be incomplete\.$/);
    await assert.rejects(workerTick(options, async () => new Response(JSON.stringify({ ok: false, error: "secret response" }))), /unexpected response/);
    await assert.rejects(workerTick(options, async () => new Response("not json")), /unexpected response/);
  });

  it("rejects missing, nonnumeric and excessive response content", async () => {
    const options = workerTickOptions([], env);
    await assert.rejects(workerTick(options, async () => new Response(JSON.stringify({ ok: true, remaining: 2 }))), /unexpected response/);
    await assert.rejects(workerTick(options, async () => new Response(JSON.stringify({ ok: true, recovered: 0, drained: { considered: "one", succeeded: 0, failed: 0 }, remaining: 0 }))), /unexpected response/);
    await assert.rejects(workerTick(options, async () => new Response("x".repeat(65537))), /too large/);
  });

  it("runs the real command against an isolated loopback worker", async () => {
    const requests: { path: string; method: string; authorization?: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({ path: req.url!, method: req.method!, authorization: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, recovered: 0, drained: { considered: 1, succeeded: 1, failed: 0 }, remaining: 0 }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const result = await run(process.execPath, ["scripts/worker-tick.mjs", "--limit", "2"], {
        env: { NODE_ENV: "test", AI_CALENDAR_WORKER_URL: `http://127.0.0.1:${address.port}/api/internal/jobs`, WORKER_SECRET: env.WORKER_SECRET },
        timeout: 5000,
      });
      assert.deepEqual(JSON.parse(result.stdout), { ok: true, recovered: 0, considered: 1, succeeded: 1, failed: 0, remaining: 0 });
      assert.equal(result.stderr, "");
      assert.deepEqual(requests, [{ path: "/api/internal/jobs?limit=2", method: "POST", authorization: `Bearer ${env.WORKER_SECRET}` }]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("the CLI help is offline and invalid options do not echo secrets", async () => {
    const help = await run(process.execPath, ["scripts/worker-tick.mjs", "--help"], { env: { NODE_ENV: "test" } });
    assert.match(help.stdout, /Run one authenticated/);
    await assert.rejects(run(process.execPath, ["scripts/worker-tick.mjs", "--secret", env.WORKER_SECRET], { env: { NODE_ENV: "test" } }), error => {
      const output = error as { stdout: string; stderr: string; code: number };
      assert.equal(output.code, 1);
      assert.match(output.stderr, /Unknown option/);
      assert.ok(!`${output.stdout}${output.stderr}`.includes(env.WORKER_SECRET));
      return true;
    });
  });
});
