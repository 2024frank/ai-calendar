import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { databaseSsl } from "../scripts/db-ssl.mjs";
import { normalizeEvent } from "../src/lib/contract";
import { passwordProblem } from "../src/lib/password";
import { assertPublicHttpUrl, isPublicHttpUrl } from "../src/lib/publicUrl";

describe("passwordProblem", () => {
  it("requires a reasonably long mixed password", () => {
    assert.equal(passwordProblem("short1"), "Use at least 12 characters.");
    assert.equal(passwordProblem("onlyletterslong"), "Include at least one letter and one number.");
    assert.equal(passwordProblem("long-enough-123"), null);
    assert.equal(passwordProblem(`a1${"x".repeat(127)}`), "Use no more than 128 characters.");
  });
});

describe("databaseSsl", () => {
  it("allows an explicit TLS opt-out only for a loopback database", () => {
    assert.equal(
      databaseSsl({ NODE_ENV: "test", DATABASE_HOST: "localhost", DATABASE_SSL: "false" }),
      undefined,
    );
    assert.throws(
      () =>
        databaseSsl({
          NODE_ENV: "test",
          DATABASE_HOST: "db.example.com",
          DATABASE_SSL: "false",
        }),
      /allowed only for a loopback database/,
    );
  });

  it("verifies remote servers and accepts a configured CA", () => {
    assert.deepEqual(databaseSsl({ NODE_ENV: "test", DATABASE_HOST: "db.example.com" }), {
      rejectUnauthorized: true,
    });
    assert.deepEqual(
      databaseSsl({
        NODE_ENV: "test",
        DATABASE_HOST: "db.example.com",
        DATABASE_CA_CERT: "line-1\\nline-2",
      }),
      { ca: "line-1\nline-2", rejectUnauthorized: true },
    );
  });
});

describe("public URL guard", () => {
  it("accepts normal public HTTP URLs", () => {
    assert.equal(isPublicHttpUrl("https://example.com/events"), true);
    assert.equal(isPublicHttpUrl("http://8.8.8.8/"), true);
    assert.equal(isPublicHttpUrl("https://[2606:4700:4700::1111]/"), true);
  });

  it("removes unsafe links from agent output", () => {
    const event = normalizeEvent({
      title: "Example",
      description: "A sufficiently long description.",
      website: "javascript:alert(1)",
      urlLink: "http://127.0.0.1/admin",
      calendarSourceUrl: "https://example.com/event",
      buttons: [
        { title: "Bad", link: "javascript:alert(1)" },
        { title: "Good", link: "https://example.com/register" },
      ],
    });
    assert.equal(event.website, null);
    assert.equal(event.urlLink, null);
    assert.equal(event.calendarSourceUrl, "https://example.com/event");
    assert.deepEqual(event.buttons, [{ title: "Good", link: "https://example.com/register" }]);
  });

  it("rejects credentials, non-HTTP schemes, and private address spellings", () => {
    const blocked = [
      "file:///etc/passwd",
      "https://user:pass@example.com/",
      "http://localhost/",
      "http://127.1/",
      "http://0x7f000001/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fc00::1]/",
      "http://service.internal/",
    ];
    for (const candidate of blocked) {
      assert.equal(isPublicHttpUrl(candidate), false, candidate);
    }
  });

  it("fails closed before DNS for an explicit private address", async () => {
    await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/"), /blocked_non_public_url/);
  });
});
