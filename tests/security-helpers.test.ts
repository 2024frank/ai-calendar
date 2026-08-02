import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvCell } from "../src/lib/csv";
import {
  imageMimeType,
  MAX_BASE64_IMAGE_CHARS,
  normalizeImageBase64,
} from "../src/lib/imageData";
import {
  readJsonBodyLimited,
  RequestBodyTooLargeError,
} from "../src/lib/requestBody";

describe("readJsonBodyLimited", () => {
  it("parses JSON whose received byte count is within the limit", async () => {
    const body = JSON.stringify({ title: "Café", count: 2 });
    const byteLength = Buffer.byteLength(body);
    const request = new Request("https://example.com/api/ingest", {
      method: "POST",
      body,
      headers: { "content-length": String(byteLength) },
    });

    assert.deepEqual(
      await readJsonBodyLimited<{ title: string; count: number }>(request, byteLength),
      { title: "Café", count: 2 },
    );
  });

  it("rejects a declared content length above the limit", async () => {
    const request = new Request("https://example.com/api/ingest", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "101" },
    });

    await assert.rejects(
      () => readJsonBodyLimited(request, 100),
      (error: unknown) => error instanceof RequestBodyTooLargeError,
    );
  });

  it("enforces actual UTF-8 bytes when content-length is missing or understated", async () => {
    const body = JSON.stringify({ title: "🎵" });
    const actualBytes = Buffer.byteLength(body);
    assert.ok(actualBytes > body.length, "fixture must contain a multi-byte character");

    for (const headers of [undefined, { "content-length": "1" }]) {
      const request = new Request("https://example.com/api/ingest", {
        method: "POST",
        body,
        headers,
      });
      await assert.rejects(
        () => readJsonBodyLimited(request, actualBytes - 1),
        (error: unknown) => error instanceof RequestBodyTooLargeError,
      );
    }
  });

  it("leaves malformed JSON as a parse error instead of accepting it", async () => {
    const request = new Request("https://example.com/api/ingest", {
      method: "POST",
      body: "{not-json}",
    });

    await assert.rejects(() => readJsonBodyLimited(request, 100), SyntaxError);
  });
});

describe("csvCell", () => {
  it("quotes values and escapes embedded quotes", () => {
    assert.equal(csvCell('Riverdog "Live"'), '"Riverdog ""Live"""');
    assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(undefined), '""');
  });

  it("neutralizes spreadsheet formula prefixes", () => {
    for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "\t=1+1", "\r=1+1", "\n=1+1"]) {
      assert.equal(csvCell(value), `"'${value}"`, value);
    }
  });

  it("does not alter ordinary non-formula content", () => {
    assert.equal(csvCell("CommunityHub"), '"CommunityHub"');
    assert.equal(csvCell(42), '"42"');
  });
});

describe("normalizeImageBase64", () => {
  function imageFixture(header: number[]): string {
    const bytes = Buffer.alloc(96, 0x41);
    bytes.set(header);
    return bytes.toString("base64");
  }

  it("accepts supported image signatures", () => {
    const fixtures: [string, string][] = [
      [imageFixture([0xff, 0xd8, 0xff]), "image/jpeg"],
      [imageFixture([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
      [imageFixture([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"],
      [imageFixture([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
    ];

    for (const [fixture, mime] of fixtures) {
      assert.equal(normalizeImageBase64(fixture), fixture);
      assert.equal(imageMimeType(Buffer.from(fixture, "base64")), mime);
    }
    assert.equal(imageMimeType(Buffer.alloc(16)), null);
  });

  it("removes a data URI prefix and whitespace", () => {
    const png = imageFixture([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const wrapped = png.match(/.{1,16}/g)?.join(" \n") ?? png;

    assert.equal(normalizeImageBase64(`data:image/png;base64,${wrapped}`), png);
  });

  it("rejects invalid, unsupported, short, and oversized image data", () => {
    const unsupported = Buffer.alloc(96, 0x41).toString("base64");
    const jpeg = imageFixture([0xff, 0xd8, 0xff]);

    assert.equal(normalizeImageBase64(null), null);
    assert.equal(normalizeImageBase64(""), null);
    assert.equal(normalizeImageBase64(Buffer.from([0xff, 0xd8]).toString("base64")), null);
    assert.equal(normalizeImageBase64(unsupported), null);
    assert.equal(normalizeImageBase64(`${jpeg.slice(0, -1)}*`), null);
    assert.equal(normalizeImageBase64("A".repeat(MAX_BASE64_IMAGE_CHARS + 1)), null);
  });
});
