import assert from "node:assert/strict";
import test from "node:test";
import { satisfiesVersion } from "../lib/semver.mjs";

test("evaluates supported direct dependency ranges", () => {
  assert.equal(satisfiesVersion("1.2.4", "^1.2.0").status, "match");
  assert.equal(satisfiesVersion("2.0.0", "^1.2.0").status, "mismatch");
  assert.equal(satisfiesVersion("2.1.7", "~2.1.0").status, "match");
  assert.equal(satisfiesVersion("2026.8.2", ">=2026.8.1 <2026.9.0").status, "match");
  assert.equal(satisfiesVersion("1.0.0", "workspace:*").status, "unknown");
});

test("does not guess prerelease compatibility", () => {
  assert.equal(
    satisfiesVersion("2026.9.1-beta.1", ">=2026.8.2").reason,
    "prerelease-range-requires-explicit-evidence",
  );
});
