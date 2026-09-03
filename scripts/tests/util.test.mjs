import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeUrl } from "../lib/util.mjs";

test("sanitizes URL credentials, queries, and fragments before disclosure", () => {
  assert.equal(
    sanitizeUrl("https://user:secret@example.test/owner/repo?token=private#fragment"),
    "https://example.test/owner/repo",
  );
  assert.equal(sanitizeUrl("file:///Users/example/private"), "file://$REDACTED");
});
