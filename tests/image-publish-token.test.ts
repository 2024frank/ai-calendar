import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createImagePublishToken,
  verifyImagePublishTokenWithSecret,
} from "../src/lib/imagePublishTokenCore";

describe("publish-time image access", () => {
  const secret = "a-secure-test-secret-that-is-long-enough";

  it("authorizes only the exact event and image content that was signed", () => {
    const token = createImagePublishToken(7, "first-image", secret);

    assert.equal(verifyImagePublishTokenWithSecret(7, "first-image", token, secret), true);
    assert.equal(verifyImagePublishTokenWithSecret(8, "first-image", token, secret), false);
    assert.equal(verifyImagePublishTokenWithSecret(7, "replacement-image", token, secret), false);
    assert.equal(verifyImagePublishTokenWithSecret(7, "first-image", token, `${secret}!`), false);
  });

  it("fails closed for missing and malformed tokens", () => {
    assert.equal(verifyImagePublishTokenWithSecret(7, "first-image", null, secret), false);
    assert.equal(verifyImagePublishTokenWithSecret(7, "first-image", "not-a-token", secret), false);
  });
});
