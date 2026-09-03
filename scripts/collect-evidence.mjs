#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { inspectDirectDependencies } from "./lib/dependencies.mjs";
import {
  discoverInstallation,
  resolveEffectiveReleaseChannel,
  versionPrereleaseClass,
} from "./lib/discovery.mjs";
import { classifySourceReleaseBinding, inspectGit } from "./lib/git-evidence.mjs";
import { resolveConfigGraph } from "./lib/includes.mjs";
import { inspectPlugins } from "./lib/plugins.mjs";
import {
  collectConfiguredPluginIds,
  createDisclosureContext,
  discloseConfigEntries,
  sanitizeJsonPointer,
} from "./lib/redaction.mjs";
import {
  buildProtectedTargetGraph,
  configuredExternalRoots,
  createTargetWriteGuard,
  effectiveAgentWorkspaceRoots,
  exportDirectoryFingerprint,
  outputConflictsWithTarget,
  resolveConfiguredRuntimePath,
} from "./lib/target-graph.mjs";
import {
  canonicalWritePath,
  createPathAliaser,
  fingerprintFile,
  normalizeError,
  parseArgs,
  pathExists,
  safeRealpath,
  sanitizeUrl,
  sha256,
  stableStringify,
  writeJsonAtomic,
} from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2), {
  "state-dir": { type: "string" },
  config: { type: "string" },
  launcher: { type: "string", multiple: true },
  "package-root": { type: "string" },
  "source-root": { type: "string" },
  "include-root": { type: "string", multiple: true },
  "runtime-cwd": { type: "string" },
  profile: { type: "string", default: "offline-core" },
  "metadata-only": { type: "boolean", default: false },
  "run-id": { type: "string" },
  "started-at": { type: "string" },
  "test-redaction-seed": { type: "string" },
  output: { type: "string" },
  retention: { type: "string" },
  pretty: { type: "boolean", default: true },
});

function normalizedEnvironmentPath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed !== "undefined" && trimmed !== "null" ? trimmed : null;
}

function resolveStaticCwdPath(value, runtimeCwd) {
  const normalized = normalizedEnvironmentPath(value);
  if (!normalized) return null;
  if (path.isAbsolute(normalized)) return path.resolve(normalized);
  return runtimeCwd ? path.resolve(runtimeCwd, normalized) : null;
}

function resolveStaticEffectiveHome(env, runtimeCwd) {
  const termuxPrefix = normalizedEnvironmentPath(env.PREFIX);
  const termuxHome = termuxPrefix && normalizedEnvironmentPath(env.ANDROID_DATA) &&
      /(?:^|\/)com\.termux\/files\/usr\/?$/u.test(termuxPrefix.replace(/\\/gu, "/"))
    ? path.resolve(termuxPrefix, "..", "home")
    : null;
  const rawOsHome = normalizedEnvironmentPath(env.HOME) ??
    normalizedEnvironmentPath(env.USERPROFILE) ?? termuxHome ?? os.homedir();
  const osHome = resolveStaticCwdPath(rawOsHome, runtimeCwd);
  let rawHome = normalizedEnvironmentPath(env.OPENCLAW_HOME) ?? rawOsHome;
  if (rawHome === "~" || rawHome.startsWith("~/") || rawHome.startsWith("~\\")) {
    if (!osHome) return null;
    rawHome = rawHome.replace(/^~(?=$|[\\/])/u, osHome);
  }
  return resolveStaticCwdPath(rawHome, runtimeCwd);
}

if (args.profile !== "offline-core") {
  throw new Error("Public Preview 0.1 collector supports only --profile offline-core");
}
if (args.output && !args.retention) throw new Error("Persistent evidence export requires --retention");
if (!args.output && args.retention) throw new Error("--retention is only valid with --output");
if (args["runtime-cwd"] && !path.isAbsolute(args["runtime-cwd"])) {
  throw new Error("--runtime-cwd must be an absolute, explicitly pinned path");
}

const startedAt = args["started-at"] || new Date().toISOString();
const runId = args["run-id"] || crypto.randomUUID();
const discovery = discoverInstallation({
  stateDir: args["state-dir"],
  configPath: args.config,
  launchers: args.launcher,
  packageRoot: args["package-root"],
  sourceRoot: args["source-root"],
});
const packageRoot = discovery.selectedPackageRoot;
const sourceRoot = args["source-root"] ? safeRealpath(args["source-root"]) : packageRoot;
const aliasPath = createPathAliaser({
  state: discovery.stateDir,
  config: discovery.configPath,
  packageRoot,
  sourceRoot,
});

