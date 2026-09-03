import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProtectedTargetGraph,
  configuredExternalRoots,
  createTargetWriteGuard,
  effectiveAgentWorkspaceRoots,
  outputConflictsWithTarget,
  verifyTargetWriteGuard,
} from "../lib/target-graph.mjs";

test("collects only statically resolved configured external roots", () => {
  const result = configuredExternalRoots({
    agents: { defaults: { workspace: "/srv/openclaw" }, entries: [{ agentDir: "relative-agent" }] },
    plugins: { load: { paths: ["/opt/plugin", "relative-plugin"] } },
  });
  assert.deepEqual(result.roots.map((entry) => entry.role), ["default-workspace", "plugin-load-path"]);
  assert.equal(result.gaps.length, 2);
  const resolved = configuredExternalRoots({ plugins: { load: { paths: ["relative-plugin"] } } }, {
    runtimeCwd: "/runtime",
  });
  assert.equal(resolved.roots[0].path, "/runtime/relative-plugin");
});

test("matches OpenClaw trimming and effective-home path semantics", () => {
  const result = configuredExternalRoots({
    plugins: { load: { paths: ["  relative-plugin  ", "~/home-plugin"] } },
  }, {
    runtimeCwd: "/runtime",
    effectiveHomeDir: "/effective-home",
  });
  assert.deepEqual(
    result.roots.map((entry) => entry.path),
    ["/runtime/relative-plugin", "/effective-home/home-plugin"],
  );
  assert.deepEqual(result.gaps, []);
});

test("leaves home-relative roots unresolved when the runtime home cannot be pinned", () => {
  const result = configuredExternalRoots({
    plugins: { load: { paths: ["~/home-plugin"] } },
  }, { effectiveHomeDir: null });
  assert.deepEqual(result.roots, []);
  assert.equal(result.gaps[0].code, "configured-external-root-not-statically-resolved");
});

test("derives effective multi-agent workspace roots", () => {
  const result = effectiveAgentWorkspaceRoots({
    agents: {
      defaults: { workspace: "/srv/agents" },
      entries: { main: { default: true }, Tim: {} },
    },
  }, { stateDir: "/state" });
  assert.deepEqual(
    result.roots.map((entry) => [entry.agentId, entry.path, entry.resolution]),
    [
      ["main", "/srv/agents", "inherited-default"],
      ["tim", "/srv/agents/tim", "default-plus-agent-id"],
    ],
  );
});

test("uses the statically observed OpenClaw default-workspace override only for the inherited agent", () => {
  const result = effectiveAgentWorkspaceRoots({
    agents: { entries: { main: { default: true }, ops: {} } },
  }, {
    stateDir: "/state",
    runtimeCwd: "/runtime",
    runtimeWorkspaceDir: "  relative-default-workspace  ",
  });
  assert.deepEqual(
    result.roots.map((entry) => [entry.agentId, entry.path, entry.resolution]),
    [
      ["main", "/runtime/relative-default-workspace", "runtime-default-override"],
      ["ops", "/state/workspace-ops", "state-plus-agent-id"],
    ],
  );
  assert.deepEqual(result.gaps, []);
});

test("minimizes nested target roots and proves a complete output guard", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-target-graph-"));
  const stateDir = path.join(temporary, "state");
  const packageRoot = path.join(temporary, "package");
  const external = path.join(temporary, "external-workspace");
  fs.mkdirSync(path.join(stateDir, "extensions", "plugin"), { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  const records = buildProtectedTargetGraph({
    discovery: { stateDir, configPath: path.join(stateDir, "openclaw.json"), packages: [], launchers: [] },
    packageRoot,
    sourceRoot: packageRoot,
    plugins: [{ root: path.join(stateDir, "extensions", "plugin") }],
    externalRoots: [{ path: external, role: "agent-workspace" }],
  });
  assert.deepEqual(
    records.map((entry) => entry.path),
    [packageRoot, stateDir, external].map((entry) => fs.realpathSync(entry)).sort(),
  );
  assert.ok(outputConflictsWithTarget(path.join(external, "audit.json"), records));
  assert.equal(outputConflictsWithTarget(path.join(temporary, "exports", "audit.json"), records), null);
  const guard = createTargetWriteGuard(records, (value) => `$PATH/${path.basename(value)}`, "seed");
  assert.equal(verifyTargetWriteGuard(guard, [packageRoot, stateDir]).ok, false);
  assert.equal(verifyTargetWriteGuard(guard, [packageRoot, stateDir, external]).ok, true);
  const incomplete = createTargetWriteGuard(records, (value) => `$PATH/${path.basename(value)}`, "seed", {
    complete: false,
    unresolvedCount: 1,
  });
  assert.equal(verifyTargetWriteGuard(incomplete, [packageRoot, stateDir, external]).reason, "incomplete-target-write-guard");
});
