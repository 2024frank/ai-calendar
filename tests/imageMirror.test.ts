import { test } from "node:test";
import assert from "node:assert/strict";
import { s3OriginalFor } from "../src/lib/imageMirror";

test("maps a Serverless Image Handler link to its S3 original", () => {
  const url =
    "https://images.locable.com/eyJidWNrZXQiOiJpbXBhY3QtcHJvZHVjdGlvbiIsImtleSI6Il9vcmlnaW5hbHMvNDY3NGEzNzItZGVjZi00YjQ0LWIwNDUtY2IwOWY4MmE2YjJiL1RyZWFzdXJlIEZlc3QgT2JlcmxpbiBQb3N0ZXIgKDEpLnBuZyIsImVkaXRzIjp7InJlc2l6ZSI6eyJ3aWR0aCI6NjQwfSwicG5nIjp7InF1YWxpdHkiOjgwLCJhZGFwdGl2ZUZpbHRlcmluZyI6dHJ1ZX19fQ==";
  assert.equal(
    s3OriginalFor(url),
    "https://impact-production.s3.amazonaws.com/_originals/4674a372-decf-4b44-b045-cb09f82a6b2b/Treasure%20Fest%20Oberlin%20Poster%20(1).png",
  );
});

test("leaves ordinary image links alone", () => {
  assert.equal(s3OriginalFor("https://example.com/photos/poster.jpg"), null);
  assert.equal(s3OriginalFor("not a url"), null);
});
