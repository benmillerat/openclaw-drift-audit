import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifySourceReleaseBinding, inspectGit } from "../lib/git-evidence.mjs";

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("collects dirty source evidence without changing repository status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-git-"));
  git(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid", "commit", "-qm", "fixture"]);
  git(root, ["remote", "add", "origin", "https://example.invalid/openclaw.git?token=must-not-survive"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "two\n");
  const before = git(root, ["status", "--porcelain=v1"]);
  const evidence = inspectGit(root, (candidate) => candidate.replace(root, "$SOURCE"));
  const after = git(root, ["status", "--porcelain=v1"]);
  assert.equal(after, before);
  assert.equal(evidence.present, true);
  assert.equal(evidence.dirty, true);
  assert.equal(evidence.changes[0].path, "$SOURCE/tracked.txt");
  assert.equal(evidence.origin, "https://example.invalid/openclaw.git");
});

test("source release binding distinguishes tags, mainline, and mismatched versions", () => {
  assert.deepEqual(
    classifySourceReleaseBinding(
      { present: true, readable: true, exactTag: "v2026.8.2", branch: "main" },
      "2026.8.2",
    ),
    { state: "exact-version-tag", baselineChannel: "version-tag", tag: "v2026.8.2" },
  );
  assert.equal(
    classifySourceReleaseBinding(
      { present: true, readable: true, exactTag: null, branch: "main" },
      "2026.8.2",
    ).baselineChannel,
    "unreleased-mainline",
  );
  assert.equal(
    classifySourceReleaseBinding(
      { present: true, readable: true, exactTag: "v2026.8.1", branch: "release" },
      "2026.8.2",
    ).state,
    "tag-version-mismatch",
  );
});
