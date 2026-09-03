import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTargetWriteGuard, exportDirectoryFingerprint } from "../lib/target-graph.mjs";

const scriptsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixturesDir = path.join(scriptsDir, "tests", "fixtures");
const goldenDir = path.join(scriptsDir, "tests", "golden");

function fixtureComposite() {
  return {
    evidence: JSON.parse(fs.readFileSync(path.join(fixturesDir, "export-evidence.json"), "utf8")),
    analysis: JSON.parse(fs.readFileSync(path.join(fixturesDir, "export-analysis.json"), "utf8")),
  };
}

function writeAuthorizedInputs(directory, options = {}) {
  const composite = fixtureComposite();
  const guard = createTargetWriteGuard(
    options.protectedRecords ?? [],
    (value) => `$TARGET/${path.basename(value)}`,
    options.seed ?? "export-fixture",
    { complete: true, unresolvedCount: 0 },
  );
  composite.evidence.target.writeGuard = guard;
  composite.evidence.exportBoundary = {
    mode: "portable-redacted",
    directoryFingerprint: exportDirectoryFingerprint(guard.salt, directory),
    retention: options.retention ?? "delete-after-review",
  };
  composite.evidence.run.persistentArtifactsCreated = true;
  const evidencePath = path.join(directory, "evidence.json");
  const analysisPath = path.join(directory, "analysis.json");
  fs.writeFileSync(evidencePath, JSON.stringify(composite.evidence));
  fs.writeFileSync(analysisPath, JSON.stringify(composite.analysis));
  return { evidencePath, analysisPath };
}

test("finalizer separates run, rule, semantic finding, and observation", () => {
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(fixtureComposite()),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  const audit = JSON.parse(finalized.stdout);
  assert.equal(audit.schemaVersion, "0.1.1");
  assert.equal(audit.run.id, "run-fixture");
  assert.equal(audit.rules[0].id, "rule:fixture");
  assert.equal(audit.observations[0].id, "observation:fixture");
  assert.match(audit.findings[0].key, /^finding:/u);

  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalized.stdout,
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /^# OpenClaw Drift Audit/mu);
  assert.match(rendered.stdout, /No repair handoff was requested/u);
});

test("canonical audit and derived report match reviewed golden files", () => {
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(fixtureComposite()),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(finalized.stdout, fs.readFileSync(path.join(goldenDir, "audit.json"), "utf8"));

  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalized.stdout,
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, fs.readFileSync(path.join(goldenDir, "report.md"), "utf8"));
});

test("finalizer fails closed on secret-like values", () => {
  const composite = fixtureComposite();
  composite.analysis.sources[0].location = "sk-abcdefghijklmnopqrstuv";
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /Possible secret value|Credential-like token/u);
});

test("finalizer rejects unknown analysis fields recursively", () => {
  const composite = fixtureComposite();
  composite.analysis.findings[0].privateConversation = "must not enter audit.json";
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /Unknown field analysis\.findings\[0\]\.privateConversation/u);
});

test("finalizer rejects unknown nested source fields", () => {
  const composite = fixtureComposite();
  composite.analysis.sources[0].metadata = { privateConversation: "must not enter audit.json" };
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /Unknown field analysis\.sources\[0\]\.metadata/u);
});

test("finalizer fails closed on embedded absolute local paths", () => {
  const composite = fixtureComposite();
  composite.analysis.diagnostics = [{ code: "path", severity: "error", message: "observed in /Users/example/private/config.json during scan" }];
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /Absolute local path detected/u);
});

test("finalizer rejects private identity-like segments in configuration pointers", () => {
  for (const pointer of [
    "/channels/custom/person@example.test/enabled",
    "/channels/custom/topics/123456789012345678/enabled",
  ]) {
    const composite = fixtureComposite();
    composite.evidence.configuration.authoredEntries.push({
      pointer,
      type: "boolean",
      sources: ["$CONFIG/openclaw.json"],
      disclosure: "clear",
      value: true,
    });
    const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
      input: JSON.stringify(composite),
      encoding: "utf8",
    });
    assert.notEqual(finalized.status, 0);
    assert.match(finalized.stderr, /Private identity-like segment detected/u);
  }
});

