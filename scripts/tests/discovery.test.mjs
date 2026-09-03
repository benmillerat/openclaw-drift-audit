import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverInstallation, resolveEffectiveReleaseChannel } from "../lib/discovery.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

function withEmptyPath(callback) {
  const previous = process.env.PATH;
  process.env.PATH = "";
  try {
    return callback();
  } finally {
    process.env.PATH = previous;
  }
}

test("pins an explicitly selected immediate-predecessor package", () => {
  const result = withEmptyPath(() =>
    discoverInstallation({
      stateDir: path.join(os.tmpdir(), "openclaw-discovery-state"),
      packageRoot: path.join(fixtures, "v2026.8.1"),
    }),
  );
  assert.equal(result.status, "selected");
  assert.equal(result.packages[0].version, "2026.8.1");
  assert.equal(result.packages[0].versionPrereleaseClass, "stable");
});

test("requires selection when wrappers resolve to two viable installations", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discovery-ambiguous-"));
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  fs.cpSync(path.join(fixtures, "v2026.8.1"), first, { recursive: true });
  fs.cpSync(path.join(fixtures, "v2026.8.2"), second, { recursive: true });
  const firstLauncher = path.join(temporary, "openclaw-first");
  const secondLauncher = path.join(temporary, "openclaw-second");
  fs.writeFileSync(firstLauncher, `#!/bin/sh\nexec node "${path.join(first, "dist", "index.js")}" "$@"\n`);
  fs.writeFileSync(secondLauncher, `#!/bin/sh\nexec node "${path.join(second, "dist", "index.js")}" "$@"\n`);
  const result = withEmptyPath(() =>
    discoverInstallation({
      stateDir: path.join(temporary, "state"),
      launchers: [firstLauncher, secondLauncher],
    }),
  );
  assert.equal(result.status, "needs-selection");
  assert.deepEqual(result.packages.map((entry) => entry.version).sort(), ["2026.8.1", "2026.8.2"]);
  assert.equal(result.selectedPackageRoot, null);
});

test("does not silently bind a lone PATH package to default config and runtime identities", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discovery-single-"));
  const packageRoot = path.join(temporary, "package");
  fs.cpSync(path.join(fixtures, "v2026.8.2"), packageRoot, { recursive: true });
  const launcher = path.join(temporary, "openclaw");
  fs.writeFileSync(launcher, `#!/bin/sh\nexec node "${path.join(packageRoot, "dist", "index.js")}" "$@"\n`);
  const result = withEmptyPath(() => discoverInstallation({
    stateDir: path.join(temporary, "state"),
    launchers: [launcher],
  }));
  assert.equal(result.status, "needs-selection");
  assert.equal(result.selectedPackageRoot, null);
  assert.equal(result.selection.assurance, "unresolved");
});

test("classifies distinct prerelease channels", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discovery-channel-"));
  fs.cpSync(path.join(fixtures, "v2026.8.2"), temporary, { recursive: true });
  const manifestPath = path.join(temporary, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = "2026.9.0-beta.2";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const result = withEmptyPath(() => discoverInstallation({ stateDir: temporary, packageRoot: temporary }));
  assert.equal(result.packages[0].versionPrereleaseClass, "beta");
});

test("resolves the four official OpenClaw update channels from static evidence", () => {
  assert.deepEqual(
    resolveEffectiveReleaseChannel({ configChannel: "extended-stable", currentVersion: "2026.8.40", installKind: "package" }),
    { channel: "extended-stable", source: "config" },
  );
  assert.equal(
    resolveEffectiveReleaseChannel({ currentVersion: "2026.9.0-beta.2", installKind: "package" }).channel,
    "beta",
  );
  assert.equal(
    resolveEffectiveReleaseChannel({ currentVersion: "2026.8.2", installKind: "git", git: { branch: "main" } }).channel,
    "dev",
  );
  assert.equal(
    resolveEffectiveReleaseChannel({ currentVersion: "2026.8.40", installKind: "package" }).channel,
    "extended-stable",
  );
});

test("does not classify build-metadata package versions as extended stable", () => {
  assert.deepEqual(
    resolveEffectiveReleaseChannel({ currentVersion: "2026.8.40+build.1", installKind: "package" }),
    { channel: "stable", source: "default" },
  );
});

test("treats arbitrary semantic prerelease git tags as development releases", () => {
  assert.deepEqual(
    resolveEffectiveReleaseChannel({
      currentVersion: "2026.8.2",
      installKind: "git",
      git: { exactTag: "v2026.8.2-foo.1" },
    }),
    { channel: "dev", source: "git-tag" },
  );
});

test("reports lifecycle guards statically without starting the launcher", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discovery-guard-"));
  fs.cpSync(path.join(fixtures, "v2026.8.2"), temporary, { recursive: true });
  fs.writeFileSync(path.join(temporary, ".openclaw-lifecycle-pending"), "test-only");
  const result = withEmptyPath(() => discoverInstallation({ stateDir: temporary, packageRoot: temporary }));
  assert.equal(result.status, "selected");
  assert.equal(result.packages[0].lifecycleGuards.length, 1);
});
