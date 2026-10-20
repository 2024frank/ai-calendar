import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRoute } from "./helpers/load-route";

const { readResponseTextPrefix } = loadRoute<typeof import("../src/lib/fetchPage")>(
  new URL("../src/lib/fetchPage.ts", import.meta.url),
  { "server-only": {}, "./publicUrl": {} },
);

describe("readResponseTextPrefix", () => {
  it("returns the whole body when it fits", async () => {
    const res = new Response("small body", { status: 500 });
    assert.equal(await readResponseTextPrefix(res, 1024), "small body");
  });

  it("keeps the start of an oversized error body instead of discarding it", async () => {
    const head = "TypeError: Location::setGooglePlaceId() must be of type string, null given";
    const res = new Response(head + "x".repeat(5000), { status: 500 });
    const text = await readResponseTextPrefix(res, 512);
    assert.ok(text.startsWith(head), text.slice(0, 80));
    assert.ok(text.length <= 512, String(text.length));
  });

  it("reads a prefix even when content-length declares an oversized body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("declared-huge error head"));
        controller.enqueue(new TextEncoder().encode("y".repeat(4096)));
        controller.close();
      },
    });
    const res = new Response(stream, {
      status: 500,
      headers: { "content-length": "999999" },
    });
    const text = await readResponseTextPrefix(res, 128);
    assert.ok(text.startsWith("declared-huge error head"), text.slice(0, 80));
  });

  it("returns an empty string for a bodyless response", async () => {
    const res = new Response(null, { status: 204 });
    assert.equal(await readResponseTextPrefix(res, 128), "");
  });
});
