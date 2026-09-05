import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { startTestDestination } from "../scripts/test-destination.mjs";

const createPath = "/api/legacy/calendar/post/submit";
const synthetic = { title: "[SYNTHETIC TEST] Arts workshop", public: "0", subscribe: false, email: "synthetic@example.test" };
function post(baseUrl: string, payload: unknown = synthetic, path = createPath, method = "POST") {
  return fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

it("receives a synthetic create over real loopback HTTP with a numeric acknowledgment", async t => {
  const file = new URL("../scripts/test-destination.mjs", import.meta.url);
  assert.ok(existsSync(file), "a local-only synthetic receiver must exist");
  const { startTestDestination } = await import("../scripts/test-destination.mjs");
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  assert.match(receiver.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await fetch(`${receiver.baseUrl}/api/legacy/calendar/post/submit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "[SYNTHETIC TEST] Community arts workshop", public: "0", subscribe: false }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 1, synthetic: true });
  const inspection = await fetch(`${receiver.baseUrl}/__synthetic__/posts`);
  const state = await inspection.json();
  assert.equal(state.synthetic, true);
  assert.equal(state.posts.length, 1);
  assert.equal(state.posts[0].payload.title, "[SYNTHETIC TEST] Community arts workshop");
});

it("updates the same remote ID and preserves omitted moderation and subscription values", async t => {
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  await post(receiver.baseUrl);
  const edit = await post(receiver.baseUrl, { title: "[SYNTHETIC TEST] Edited workshop" }, "/api/legacy/calendar/post/1/submit", "PATCH");
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).id, 1);
  const state = await (await fetch(`${receiver.baseUrl}/__synthetic__/posts`)).json();
  assert.equal(state.posts.length, 1);
  assert.deepEqual(state.posts[0].payload, { ...synthetic, title: "[SYNTHETIC TEST] Edited workshop" });
  assert.deepEqual(state.requests.map((entry: { method: string; id: number }) => [entry.method, entry.id]), [["POST", 1], ["PATCH", 1]]);
  assert.equal((await post(receiver.baseUrl, {}, "/api/legacy/calendar/post/999/submit", "PATCH")).status, 404);
});

it("rejects unmarked or malformed data without storing any records", async t => {
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  for (const payload of [{ title: "Real event" }, [], null, { title: "[SYNTHETIC TEST]" }]) {
    assert.equal((await post(receiver.baseUrl, payload)).status, 422);
  }
  assert.equal((await fetch(`${receiver.baseUrl}${createPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await fetch(`${receiver.baseUrl}${createPath}`, { method: "POST", body: JSON.stringify(synthetic) })).status, 415);
  assert.equal((await (await fetch(`${receiver.baseUrl}/__synthetic__/posts`)).json()).posts.length, 0);
});

it("bounds stored records, body bytes and request history", async t => {
  const receiver = await startTestDestination({ maxRecords: 1, maxBodyBytes: 256, maxHistory: 2 });
  t.after(() => receiver.close());
  assert.equal((await post(receiver.baseUrl)).status, 201);
  assert.equal((await post(receiver.baseUrl)).status, 507);
  assert.equal((await post(receiver.baseUrl, { ...synthetic, description: "x".repeat(300) })).status, 413);
  for (let index = 0; index < 3; index++) {
    assert.equal((await post(receiver.baseUrl, { description: String(index) }, "/api/legacy/calendar/post/1/submit", "PATCH")).status, 200);
  }
  const state = await (await fetch(`${receiver.baseUrl}/__synthetic__/posts`)).json();
  assert.equal(state.posts.length, 1);
  assert.equal(state.requests.length, 2);
  assert.equal(state.acceptedRequests, 4);
});

it("rejects nonlocal Host and cross-origin requests and disables caching", async t => {
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  const inspection = await fetch(`${receiver.baseUrl}/__synthetic__/posts`);
  assert.equal(inspection.headers.get("cache-control"), "no-store");
  assert.equal(inspection.headers.get("access-control-allow-origin"), null);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    httpRequest(`${receiver.baseUrl}/__synthetic__/posts`, { headers: { host: "untrusted.example.test" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject).end();
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`${receiver.baseUrl}/__synthetic__/posts`, { headers: { origin: "https://untrusted.example.test" } })).status, 403);
});

it("can simulate one ambiguous acknowledgment after a committed synthetic write", async t => {
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  receiver.setNextAcknowledgment("ambiguous");
  const first = await post(receiver.baseUrl);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { synthetic: true, accepted: true });
  assert.equal((await (await post(receiver.baseUrl)).json()).id, 2);
  assert.equal((await (await fetch(`${receiver.baseUrl}/__synthetic__/posts`)).json()).posts.length, 2);
});

it("CLI help exits without opening a server and rejects invalid or nonlocal binding options", () => {
  const script = new URL("../scripts/test-destination.mjs", import.meta.url);
  const help = spawnSync(process.execPath, [script.pathname, "--help"], { encoding: "utf8", timeout: 3000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /SYNTHETIC/);
  assert.match(help.stdout, /127\.0\.0\.1/);
  for (const args of [["--port", "-1"], ["--port", "99999"], ["--port", "no"], ["--host", "0.0.0.0"]]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 1);
  }
});

it("test transport remaps only the exact synthetic fixture origin and rejects every other destination", async t => {
  assert.ok(existsSync(new URL("./helpers/synthetic-publication-transport.ts", import.meta.url)), "the test transport allowlist must exist");
  const { syntheticPublicationTransport } = await import("./helpers/synthetic-publication-transport");
  const receiver = await startTestDestination();
  t.after(() => receiver.close());
  const transport = syntheticPublicationTransport(receiver.baseUrl);
  const allowed = "https://synthetic-publisher.example.test/api/legacy/calendar/post/submit";
  const request = { method: "POST", body: JSON.stringify(synthetic), headers: { "content-type": "application/json" } };
  const result = await transport.fetchPinnedPublicUrl(allowed, request);
  assert.equal(result.response.status, 201);
  assert.equal((await result.response.json()).id, 1);
  await result.close();
  for (const denied of [
    "https://communityhub.example.org/api/legacy/calendar/post/submit",
    "http://synthetic-publisher.example.test/api/legacy/calendar/post/submit",
    "https://synthetic-publisher.example.test:444/api/legacy/calendar/post/submit",
    "https://user@synthetic-publisher.example.test/api/legacy/calendar/post/submit",
    "https://synthetic-publisher.example.test/api/legacy/calendar/post/submit?url=https://example.org",
    "https://synthetic-publisher.example.test/__synthetic__/posts", receiver.baseUrl,
  ]) {
    await assert.rejects(transport.assertPublicHttpUrl(denied), /synthetic/i);
    await assert.rejects(transport.fetchPinnedPublicUrl(denied, request), /synthetic/i);
  }
  assert.throws(() => syntheticPublicationTransport("https://example.org"), /loopback/i);
  const state = await (await fetch(`${receiver.baseUrl}/__synthetic__/posts`)).json();
  assert.equal(state.acceptedRequests, 1);
});
