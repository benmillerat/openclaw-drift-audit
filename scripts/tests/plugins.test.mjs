import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectPlugins } from "../lib/plugins.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "plugin-install");

test("reads the installed plugin index through a query-only SQLite handle", async (context) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    context.skip("node:sqlite unavailable");
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-plugins-"));
  const stateDir = path.join(temporary, "state-root");
  const pluginRoot = path.join(stateDir, "extensions", "example-plugin");
  const databaseDir = path.join(stateDir, "state");
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.cpSync(fixture, pluginRoot, { recursive: true });
  const manifestPath = path.join(pluginRoot, "openclaw.plugin.json");
  const manifestHash = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  const databasePath = path.join(databaseDir, "openclaw.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT, updated_at_ms INTEGER)");
  const value = {
    index: {
      version: 1,
      plugins: [{
        pluginId: "example-plugin",
        rootDir: pluginRoot,
        manifestPath,
        enabled: false,
        manifestHash,
      }],
      installRecords: { "example-plugin": { source: "npm", version: "1.0.0" } },
    },
  };
  database.prepare("INSERT INTO config_machine_state VALUES (?, ?, ?)").run(
    "plugins.installedIndex",
    JSON.stringify(value),
    1,
  );
  database.close();
  const before = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
  const result = await inspectPlugins({ stateDir, packageRoot: null, configuredPluginIds: [] });
  const after = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
  assert.equal(after, before);
  assert.equal(result.registry.present, true);
  assert.equal(result.plugins[0].manifestHashStatus, "match");
  assert.equal(result.plugins[0].installRecord.source, "npm");
  assert.equal(result.plugins[0].configured, false);
  assert.equal(result.plugins[0].dependencyAuditEligible, true);
  assert.deepEqual(result.gaps, []);
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-journal`), false);
});

test("discovers a configured plugin path without executing its entrypoint", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-plugin-path-"));
  const stateDir = path.join(temporary, "state-root");
  const pluginRoot = path.join(temporary, "external-plugin");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.cpSync(fixture, pluginRoot, { recursive: true });
  const result = await inspectPlugins({
    stateDir,
    packageRoot: null,
    configuredPluginIds: [],
    configuredPluginPaths: [pluginRoot],
    workspaceRoots: [],
  });
  const plugin = result.plugins.find((entry) => entry.id === "example-plugin");
  assert.ok(plugin);
  assert.equal(plugin.registry.origin, "config-load-path");
  assert.equal(plugin.primaryDiscoveryOrigin, "config-load-path");
  assert.equal(plugin.auditEligible, true);
  assert.equal(plugin.dependencyAuditEligible, true);
});

test("uses the runtime bundled-plugin tree selected by the host layout", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-bundled-root-"));
  const packageRoot = path.join(temporary, "package");
  const stateDir = path.join(temporary, "state");
  fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "pnpm-workspace.yaml"), "packages: []\n");
  fs.cpSync(fixture, path.join(packageRoot, "extensions", "example-plugin"), { recursive: true });
  fs.cpSync(fixture, path.join(packageRoot, "dist", "extensions", "example-plugin"), { recursive: true });
  const result = await inspectPlugins({
    stateDir,
    packageRoot,
    configuredPluginIds: ["example-plugin"],
    configuredPluginPaths: [],
    workspaceRoots: [],
  });
  const plugin = result.plugins.find((entry) => entry.id === "example-plugin");
  assert.ok(plugin);
  assert.match(plugin.root, /\/dist\/extensions\/example-plugin$/u);
  assert.equal(plugin.bundled, true);
});

test("honors a statically observed bundled-plugin disable flag", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-bundled-disabled-"));
  const packageRoot = path.join(temporary, "package");
  const stateDir = path.join(temporary, "state");
  fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "pnpm-workspace.yaml"), "packages: []\n");
  fs.cpSync(fixture, path.join(packageRoot, "extensions", "example-plugin"), { recursive: true });
  const result = await inspectPlugins({
    stateDir,
    packageRoot,
    configuredPluginIds: ["example-plugin"],
    configuredPluginPaths: [],
    workspaceRoots: [],
    bundledPluginsDisabled: true,
  });
  assert.equal(result.plugins.some((entry) => entry.id === "example-plugin"), false);
  assert.ok(result.gaps.some((gap) => gap.code === "configured-plugin-not-discovered"));
});

test("honors a trusted statically resolved bundled-plugin root override", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-bundled-override-"));
  const packageRoot = path.join(temporary, "package");
  const stateDir = path.join(temporary, "state");
  const overrideRoot = path.join(packageRoot, "dist-runtime", "extensions");
  fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "extensions"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "pnpm-workspace.yaml"), "packages: []\n");
  fs.cpSync(fixture, path.join(packageRoot, "dist", "extensions", "example-plugin"), { recursive: true });
  fs.cpSync(fixture, path.join(overrideRoot, "example-plugin"), { recursive: true });
  const result = await inspectPlugins({
    stateDir,
    packageRoot,
    configuredPluginIds: ["example-plugin"],
    configuredPluginPaths: [],
    workspaceRoots: [],
    bundledPluginsRootOverride: overrideRoot,
  });
  const plugin = result.plugins.find((entry) => entry.id === "example-plugin");
  assert.ok(plugin);
  assert.match(plugin.root, /\/dist-runtime\/extensions\/example-plugin$/u);
  assert.equal(plugin.bundled, true);
});

test("keeps bundled discovery ahead of global state discovery for the same root", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-plugin-priority-"));
  const packageRoot = path.join(temporary, "package");
  const stateDir = path.join(temporary, "state");
  const bundledPlugin = path.join(packageRoot, "dist", "extensions", "example-plugin");
  fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "extensions"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "extensions"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "pnpm-workspace.yaml"), "packages: []\n");
  fs.cpSync(fixture, bundledPlugin, { recursive: true });
  fs.symlinkSync(bundledPlugin, path.join(stateDir, "extensions", "example-plugin"));
  const result = await inspectPlugins({
    stateDir,
    packageRoot,
    configuredPluginIds: ["example-plugin"],
    configuredPluginPaths: [],
    workspaceRoots: [],
  });
  const plugin = result.plugins.find((entry) => entry.id === "example-plugin");
  assert.ok(plugin);
  assert.deepEqual(plugin.discoveryOrigins, ["bundled-config-reference", "state-extension"]);
  assert.equal(plugin.primaryDiscoveryOrigin, "bundled-config-reference");
});