if (args["test-redaction-seed"] !== undefined) {
  const tempRoot = safeRealpath(os.tmpdir());
  const testRoots = [discovery.stateDir, packageRoot, sourceRoot].filter(Boolean).map(safeRealpath);
  if (process.env.NODE_ENV !== "test" || testRoots.some((root) => !root.startsWith(`${tempRoot}${path.sep}`))) {
    throw new Error("--test-redaction-seed is restricted to NODE_ENV=test targets under the OS temporary directory");
  }
}

function sanitizeText(value) {
  if (typeof value !== "string") return value;
  let result = value;
  const replacements = [
    [sourceRoot, "$SOURCE"],
    [packageRoot, "$PACKAGE"],
    [discovery.stateDir, "$STATE"],
    [path.dirname(discovery.configPath), "$CONFIG"],
    [os.homedir(), "~"],
  ]
    .filter(([raw]) => typeof raw === "string" && raw.length > 0)
    .sort((left, right) => right[0].length - left[0].length);
  for (const [raw, label] of replacements) result = result.split(raw).join(label);
  result = result.replace(/(?:git\+)?https?:\/\/[^\s"'<>]+/gu, (url) => sanitizeUrl(url) ?? "$REDACTED_URL");
  if (/^(?:file:|link:)\//u.test(result)) {
    const prefix = result.slice(0, result.indexOf(":") + 1);
    return `${prefix}${aliasPath(result.slice(prefix.length))}`;
  }
  if (path.isAbsolute(result)) return aliasPath(result);
  result = result.replace(/\/(?:Users|home|private|var|opt|tmp)\/[^\s"']+/gu, (match) => `$ABS/${sha256(match).slice(0, 16)}`);
  return result;
}

function sanitizeDiagnostic(value) {
  const categories = [
    [/ENOENT|no such file|not found/iu, "filesystem-not-found"],
    [/EACCES|EPERM|permission denied/iu, "filesystem-permission-denied"],
    [/File exceeds/iu, "file-size-limit"],
    [/Circular include/iu, "include-cycle"],
    [/Maximum include depth/iu, "include-depth-limit"],
    [/Include path escapes/iu, "include-path-escape"],
    [/JSON|Unexpected token|identifier|unterminated|escape|object key/iu, "parse-error"],
    [/database|sqlite|SQLITE/iu, "sqlite-read-failed"],
    [/git exited|work tree|work-tree/iu, "git-inspection-failed"],
  ];
  for (const [pattern, category] of categories) if (pattern.test(value)) return category;
  return "redacted-diagnostic";
}

function sanitizeDeep(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => sanitizeDeep(entry, key));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (/^(?:message|error)$/u.test(key)) return sanitizeDiagnostic(value);
    if (key === "pointer") {
      try {
        return sanitizeJsonPointer(value, disclosureContext);
      } catch {
        return "$REDACTED_POINTER";
      }
    }
    if (/^(?:id|pluginId|componentId|packageName)$/u.test(key)) {
      return /^[A-Za-z0-9@._:+\-/]{1,256}$/u.test(value) ? value : "$REDACTED_IDENTITY";
    }
    if (/^(?:name)$/u.test(key) && !/^[A-Za-z0-9@._:+\-/]{1,128}$/u.test(value)) {
      return "$REDACTED_NAME";
    }
    if (/^(?:entry)$/u.test(key)) {
      const sanitized = sanitizeText(value);
      return /^[A-Za-z0-9@$._:+\-/]{1,512}$/u.test(sanitized) ? sanitized : "$REDACTED_ENTRY";
    }
    if (/^(?:path|realPath|root|rootDir|manifestPath|packageJsonPath|databasePath|resolvedRoot|originalPath)$/u.test(key)) {
      return path.isAbsolute(value) ? aliasPath(value) : sanitizeText(value);
    }
    if (/^(?:spec|resolvedSpec)$/u.test(key) && /^(?:file:|link:|\/|\.\.\/|\.\/)/u.test(value)) {
      const stripped = value.replace(/^(?:file:|link:)/u, "");
      return `${value.startsWith("link:") ? "link:" : value.startsWith("file:") ? "file:" : ""}${aliasPath(stripped)}`;
    }
    if (/^(?:mode|type|status|kind|origin|source|setupSource|artifactKind|artifactFormat|version|packageVersion|resolvedVersion|minHostVersion|minGatewayVersion|pluginApi|channel|openclawVersion)$/u.test(key)) {
      const sanitized = sanitizeText(value);
      return /^[A-Za-z0-9@$._:+\-/=]{1,512}$/u.test(sanitized) ? sanitized : "$REDACTED_STRUCTURAL_VALUE";
    }
    return sanitizeText(value);
  }
  const result = {};
  let redactedKeyIndex = 0;
  for (const [childKey, child] of Object.entries(value)) {
    // Object keys are data too. Most keys below are scanner-owned structure,
    // but bounded manifest maps (for example schemaVersions) can contribute
    // attacker-controlled keys. Keep only inert identifier-shaped names and
    // replace everything else without hashing potentially secret key text.
    const outputKey = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(childKey)
      ? childKey
      : `$key-redacted-${String(++redactedKeyIndex).padStart(3, "0")}`;
    result[outputKey] = sanitizeDeep(child, outputKey);
  }
  return result;
}

const initialFingerprintPaths = [
  discovery.configPath,
  packageRoot ? path.join(packageRoot, "package.json") : null,
  packageRoot ? path.join(packageRoot, "dist", "build-info.json") : null,
  path.join(discovery.stateDir, "state", "openclaw.sqlite"),
].filter(Boolean);
const beforeFingerprints = new Map(
  initialFingerprintPaths.map((filePath) => [filePath, fingerprintFile(filePath)]),
);

const coverageGaps = [];
if (discovery.status !== "selected") {
  coverageGaps.push({
    id: "gap-installation-target-selection",
    class: "installation",
    reason: discovery.status,
    requiredAction: discovery.status === "needs-selection" ? "select-one-package-root" : "supply-package-root",
  });
}

const includeRoots = args["include-root"].map((entry) => path.resolve(entry));
const configGraph = discovery.configExists
  ? resolveConfigGraph(discovery.configPath, { allowedRoots: includeRoots })
  : {
      ok: false,
      authored: null,
      resolved: null,
      provenance: new Map(),
      files: [],
      edges: [],
      diagnostics: [{ code: "config-file-missing", severity: "error" }],
    };
if (!configGraph.ok) {
  coverageGaps.push({ id: "gap-config-resolution", class: "configuration", reason: "resolution-failed" });
}

const disclosureContext = createDisclosureContext(args["test-redaction-seed"]);
disclosureContext.metadataOnly = args["metadata-only"];
const provenanceForPointer = (parts) => {
  const pointer = parts.length === 0
    ? ""
    : `/${parts.map((part) => String(part).replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`;
  return (configGraph.provenance.get(pointer) ?? []).map(aliasPath).sort();
};
const authoredEntries = configGraph.authored
  ? discloseConfigEntries(configGraph.authored, () => [aliasPath(discovery.configPath)], disclosureContext)
  : [];
const resolvedEntries = configGraph.resolved
  ? discloseConfigEntries(configGraph.resolved, provenanceForPointer, disclosureContext)
  : [];
const resolvedSameAsAuthored = configGraph.ok && configGraph.edges.length === 0;
const configuredPluginIds = configGraph.resolved ? collectConfiguredPluginIds(configGraph.resolved) : [];
const runtimeCwd = args["runtime-cwd"] ? safeRealpath(args["runtime-cwd"]) : null;
// Invocation environment is static evidence only. Values influence protected
// path resolution but are never copied into model-visible evidence.
const effectiveHomeDir = resolveStaticEffectiveHome(process.env, runtimeCwd);
const bundledPluginsRootOverrideConfigured = Boolean(
  normalizedEnvironmentPath(process.env.OPENCLAW_BUNDLED_PLUGINS_DIR),
);
const bundledPluginsRootOverride = resolveConfiguredRuntimePath(
  process.env.OPENCLAW_BUNDLED_PLUGINS_DIR,
  { runtimeCwd, effectiveHomeDir },
);
const bundledPluginsDisabled = new Set(["1", "true"]).has(
  process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim().toLowerCase(),
);
const externalReferences = configGraph.resolved
  ? configuredExternalRoots(configGraph.resolved, { runtimeCwd, effectiveHomeDir })
  : { roots: [], gaps: [] };
const effectiveWorkspaces = configGraph.resolved
  ? effectiveAgentWorkspaceRoots(configGraph.resolved, {
      stateDir: discovery.stateDir,
      runtimeCwd,
      effectiveHomeDir,
      runtimeWorkspaceDir: process.env.OPENCLAW_WORKSPACE_DIR,
    })
  : { roots: [], gaps: [] };
for (const gap of [...externalReferences.gaps, ...effectiveWorkspaces.gaps]) {
  coverageGaps.push({
    id: `gap-installation-graph-${sha256(JSON.stringify(gap)).slice(0, 12)}`,
    class: "installation",
    reason: gap.code,
    details: sanitizeDeep(gap),
  });
}
const workspaceRoots = [...new Set(effectiveWorkspaces.roots.map((entry) => entry.path))];
const configuredPluginPaths = externalReferences.roots
  .filter((entry) => entry.role === "plugin-load-path")
  .map((entry) => entry.path);

const pluginEvidence = await inspectPlugins({
  stateDir: discovery.stateDir,
  packageRoot,
  configuredPluginIds,
  configuredPluginPaths,
  workspaceRoots,
  bundledPluginsDisabled,
  bundledPluginsRootOverride,
  bundledPluginsRootOverrideConfigured,
});
for (const gap of pluginEvidence.gaps) {
  coverageGaps.push({
    id: `gap-plugin-${sha256(JSON.stringify(gap)).slice(0, 12)}`,
    class: "plugin-provenance",
    reason: gap.code,
    details: sanitizeDeep(gap),
  });
}

const git = sourceRoot ? inspectGit(sourceRoot, aliasPath) : { present: false };
const selectedPackage = packageRoot
  ? discovery.packages.find((entry) => safeRealpath(entry.rootDir) === safeRealpath(packageRoot))
  : null;
const effectiveReleaseChannel = resolveEffectiveReleaseChannel({
  configChannel: configGraph.resolved?.update?.channel,
  currentVersion: selectedPackage?.version,
  installKind: selectedPackage?.installKind === "source-checkout" ? "git" : selectedPackage ? "package" : "unknown",
  git,
});
if (selectedPackage) {
  selectedPackage.releaseChannel = effectiveReleaseChannel.channel;
  selectedPackage.releaseChannelSource = effectiveReleaseChannel.source;
}
const sourceReleaseBinding = classifySourceReleaseBinding(git, selectedPackage?.version);

const rawComponents = [];
if (packageRoot) {
  rawComponents.push({
    id: `openclaw:${selectedPackage?.version || "unknown"}:${(selectedPackage?.packageJsonSha256 || "unknown").slice(0, 12)}`,
    kind: "openclaw",
    rootDir: packageRoot,
    version: selectedPackage?.version ?? null,
    releaseChannel: selectedPackage?.releaseChannel ?? "unknown",
    sourceReleaseBinding,
    packageName: "openclaw",
    packageJsonSha256: selectedPackage?.packageJsonSha256 ?? null,
  });
}
for (const plugin of pluginEvidence.plugins) {
  if (!plugin.auditEligible || !plugin.root || !plugin.packageJsonPath) continue;
  rawComponents.push({
    id: `plugin:${plugin.id}:${(plugin.manifestSha256 || "unknown").slice(0, 12)}`,
    kind: "plugin",
    pluginId: plugin.id,
    rootDir: plugin.root,
    version: plugin.version,
    releaseChannel: null,
    versionPrereleaseClass: versionPrereleaseClass(plugin.version),
    packageName: plugin.packageName,
    packageJsonSha256: plugin.packageJsonSha256,
    bundled: plugin.bundled,
    dependencyAuditEligible: plugin.dependencyAuditEligible,
  });
}

const dependencies = [];
const dependencyComponents = rawComponents.filter((component) =>
  component.kind === "openclaw" || component.dependencyAuditEligible,
);
for (const component of dependencyComponents.slice(0, 250)) {
  const result = inspectDirectDependencies(component, { aliasPath });
  dependencies.push(result);
  for (const gap of result.gaps) {
    coverageGaps.push({
      id: `gap-dependency-${sha256(`${component.id}:${JSON.stringify(gap)}`).slice(0, 12)}`,
      class: "direct-dependencies",
      componentId: component.id,
      reason: gap.code,
      details: sanitizeDeep(gap),
    });
  }
}
if (dependencyComponents.length > 250) {
  coverageGaps.push({
    id: "gap-component-budget",
    class: "direct-dependencies",
    reason: "component-budget-exceeded",
    observed: dependencyComponents.length,
    limit: 250,
  });
}

const MIGRATION_SOURCE_FILE_LIMIT = 512;
const MIGRATION_SOURCE_SCAN_ENTRY_LIMIT = 4096;
const MIGRATION_SOURCE_FILE_BYTES_LIMIT = 8 * 1024 * 1024;
const MIGRATION_SOURCE_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;
const MIGRATION_SOURCE_CLASSES = [
  "release-history",
  "config-lifecycle",
  "state-lifecycle",
  "plugin-compatibility",
];

function isMigrationTestSource(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => new Set(["test", "tests", "__tests__", "fixtures"]).has(segment))) {
    return true;
  }
  return /\.(?:test|spec)(?:[-.][^.]+)*\.[cm]?[jt]sx?$/u.test(relativePath);
}

