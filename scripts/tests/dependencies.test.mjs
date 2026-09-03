import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectDirectDependencies } from "../lib/dependencies.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures", "dependencies");

function inspect(name) {
  const rootDir = path.join(fixtureRoot, name);
  return inspectDirectDependencies(
    { id: `fixture:${name}`, rootDir },
    {
      aliasPath(value) {
        const relative = path.relative(rootDir, value);
        return relative === "" ? "$COMPONENT" : `$COMPONENT/${relative.split(path.sep).join("/")}`;
      },
      resolutionBoundary: rootDir,
    },
  );
}

function check(result, name, kind = "dependencies") {
  return result.checks.find((entry) => entry.name === name && entry.kind === kind);
}

function gapCodes(result) {
  return new Set(result.gaps.map((entry) => entry.code));
}

test("selects npm package-lock v3 and compares manifest, lock, and physical versions", () => {
  const result = inspect("npm-v3");
  assert.deepEqual(result.lockSelection, {
    status: "selected",
    manager: "npm",
    lockfile: "package-lock.json",
    path: "$COMPONENT/package-lock.json",
    adapter: "npm-lock-v2-v3",
    formatVersion: "3",
    importer: ".",
    documentIndex: null,
    selectedBy: "package-manager-and-manifest-match",
  });
  assert.equal(result.lockfiles[0].candidates[0].manifestComparison.status, "match");
  assert.deepEqual(check(result, "alpha").lock, {
    status: "selected",
    specifier: "^1.0.0",
    version: "1.2.3",
    hasIntegrity: true,
    declaredStatus: "match",
    declaredReason: undefined,
    installedStatus: "match",
  });
  assert.equal(check(result, "beta", "optionalDependencies").status, "match");
  assert.equal(check(result, "beta", "optionalDependencies").lock.installedStatus, "mismatch");
  assert.equal(check(result, "peer-only", "peerDependencies").lock.status, "not-selecting-peer");
  assert.equal(gapCodes(result).has("dependency-lock-selection-missing"), false);
});

test("selects npm-shrinkwrap v2 with the same static adapter", () => {
  const result = inspect("npm-shrinkwrap-v2");
  assert.equal(result.lockSelection.status, "selected");
  assert.equal(result.lockSelection.lockfile, "npm-shrinkwrap.json");
  assert.equal(result.lockSelection.formatVersion, "2");
  assert.equal(check(result, "alpha").lock.installedStatus, "match");
  assert.equal(check(result, "alpha").lock.hasIntegrity, true);
});

test("selects the matching project document from a real-shaped pnpm v9 multi-document lock", () => {
  const result = inspect("pnpm-multi");
  assert.equal(result.lockSelection.status, "selected");
  assert.equal(result.lockSelection.manager, "pnpm");
  assert.equal(result.lockSelection.adapter, "pnpm-lock-v9");
  assert.equal(result.lockSelection.documentIndex, 1);
  assert.deepEqual(result.lockfiles[0].documents.map((entry) => entry.status), ["environment-lock", "candidate"]);
  assert.equal(check(result, "alpha").lock.version, "1.2.3");
  assert.equal(check(result, "alpha").lock.hasIntegrity, null);
  assert.equal(check(result, "alpha").lock.installedStatus, "match");
  assert.equal(check(result, "@scope/beta", "optionalDependencies").lock.installedStatus, "match");
});

test("does not guess when two pnpm project documents match the manifest", () => {
  const result = inspect("ambiguous");
  assert.equal(result.lockSelection.status, "ambiguous");
  assert.equal(check(result, "alpha").lock.status, "unavailable");
  assert.equal(gapCodes(result).has("dependency-lock-selection-ambiguous"), true);
});

test("does not select a stale npm root whose direct specifiers differ from package.json", () => {
  const result = inspect("stale");
  assert.equal(result.lockSelection.status, "missing");
  assert.equal(check(result, "alpha").status, "match");
  assert.equal(check(result, "alpha").lock.status, "unavailable");
  assert.equal(gapCodes(result).has("dependency-lockfile-manifest-mismatch"), true);
  assert.equal(gapCodes(result).has("dependency-lock-selection-missing"), true);
});

test("reports a missing lock selection even when the physical dependency is consistent", () => {
  const result = inspect("missing");
  assert.equal(result.lockSelection.status, "missing");
  assert.equal(result.lockfiles.length, 0);
  assert.equal(check(result, "alpha").status, "match");
  assert.equal(check(result, "alpha").lock.status, "unavailable");
  assert.equal(gapCodes(result).has("dependency-lock-selection-missing"), true);
});

test("reports unsupported lockfile selection as coverage instead of interpreting it", () => {
  const result = inspect("unsupported");
  assert.equal(result.lockSelection.status, "missing");
  assert.equal(result.lockfiles[0].status, "unsupported");
  assert.equal(check(result, "alpha").lock.status, "unavailable");
  assert.equal(gapCodes(result).has("dependency-lock-selection-unsupported"), true);
  assert.equal(gapCodes(result).has("dependency-lock-selection-missing"), true);
});
