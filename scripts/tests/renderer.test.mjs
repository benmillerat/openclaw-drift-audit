import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureDir = path.join(scriptsDir, "tests", "fixtures");

function finalizedAudit() {
  const composite = {
    evidence: JSON.parse(fs.readFileSync(path.join(fixtureDir, "export-evidence.json"), "utf8")),
    analysis: JSON.parse(fs.readFileSync(path.join(fixtureDir, "export-analysis.json"), "utf8")),
  };
  composite.analysis.sources[0].location = "https://github.com/openclaw/openclaw/releases/tag/v2026.8.2";
  composite.analysis.observations.push({
    ...composite.analysis.observations[0],
    id: "observation:matching-version",
    configurationLayer: "artifact",
    surface: "package.version",
    outcome: "match",
    observed: {
      status: "present",
      disclosure: "clear",
      value: "2026.8.2",
      fingerprint: null,
      summary: "Installed version 2026.8.2",
    },
    baseline: {
      status: "present",
      disclosure: "clear",
      value: "2026.8.2",
      fingerprint: null,
      summary: "Released stable version 2026.8.2",
    },
  });
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  return finalized.stdout;
}

test("renderer exposes exact source identity and positive observations", () => {
  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalizedAudit(),
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /### Source inventory/u);
  assert.match(rendered.stdout, /openclaw\/openclaw\/releases\/tag\/v2026\.8\.2/u);
  assert.match(rendered.stdout, /`2026\.8\.2` \/ `stable`/u);
  assert.match(rendered.stdout, /## Observations/u);
  assert.match(rendered.stdout, /`observation:matching-version` \| match/u);
  assert.match(rendered.stdout, /Installed version 2026\.8\.2/u);
  assert.match(rendered.stdout, /Released stable version 2026\.8\.2/u);
});

test("renderer states the bounded scope of consistency markers", () => {
  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalizedAudit(),
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /## Consistency-marker scope/u);
  assert.match(rendered.stdout, /not a byte-for-byte fingerprint of every protected target root/u);
});