test("finalizer rejects arbitrary Unix roots and absolute paths used as keys", () => {
  for (const mutate of [
    (composite) => { composite.analysis.diagnostics = [{ code: "path", severity: "error", message: "observed in /Applications/OpenClaw.app" }]; },
    (composite) => { composite.evidence.target.packages[0].schemaVersions = { "/Volumes/private/audit": 1 }; },
  ]) {
    const composite = fixtureComposite();
    mutate(composite);
    const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
      input: JSON.stringify(composite),
      encoding: "utf8",
    });
    assert.notEqual(finalized.status, 0);
    assert.match(finalized.stderr, /Absolute local path detected/u);
  }
});

test("finalizer rejects Windows drive, UNC, and file URL paths", () => {
  for (const message of [
    "observed in C:\\Users\\example\\.openclaw\\openclaw.json",
    "observed on \\\\server\\private-share\\openclaw.json",
    "observed at file:///Users/example/.openclaw/openclaw.json",
    "observed at file://server/private-share/openclaw.json",
  ]) {
    const composite = fixtureComposite();
    composite.analysis.diagnostics = [{ code: "path", severity: "error", message }];
    const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
      input: JSON.stringify(composite),
      encoding: "utf8",
    });
    assert.notEqual(finalized.status, 0);
    assert.match(finalized.stderr, /Absolute local path detected/u);
  }
});

test("finalizer recursively drops unrecognized evidence fields from canonical output", () => {
  const composite = fixtureComposite();
  composite.evidence.target.unrecognized = { privateConversation: "must not enter audit.json" };
  composite.evidence.target.packages[0].unrecognized = "must not enter audit.json";
  composite.evidence.configuration.unrecognized = "must not enter audit.json";
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(finalized.stdout.includes("unrecognized"), false);
  assert.equal(finalized.stdout.includes("privateConversation"), false);
});

test("finalizer rejects finding-observation identity mismatches", () => {
  const composite = fixtureComposite();
  composite.analysis.findings[0].surface = "/different/surface";
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /identity mismatch/u);
});

test("finalizer binds observation outcomes to compatible finding drift classes", () => {
  const composite = fixtureComposite();
  composite.analysis.observations[0].outcome = "unknown";
  composite.analysis.findings[0].driftClass = "runtime-service-incoherence";
  const rejected = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /runtime-service-incoherence.*incompatible.*unknown|incompatible.*unknown.*runtime-service-incoherence/u);

  composite.analysis.findings[0].driftClass = "unknown-baseline";
  const accepted = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).findings[0].driftClass, "unknown-baseline");
});

test("finalizer requires every multidimensional finding field", () => {
  const composite = fixtureComposite();
  delete composite.analysis.findings[0].configurationLayer;
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /configurationLayer.*required field is missing/u);
});

test("finalizer enforces claim-specific provenance and permits source-free unknown baselines", () => {
  const mismatched = fixtureComposite();
  mismatched.analysis.sources[0].applicableClaim = "runtime-default";
  const rejected = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(mismatched),
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /claim.*recommendation/u);

  const unknown = fixtureComposite();
  unknown.analysis.baselines[0].kind = "unknown";
  unknown.analysis.baselines[0].status = "unknown";
  unknown.analysis.baselines[0].sourceIds = [];
  const accepted = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(unknown),
    encoding: "utf8",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout).baselines[0].sourceIds, []);
});

test("network freshness extends the audit observation window and validates temporal provenance", () => {
  const composite = fixtureComposite();
  composite.analysis.networkFreshness = {
    used: true,
    authorized: true,
    sourceClasses: ["official-documentation"],
    ownerDomains: ["example.invalid"],
    retrievedAt: "2026-09-03T00:05:00.000Z",
  };
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  const audit = JSON.parse(finalized.stdout);
  assert.equal(audit.run.networkUsed, true);
  assert.deepEqual(audit.run.observationWindow, {
    startedAt: "2026-09-03T00:00:00.000Z",
    endedAt: "2026-09-03T00:05:00.000Z",
  });

  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalized.stdout,
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /Network retrieval recorded at: `2026-09-03T00:05:00.000Z`/u);

  composite.analysis.networkFreshness.retrievedAt = "2026-09-03 00:05:00";
  const invalid = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /retrievedAt must be a valid RFC 3339 date-time/u);
});

test("finalizer requires a declared coverage gap when a budget is exceeded", () => {
  const composite = fixtureComposite();
  composite.analysis.budgets.timeMs = {
    limit: 10,
    used: 11,
    status: "exceeded",
    coverageGapId: "gap:missing",
  };
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /requires a matching Coverage Gap/u);
});

