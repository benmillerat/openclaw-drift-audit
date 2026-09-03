import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(path.dirname(here), "fingerprint-skill.mjs");

test("skill fingerprint is deterministic and contains no absolute paths", () => {
  const first = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 15_000 });
  const second = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout.includes(path.dirname(path.dirname(here))), false);
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.kind, "openclaw-drift-skill-fingerprint");
  assert.ok(parsed.fileCount > 0);
  assert.equal(parsed.files.some((entry) => entry.path === "SKILL.md"), true);
});