function classifyMigrationSource(relativePath) {
  if (isMigrationTestSource(relativePath)) return null;
  if (relativePath === "CHANGELOG.md") {
    return { sourceClass: "release-history", sourceKind: "changelog" };
  }
  if (/^docs\/releases\/[^/]+\.md$/u.test(relativePath)) {
    return { sourceClass: "release-history", sourceKind: "release-note" };
  }
  if (new Set(["docs/cli/doctor.md", "docs/gateway/doctor.md"]).has(relativePath)) {
    return { sourceClass: "release-history", sourceKind: "doctor-documentation" };
  }
  if (relativePath === "src/plugins/doctor-contract-registry.ts") {
    return { sourceClass: "plugin-compatibility", sourceKind: "doctor-contract-registry" };
  }
  if (relativePath === "src/plugins/compat/registry-records.ts") {
    return { sourceClass: "plugin-compatibility", sourceKind: "compatibility-registry" };
  }
  if (/^src\/plugins\/(?:compat\/)?[^/]*(?:legacy|migration|deprecation)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "plugin-compatibility", sourceKind: "plugin-lifecycle" };
  }
  if (relativePath === "src/commands/doctor/shared/deprecation-compat.ts") {
    return { sourceClass: "config-lifecycle", sourceKind: "deprecation-contract" };
  }
  if (relativePath === "src/commands/doctor/shared/automatic-startup-config-repair.ts") {
    return { sourceClass: "config-lifecycle", sourceKind: "startup-config-repair" };
  }
  if (
    /^src\/commands\/doctor\/shared\/[^/]*(?:legacy|migration|deprecation)[^/]*\.ts$/u.test(
      relativePath,
    )
  ) {
    return { sourceClass: "config-lifecycle", sourceKind: "doctor-config-migration" };
  }
  if (/^src\/commands\/doctor\/cron\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "state-lifecycle", sourceKind: "cron-migration" };
  }
  if (/^src\/commands\/(?:doctor\/)?[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return {
      sourceClass: relativePath.includes("config") ? "config-lifecycle" : "state-lifecycle",
      sourceKind: "command-migration",
    };
  }
  if (/^src\/config\/sessions\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "state-lifecycle", sourceKind: "session-migration" };
  }
  if (/^src\/config\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "config-lifecycle", sourceKind: "runtime-config-compatibility" };
  }
  if (/^src\/infra\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "state-lifecycle", sourceKind: "state-migration" };
  }
  if (/^src\/infra\/outbound\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "state-lifecycle", sourceKind: "state-migration" };
  }
  if (/^src\/state\/[^/]*(?:legacy|migration)[^/]*\.ts$/u.test(relativePath)) {
    return { sourceClass: "state-lifecycle", sourceKind: "state-store-migration" };
  }
  return null;
}