test("semantic disclosure authorization is scoped to a data class and explicit id", () => {
  const missingId = fixtureComposite();
  missingId.analysis.disclosures = [{ dataClass: "configuration", status: "authorized" }];
  const rejected = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(missingId),
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /requires authorizationId/u);

  const authorized = fixtureComposite();
  authorized.analysis.disclosures = [{ dataClass: "configuration", status: "authorized", authorizationId: "authorization:fixture" }];
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(authorized),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(JSON.parse(finalized.stdout).coverage.classes[0].authorizationId, "authorization:fixture");
});

test("renderer rejects a schema-invalid canonical audit at runtime", () => {
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(fixtureComposite()),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  const audit = JSON.parse(finalized.stdout);
  audit.findings[0].unrecognized = true;
  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: JSON.stringify(audit),
    encoding: "utf8",
  });
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stderr, /additional property is not allowed/u);
});

test("repair handoff remains non-executable and renders its proposed change", () => {
  const composite = fixtureComposite();
  composite.analysis.findings[0].key = "finding:fixture";
  composite.analysis.repairHandoffs = [{
    id: "handoff:fixture",
    findingKey: "finding:fixture",
    componentId: "openclaw:2026.8.2",
    componentVersion: "2026.8.2",
    effectiveScope: "global",
    configurationLayer: "authored",
    targetSurface: "/agents/defaults/timeoutSeconds",
    proposedChange: "Review changing the configured timeout to the applicable recommendation.",
    expectedDiff: "One authored scalar would change after separate authorization.",
    sideEffects: ["agent requests may time out sooner"],
    prerequisites: ["confirm workload latency requirements"],
    conflicts: [],
    rollbackBoundary: "restore the prior authored scalar",
    validation: "validate config and run a bounded chat request",
    repairProof: "the effective value and request behavior both match the approved target",
    uncertainties: ["long-running tool calls were not sampled"],
    saferAlternatives: ["leave unchanged and monitor latency"],
    executable: false,
  }];
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(JSON.parse(finalized.stdout).repairHandoffs[0].executable, false);
  const rendered = spawnSync(process.execPath, [path.join(scriptsDir, "render-report.mjs")], {
    input: finalized.stdout,
    encoding: "utf8",
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /Review changing the configured timeout/u);
});

test("persistent export is explicitly retained and remains portable-redacted", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-persistent-export-"));
  const target = path.join(temporary, "target");
  const exportDirectory = path.join(temporary, "export");
  const output = path.join(exportDirectory, "audit.json");
  fs.mkdirSync(target);
  fs.mkdirSync(exportDirectory);
  const inputs = writeAuthorizedInputs(exportDirectory, {
    protectedRecords: [{ path: target, kind: "directory", roles: ["state-root"] }],
  });
  const finalized = spawnSync(
    process.execPath,
    [
      path.join(scriptsDir, "finalize-audit.mjs"),
      "--evidence", inputs.evidencePath,
      "--analysis", inputs.analysisPath,
      "--output", output,
      "--retention", "delete-after-review",
      "--forbid-root", target,
    ],
    { encoding: "utf8" },
  );
  assert.equal(finalized.status, 0, finalized.stderr);
  const audit = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(audit.export, {
    mode: "portable-redacted",
    delivery: "persistent-file",
    authorization: "explicit",
    retention: "delete-after-review",
    localPathExportSupported: false,
    directoryFingerprint: exportDirectoryFingerprint(audit.run.targetGuard.salt, exportDirectory),
  });

  const reportPath = path.join(exportDirectory, "report.md");
  const rendered = spawnSync(process.execPath, [
    path.join(scriptsDir, "render-report.mjs"),
    "--input", output,
    "--output", reportPath,
    "--forbid-root", target,
  ], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(fs.readFileSync(reportPath, "utf8"), /^# OpenClaw Drift Audit/mu);

  const otherDirectory = path.join(temporary, "other-export");
  fs.mkdirSync(otherDirectory);
  const misplaced = spawnSync(process.execPath, [
    path.join(scriptsDir, "render-report.mjs"),
    "--input", output,
    "--output", path.join(otherDirectory, "report.md"),
  ], { encoding: "utf8" });
  assert.notEqual(misplaced.status, 0);
  assert.match(misplaced.stderr, /must be written beside/u);
});

test("persistent export accepts transient analysis on stdin without a colocated analysis artifact", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-transient-analysis-"));
  const exportDirectory = path.join(temporary, "export");
  fs.mkdirSync(exportDirectory);
  const inputs = writeAuthorizedInputs(exportDirectory, { retention: "delete-after-review" });
  const analysis = fs.readFileSync(inputs.analysisPath, "utf8");
  fs.unlinkSync(inputs.analysisPath);
  const output = path.join(exportDirectory, "audit.json");

  const finalized = spawnSync(process.execPath, [
    path.join(scriptsDir, "finalize-audit.mjs"),
    "--evidence", inputs.evidencePath,
    "--analysis", "-",
    "--output", output,
    "--retention", "delete-after-review",
  ], {
    input: analysis,
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(fs.existsSync(inputs.analysisPath), false);
  assert.equal(fs.existsSync(output), true);
  assert.deepEqual(
    fs.readdirSync(exportDirectory).sort(),
    ["audit.json", "evidence.json"],
  );
});

test("persistent finalization refuses evidence without an authorized directory fingerprint", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-unauthorized-export-"));
  const evidencePath = path.join(temporary, "evidence.json");
  const analysisPath = path.join(temporary, "analysis.json");
  fs.writeFileSync(evidencePath, JSON.stringify(fixtureComposite().evidence));
  fs.writeFileSync(analysisPath, JSON.stringify(fixtureComposite().analysis));
  const finalized = spawnSync(process.execPath, [
    path.join(scriptsDir, "finalize-audit.mjs"),
    "--evidence", evidencePath,
    "--analysis", analysisPath,
    "--output", path.join(temporary, "audit.json"),
    "--retention", "delete-after-review",
  ], { encoding: "utf8" });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /authorized persistent export/u);
});

test("persistent finalization binds analysis location and retention to Evidence", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-bound-chain-"));
  const exportDirectory = path.join(temporary, "export");
  const otherDirectory = path.join(temporary, "other");
  fs.mkdirSync(exportDirectory);
  fs.mkdirSync(otherDirectory);
  const inputs = writeAuthorizedInputs(exportDirectory, { retention: "delete-after-review" });
  const common = [
    path.join(scriptsDir, "finalize-audit.mjs"),
    "--evidence", inputs.evidencePath,
    "--output", path.join(exportDirectory, "audit.json"),
  ];
  const retentionMismatch = spawnSync(process.execPath, [
    ...common,
    "--analysis", inputs.analysisPath,
    "--retention", "keep-indefinitely",
  ], { encoding: "utf8" });
  assert.notEqual(retentionMismatch.status, 0);
  assert.match(retentionMismatch.stderr, /retention must match/u);

  const misplacedAnalysis = path.join(otherDirectory, "analysis.json");
  fs.copyFileSync(inputs.analysisPath, misplacedAnalysis);
  const locationMismatch = spawnSync(process.execPath, [
    ...common,
    "--analysis", misplacedAnalysis,
    "--retention", "delete-after-review",
  ], { encoding: "utf8" });
  assert.notEqual(locationMismatch.status, 0);
  assert.match(locationMismatch.stderr, /analysis\.json.*beside/u);
});

test("finalizer rejects secret-bearing URL queries", () => {
  const composite = fixtureComposite();
  composite.analysis.sources[0].location = "https://example.invalid/docs?api_key=must-not-survive";
  const finalized = spawnSync(process.execPath, [path.join(scriptsDir, "finalize-audit.mjs")], {
    input: JSON.stringify(composite),
    encoding: "utf8",
  });
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /Secret-bearing URL query/u);
});

test("export boundary resolves symlinked parent directories", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-export-boundary-"));
  const target = path.join(temporary, "target");
  const outside = path.join(temporary, "outside");
  fs.mkdirSync(target);
  fs.mkdirSync(outside);
  fs.symlinkSync(target, path.join(outside, "target-link"));
  const inputs = writeAuthorizedInputs(target);
  const finalized = spawnSync(
    process.execPath,
    [
      path.join(scriptsDir, "finalize-audit.mjs"),
      "--evidence", path.join(outside, "target-link", path.basename(inputs.evidencePath)),
      "--analysis", path.join(outside, "target-link", path.basename(inputs.analysisPath)),
      "--output", path.join(outside, "target-link", "audit.json"),
      "--retention", "delete-after-review",
      "--forbid-root", target,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(finalized.status, 0);
  assert.match(finalized.stderr, /outside every canonical Installation Target root/u);
  assert.equal(fs.existsSync(path.join(target, "audit.json")), false);
});