function migrationSources(rootDir) {
  const entries = [];
  const gaps = [];
  if (!rootDir || !pathExists(rootDir)) {
    return {
      entries,
      gaps: [{ reason: "migration-source-root-unavailable" }],
    };
  }

  const canonicalRoot = safeRealpath(rootDir);
  try {
    if (!fs.lstatSync(canonicalRoot).isDirectory()) {
      return { entries, gaps: [{ reason: "migration-source-root-unavailable" }] };
    }
  } catch {
    return { entries, gaps: [{ reason: "migration-source-root-unavailable" }] };
  }
  const candidates = new Map();
  let scannedEntries = 0;
  let scanBudgetExceeded = false;
  let skippedSymlinks = 0;
  const skippedSymlinkPaths = [];
  const recordSymlink = (filePath) => {
    skippedSymlinks += 1;
    if (skippedSymlinkPaths.length < 20) skippedSymlinkPaths.push(aliasPath(filePath));
  };
  const addCandidate = (filePath, relativePath) => {
    const classification = classifyMigrationSource(relativePath);
    if (!classification) return;
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      recordSymlink(filePath);
      return;
    }
    if (!stat.isFile()) return;
    candidates.set(relativePath, { filePath, relativePath, stat, ...classification });
  };

  for (const relativePath of [
    "CHANGELOG.md",
    "docs/cli/doctor.md",
    "docs/gateway/doctor.md",
    "src/plugins/doctor-contract-registry.ts",
    "src/plugins/compat/registry-records.ts",
  ]) {
    addCandidate(path.join(canonicalRoot, relativePath), relativePath);
  }
  for (const relativeDir of [
    "docs/releases",
    "src/commands",
    "src/commands/doctor",
    "src/commands/doctor/cron",
    "src/commands/doctor/shared",
    "src/config",
    "src/config/sessions",
    "src/infra",
    "src/infra/outbound",
    "src/state",
    "src/plugins",
    "src/plugins/compat",
  ]) {
    const directoryPath = path.join(canonicalRoot, relativeDir);
    let directoryStat;
    try {
      directoryStat = fs.lstatSync(directoryPath);
    } catch {
      continue;
    }
    if (directoryStat.isSymbolicLink()) {
      recordSymlink(directoryPath);
      continue;
    }
    if (!directoryStat.isDirectory()) continue;
    let children;
    try {
      children = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch (error) {
      gaps.push({
        reason: "migration-source-directory-unreadable",
        path: aliasPath(directoryPath),
        error: normalizeError(error),
      });
      continue;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      scannedEntries += 1;
      if (scannedEntries > MIGRATION_SOURCE_SCAN_ENTRY_LIMIT) {
        scanBudgetExceeded = true;
        break;
      }
      const filePath = path.join(directoryPath, child.name);
      const relativePath = `${relativeDir}/${child.name}`;
      if (child.isSymbolicLink()) {
        if (classifyMigrationSource(relativePath)) recordSymlink(filePath);
        continue;
      }
      if (child.isFile()) addCandidate(filePath, relativePath);
    }
    if (scanBudgetExceeded) break;
  }

  if (skippedSymlinks > 0) {
    gaps.push({
      reason: "migration-source-symlink-skipped",
      observed: skippedSymlinks,
      paths: skippedSymlinkPaths,
    });
  }
  if (scanBudgetExceeded) {
    gaps.push({
      reason: "migration-source-scan-budget-exceeded",
      observed: scannedEntries,
      limit: MIGRATION_SOURCE_SCAN_ENTRY_LIMIT,
    });
  }

  const sortedCandidates = [...candidates.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const selectedCandidates = sortedCandidates.slice(0, MIGRATION_SOURCE_FILE_LIMIT);
  if (sortedCandidates.length > MIGRATION_SOURCE_FILE_LIMIT) {
    gaps.push({
      reason: "migration-source-file-budget-exceeded",
      observed: sortedCandidates.length,
      limit: MIGRATION_SOURCE_FILE_LIMIT,
    });
  }

  let totalBytes = 0;
  for (const candidate of selectedCandidates) {
    if (candidate.stat.size > MIGRATION_SOURCE_FILE_BYTES_LIMIT) {
      gaps.push({
        reason: "migration-source-file-size-exceeded",
        path: aliasPath(candidate.filePath),
        observed: candidate.stat.size,
        limit: MIGRATION_SOURCE_FILE_BYTES_LIMIT,
      });
      continue;
    }
    if (totalBytes + candidate.stat.size > MIGRATION_SOURCE_TOTAL_BYTES_LIMIT) {
      gaps.push({
        reason: "migration-source-total-byte-budget-exceeded",
        observed: totalBytes + candidate.stat.size,
        limit: MIGRATION_SOURCE_TOTAL_BYTES_LIMIT,
      });
      break;
    }
    let descriptor;
    try {
      const fd = fs.openSync(
        candidate.filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      try {
        const opened = fs.fstatSync(fd);
        if (!opened.isFile()) throw new Error("Migration source is not a regular file");
        if (opened.size > MIGRATION_SOURCE_FILE_BYTES_LIMIT) {
          gaps.push({
            reason: "migration-source-file-size-exceeded",
            path: aliasPath(candidate.filePath),
            observed: opened.size,
            limit: MIGRATION_SOURCE_FILE_BYTES_LIMIT,
          });
          continue;
        }
        if (totalBytes + opened.size > MIGRATION_SOURCE_TOTAL_BYTES_LIMIT) {
          gaps.push({
            reason: "migration-source-total-byte-budget-exceeded",
            observed: totalBytes + opened.size,
            limit: MIGRATION_SOURCE_TOTAL_BYTES_LIMIT,
          });
          break;
        }
        const allocated = Buffer.alloc(opened.size);
        let bytesRead = 0;
        while (bytesRead < allocated.length) {
          const count = fs.readSync(
            fd,
            allocated,
            bytesRead,
            allocated.length - bytesRead,
            bytesRead,
          );
          if (count === 0) break;
          bytesRead += count;
        }
        const buffer = allocated.subarray(0, bytesRead);
        const after = fs.fstatSync(fd);
        descriptor = {
          path: aliasPath(candidate.filePath),
          present: true,
          sourceClass: candidate.sourceClass,
          sourceKind: candidate.sourceKind,
          bytes: buffer.byteLength,
          sha256: sha256(buffer),
          stable:
            opened.size === after.size &&
            opened.ino === after.ino &&
            opened.mtimeMs === after.mtimeMs,
        };
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      gaps.push({
        reason: "migration-source-read-failed",
        path: aliasPath(candidate.filePath),
        error: normalizeError(error),
      });
      continue;
    }
    totalBytes += descriptor.bytes;
    entries.push(descriptor);
    if (!descriptor.stable) {
      gaps.push({
        reason: "migration-source-changed-during-observation-window",
        path: descriptor.path,
      });
    }
  }

  for (const sourceClass of MIGRATION_SOURCE_CLASSES) {
    if (!entries.some((entry) => entry.sourceClass === sourceClass)) {
      gaps.push({ reason: "migration-source-class-missing", sourceClass });
    }
  }
  if (entries.length === 0) gaps.push({ reason: "no-local-versioned-migration-sources" });
  return { entries, gaps };
}

const migrationEvidence = migrationSources(sourceRoot);
for (const [index, gap] of migrationEvidence.gaps.entries()) {
  coverageGaps.push({
    id: `gap-migration-source-${index}-${sha256(JSON.stringify(gap)).slice(0, 12)}`,
    class: "migration-chains",
    ...gap,
  });
}

for (const file of configGraph.files) {
  if (!beforeFingerprints.has(file.path)) {
    beforeFingerprints.set(file.path, {
      exists: true,
      type: "file",
      ...file.before,
      sha256: file.sha256,
      stable: file.stable,
    });
  }
}
const afterFingerprints = new Map(
  [...beforeFingerprints.keys()].map((filePath) => [filePath, fingerprintFile(filePath)]),
);
const consistency = [...beforeFingerprints.entries()].map(([filePath, before]) => {
  const after = afterFingerprints.get(filePath);
  const stable =
    before.exists === after.exists &&
    before.sha256 === after.sha256 &&
    before.size === after.size &&
    before.ino === after.ino;
  if (!stable) {
    coverageGaps.push({
      id: `gap-concurrent-mutation-${sha256(filePath).slice(0, 12)}`,
      class: "consistency",
      reason: "source-changed-during-observation-window",
      path: aliasPath(filePath),
    });
  }
  return { path: aliasPath(filePath), stable, before, after };
});

const unresolvedTargetIdentities = [
  "managed-service-definition",
  "running-gateway",
  "desktop-runtime",
  ...([...externalReferences.gaps, ...effectiveWorkspaces.gaps].length > 0
    ? ["external-workspace-references"]
    : []),
];
for (const identity of unresolvedTargetIdentities) {
  coverageGaps.push({
    id: `gap-installation-identity-${identity}`,
    class: "installation",
    reason: "target-identity-not-observed-in-preview-offline-core",
    identity,
  });
}
const protectedTargetGraph = buildProtectedTargetGraph({
  discovery,
  packageRoot,
  sourceRoot,
  includeRoots,
  configFiles: configGraph.files,
  plugins: pluginEvidence.plugins,
  externalRoots: [...externalReferences.roots, ...effectiveWorkspaces.roots],
});
// Every gap produced by these resolvers means at least one configured target
// root is absent from the protected graph. Export must therefore fail closed,
// including when a bounded inventory truncates otherwise resolvable roots.
const unresolvedWriteRoots = [...externalReferences.gaps, ...effectiveWorkspaces.gaps];
const targetWriteGuard = createTargetWriteGuard(
  protectedTargetGraph,
  aliasPath,
  args["test-redaction-seed"],
  { complete: unresolvedWriteRoots.length === 0, unresolvedCount: unresolvedWriteRoots.length },
);
let evidenceOutputPath = null;
let exportBoundary = null;
if (args.output) {
  if (!targetWriteGuard.complete) {
    throw new Error("Evidence output is disabled because configured target roots are not statically resolved; pin --runtime-cwd");
  }
  evidenceOutputPath = canonicalWritePath(args.output);
  if (outputConflictsWithTarget(evidenceOutputPath, protectedTargetGraph)) {
    throw new Error("Evidence output must be outside the canonical Installation Target");
  }
  exportBoundary = {
    mode: "portable-redacted",
    directoryFingerprint: exportDirectoryFingerprint(targetWriteGuard.salt, path.dirname(evidenceOutputPath)),
    retention: args.retention,
  };
}
const sanitizedDiscovery = sanitizeDeep({
  ...discovery,
  selection: {
    ...discovery.selection,
    unresolvedRuntimeIdentities: unresolvedTargetIdentities,
    runtimeCwdSource: runtimeCwd ? "explicit" : "unresolved",
  },
  stateDir: aliasPath(discovery.stateDir),
  configPath: aliasPath(discovery.configPath),
  selectedPackageRoot: discovery.selectedPackageRoot ? aliasPath(discovery.selectedPackageRoot) : null,
});
const sanitizedPlugins = sanitizeDeep(pluginEvidence);
const endedAt = args["started-at"] ? args["started-at"] : new Date().toISOString();

const evidence = {
  evidenceSchemaVersion: "0.1.0",
  kind: "openclaw-drift-evidence",
  run: {
    id: runId,
    profile: "offline-core",
    metadataOnly: args["metadata-only"],
    observationWindow: { startedAt, endedAt },
    intentionalTargetMutation: false,
    networkUsed: false,
    persistentArtifactsCreated: Boolean(args.output),
    budgets: {
      directComponentLimit: 250,
      migrationSourceFileLimit: MIGRATION_SOURCE_FILE_LIMIT,
      migrationSourceScanEntryLimit: MIGRATION_SOURCE_SCAN_ENTRY_LIMIT,
      migrationSourceFileBytesLimit: MIGRATION_SOURCE_FILE_BYTES_LIMIT,
      migrationSourceTotalBytesLimit: MIGRATION_SOURCE_TOTAL_BYTES_LIMIT,
      semanticPayloadStrategy: "role-sliced",
    },
  },
  exportBoundary,
  target: {
    ...sanitizedDiscovery,
    graphResolution: "static-partial",
    writeGuard: targetWriteGuard,
  },
  capabilities: [
    { id: "installation-discovery", status: "partial", implementationVersion: "0.1.0" },
    { id: "config-include-resolution", status: configGraph.ok ? "performed" : "partial", implementationVersion: "0.1.0" },
    { id: "plugin-provenance-static", status: "performed", implementationVersion: "0.1.0" },
    { id: "direct-dependency-consistency-static", status: dependencies.length > 0 ? "performed" : "partial", implementationVersion: "0.1.0" },
    { id: "source-artifact-state-static", status: "performed", implementationVersion: "0.1.0" },
    {
      id: "migration-source-inventory",
      status: migrationEvidence.gaps.length > 0 ? "partial" : "performed",
      implementationVersion: "0.1.0",
    },
  ],
  configuration: {
    status: configGraph.ok ? "resolved" : "unresolved",
    root: aliasPath(discovery.configPath),
    authoredEntries,
    resolvedEntries: resolvedSameAsAuthored ? [] : resolvedEntries,
    resolvedSameAsAuthored,
    includeFiles: configGraph.files.map((entry) => sanitizeDeep(entry)),
    includeEdges: configGraph.edges.map((entry) => sanitizeDeep(entry)),
    diagnostics: configGraph.diagnostics.map((entry) => sanitizeDeep(entry)),
  },
  components: rawComponents.map((component) => sanitizeDeep(component)),
  plugins: sanitizedPlugins,
  dependencies: sanitizeDeep(dependencies),
  source: sanitizeDeep({ git, releaseBinding: sourceReleaseBinding }),
  migrationSourceInventory: sanitizeDeep(migrationEvidence.entries),
  coverage: {
    classes: [
      { id: "installation", status: "partial", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "configuration", status: configGraph.ok ? "examined" : "partial", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "includes", status: configGraph.ok ? "examined" : "partial", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "plugin-provenance", status: pluginEvidence.registry.present ? "examined" : "partial", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "direct-dependencies", status: dependencies.length > 0 ? "examined" : "partial", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "source-artifact-state", status: "examined", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "migration-chains", status: "source-inventory-only", modelDisclosure: "allowlisted-redacted-structure" },
      { id: "logs", status: "finding-triggered-not-run", modelDisclosure: "none" },
      { id: "memories", status: "finding-triggered-not-run", modelDisclosure: "none" },
      { id: "transcripts", status: "finding-triggered-not-run", modelDisclosure: "none" },
    ],
    gaps: sanitizeDeep(coverageGaps),
  },
  consistency: sanitizeDeep(consistency),
  redaction: {
    policy: "allowlist-plus-secret-deny",
    modelVisibleRawValues: false,
    secretValuesHashed: false,
    clearConfigScalars: [...authoredEntries, ...(resolvedSameAsAuthored ? [] : resolvedEntries)].filter((entry) => entry.disclosure === "clear").length,
    redactedConfigScalars: [...authoredEntries, ...(resolvedSameAsAuthored ? [] : resolvedEntries)].filter((entry) => entry.disclosure?.startsWith("redacted")).length,
  },
};

const serialized = `${args.pretty ? stableStringify(evidence) : JSON.stringify(evidence)}\n`;
for (const forbidden of protectedTargetGraph.map((entry) => entry.path)) {
  if (serialized.includes(forbidden)) {
    throw new Error(`Redaction boundary failure for path alias ${aliasPath(forbidden)}`);
  }
}

if (args.output) {
  writeJsonAtomic(evidenceOutputPath, evidence);
} else {
  process.stdout.write(serialized);
}
