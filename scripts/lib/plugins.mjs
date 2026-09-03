import fs from "node:fs";
import path from "node:path";
import { parseJson5 } from "./json5.mjs";
import { normalizeSchemaConstraints } from "./redaction.mjs";
import { isInside, normalizeError, pathExists, readTextFile, safeRealpath, sanitizeUrl } from "./util.mjs";

function safeString(value, max = 256) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function safeVersionContract(value) {
  if (typeof value === "string") return value.slice(0, 128);
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").slice(0, 100);
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:minHostVersion|minGatewayVersion|pluginApi|tested|version|channel|openclawVersion)$/u.test(key)) {
      result[key] = safeVersionContract(entry);
    }
  }
  return result;
}

function safeInstallRecord(record) {
  if (!record || typeof record !== "object") return null;
  const result = {};
  for (const key of [
    "source",
    "spec",
    "version",
    "resolvedName",
    "resolvedSpec",
    "resolvedVersion",
    "artifactKind",
    "artifactFormat",
    "integrity",
    "npmIntegrity",
    "npmShasum",
    "shasum",
    "clawpackSha256",
    "clawhubPackage",
    "clawhubFamily",
    "clawhubChannel",
    "clawhubTrustDisposition",
    "clawhubTrustScanStatus",
  ]) {
    const value = record[key];
    if (typeof value === "string") result[key] = value.slice(0, 512);
  }
  return result;
}

async function readInstalledIndex(databasePath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    return { ok: false, gap: { code: "node-sqlite-unavailable", message: normalizeError(error) } };
  }
  if (!pathExists(databasePath)) return { ok: false, gap: { code: "plugin-index-database-missing" } };
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
    database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250;");
    const row = database
      .prepare("SELECT value_json, updated_at_ms FROM config_machine_state WHERE state_key = ?")
      .get("plugins.installedIndex");
    if (!row) return { ok: false, gap: { code: "plugin-index-row-missing" } };
    const parsed = JSON.parse(row.value_json);
    return { ok: true, value: parsed, updatedAtMs: Number(row.updated_at_ms) };
  } catch (error) {
    return { ok: false, gap: { code: "plugin-index-unreadable", message: normalizeError(error) } };
  } finally {
    try {
      database?.close();
    } catch {
      // The read-only handle is already unusable; the original result remains authoritative.
    }
  }
}

function manifestAt(rootDir, explicitManifestPath) {
  const root = safeRealpath(rootDir);
  const candidate = explicitManifestPath || path.join(root, "openclaw.plugin.json");
  const manifestPath = safeRealpath(candidate);
  if (!isInside(root, manifestPath) || path.basename(manifestPath) !== "openclaw.plugin.json") {
    return { error: "manifest-path-escape" };
  }
  if (!pathExists(manifestPath)) return { error: "manifest-missing" };
  try {
    const manifestRead = readTextFile(manifestPath, 4 * 1024 * 1024);
    const manifest = parseJson5(manifestRead.raw);
    const packageJsonPath = path.join(root, "package.json");
    let packageManifest = null;
    let packageRead = null;
    if (pathExists(packageJsonPath)) {
      packageRead = readTextFile(packageJsonPath, 4 * 1024 * 1024);
      packageManifest = parseJson5(packageRead.raw);
    }
    const entries = [
      ...(Array.isArray(packageManifest?.openclaw?.extensions) ? packageManifest.openclaw.extensions : []),
      ...(Array.isArray(packageManifest?.openclaw?.runtimeExtensions)
        ? packageManifest.openclaw.runtimeExtensions
        : []),
    ].filter((entry) => typeof entry === "string");
    const entryEvidence = entries.map((entry) => {
      const resolved = safeRealpath(path.resolve(root, entry));
      return {
        entry,
        insideRoot: isInside(root, resolved),
        exists: isInside(root, resolved) && pathExists(resolved),
        path: resolved,
      };
    });
    const repository = typeof packageManifest?.repository === "string"
      ? packageManifest.repository
      : packageManifest?.repository?.url;
    return {
      root,
      manifestPath,
      manifestSha256: manifestRead.sha256,
      packageJsonPath: packageRead ? packageJsonPath : null,
      packageJsonSha256: packageRead?.sha256 ?? null,
      id: safeString(manifest?.id),
      name: safeString(manifest?.name),
      packageName: safeString(packageManifest?.name),
      version: safeString(packageManifest?.version ?? manifest?.version),
      repository: sanitizeUrl(repository),
      homepage: sanitizeUrl(packageManifest?.homepage),
      compatibility: safeVersionContract({
        ...(packageManifest?.openclaw?.install ?? {}),
        ...(packageManifest?.openclaw?.compat ?? {}),
        ...(packageManifest?.openclaw?.build ?? {}),
      }),
      schemaConstraints: normalizeSchemaConstraints(manifest?.configSchema),
      entries: entryEvidence,
    };
  } catch (error) {
    return { root, manifestPath, error: normalizeError(error) };
  }
}

const MAX_EXTENSION_ROOTS = 500;

function extensionRoots(parent, gapCode) {
  if (!pathExists(parent)) return { roots: [], gap: null };
  try {
    const entries = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      roots: entries.slice(0, MAX_EXTENSION_ROOTS).map((entry) => path.join(parent, entry.name)),
      gap: entries.length > MAX_EXTENSION_ROOTS
        ? { code: gapCode, observed: entries.length, limit: MAX_EXTENSION_ROOTS }
        : null,
    };
  } catch (error) {
    return { roots: [], gap: { code: `${gapCode}-unreadable`, message: normalizeError(error) } };
  }
}

function configuredPluginCandidate(configuredPath) {
  const resolved = safeRealpath(configuredPath);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return { rootDir: resolved, registry: { origin: "config-load-path" } };
    if (stat.isFile()) {
      return {
        rootDir: path.dirname(resolved),
        registry: { origin: "config-load-file" },
        configuredEntryFile: resolved,
      };
    }
  } catch {
    // The caller records a bounded coverage gap below.
  }
  return null;
}

function hasUsableBundledPluginTree(parent) {
  if (!pathExists(parent)) return false;
  try {
    return fs.readdirSync(parent, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) return false;
      const candidate = path.join(parent, entry.name);
      return pathExists(path.join(candidate, "package.json")) || pathExists(path.join(candidate, "openclaw.plugin.json"));
    });
  } catch {
    return false;
  }
}

function trustedBundledOverride(packageRoot, overrideRoot, sourceCheckout) {
  if (!overrideRoot || !pathExists(overrideRoot) || !hasUsableBundledPluginTree(overrideRoot)) return null;
  const packageReal = safeRealpath(packageRoot);
  const overrideReal = safeRealpath(overrideRoot);
  const trustedRoots = [
    path.join(packageRoot, "dist", "extensions"),
    path.join(packageRoot, "dist-runtime", "extensions"),
    ...(sourceCheckout ? [path.join(packageRoot, "extensions")] : []),
  ];
  return trustedRoots.some((root) => {
    if (!pathExists(root)) return false;
    const trustedReal = safeRealpath(root);
    return isInside(packageReal, trustedReal) && isInside(trustedReal, overrideReal);
  }) ? overrideReal : null;
}

function selectedBundledPluginsRoot(packageRoot, options = {}) {
  if (!packageRoot || options.bundledPluginsDisabled) return { root: null, gap: null };
  const built = path.join(packageRoot, "dist", "extensions");
  const runtime = path.join(packageRoot, "dist-runtime", "extensions");
  const source = path.join(packageRoot, "extensions");
  const sourceCheckout = pathExists(path.join(packageRoot, "pnpm-workspace.yaml")) &&
    pathExists(path.join(packageRoot, "src")) && pathExists(source);
  if (options.bundledPluginsRootOverride) {
    const trustedOverride = trustedBundledOverride(
      packageRoot,
      options.bundledPluginsRootOverride,
      sourceCheckout,
    );
    if (trustedOverride) return { root: trustedOverride, gap: null };
  }
  const gap = options.bundledPluginsRootOverrideConfigured
    ? { code: "bundled-plugin-root-override-not-statically-trusted" }
    : null;
  if (sourceCheckout) {
    return { root: [built, runtime, source].find(hasUsableBundledPluginTree) ?? null, gap };
  }
  if (!pathExists(built)) return { root: null, gap };
  return { root: [runtime, built].find(pathExists) ?? null, gap };
}

function bundledRootForId(selectedRoot, pluginId) {
  if (!selectedRoot || !/^[A-Za-z0-9._-]+$/u.test(pluginId)) return null;
  const candidate = path.join(selectedRoot, pluginId);
  return pathExists(path.join(candidate, "openclaw.plugin.json")) ? candidate : null;
}

function originPriority(origin) {
  if (origin === "config" || origin === "config-load-file" || origin === "config-load-path") return 0;
  if (origin === "workspace" || origin === "workspace-extension") return 1;
  if (origin === "bundled" || origin === "bundled-config-reference") return 2;
  if (origin === "global" || origin === "state-extension") return 3;
  return 4;
}

export async function inspectPlugins(options) {
  const databasePath = path.join(options.stateDir, "state", "openclaw.sqlite");
  const registry = await readInstalledIndex(databasePath);
  const candidates = [];
  const gaps = [];
  const installRecords = registry.ok
    ? registry.value?.index?.installRecords ?? registry.value?.installRecords ?? {}
    : {};
  const registryPlugins = registry.ok
    ? registry.value?.index?.plugins ?? registry.value?.plugins ?? []
    : [];
  if (!registry.ok) gaps.push(registry.gap);
  const bundledSelection = selectedBundledPluginsRoot(options.packageRoot, options);
  if (bundledSelection.gap) gaps.push(bundledSelection.gap);

  for (const record of Array.isArray(registryPlugins) ? registryPlugins : []) {
    if (!record || typeof record !== "object" || typeof record.rootDir !== "string") continue;
    candidates.push({
      rootDir: record.rootDir,
      manifestPath: typeof record.manifestPath === "string" ? record.manifestPath : null,
      registry: {
        pluginId: safeString(record.pluginId),
        enabled: typeof record.enabled === "boolean" ? record.enabled : null,
        origin: safeString(record.origin),
        source: safeString(record.source),
        setupSource: safeString(record.setupSource),
        packageName: safeString(record.packageName),
        packageVersion: safeString(record.packageVersion),
        manifestHash: safeString(record.manifestHash),
        installRecordHash: safeString(record.installRecordHash),
      },
    });
  }
  for (const configuredPath of (options.configuredPluginPaths ?? []).slice(0, MAX_EXTENSION_ROOTS)) {
    const candidate = configuredPluginCandidate(configuredPath);
    if (candidate) candidates.push(candidate);
    else gaps.push({ code: "configured-plugin-path-unreadable" });
  }
  if ((options.configuredPluginPaths ?? []).length > MAX_EXTENSION_ROOTS) {
    gaps.push({
      code: "configured-plugin-path-budget-exceeded",
      observed: options.configuredPluginPaths.length,
      limit: MAX_EXTENSION_ROOTS,
    });
  }
  for (const workspaceRoot of (options.workspaceRoots ?? []).slice(0, MAX_EXTENSION_ROOTS)) {
    const workspaceExtensions = extensionRoots(
      path.join(workspaceRoot, ".openclaw", "extensions"),
      "workspace-extension-root-budget-exceeded",
    );
    for (const rootDir of workspaceExtensions.roots) {
      candidates.push({ rootDir, registry: { origin: "workspace-extension" } });
    }
    if (workspaceExtensions.gap) gaps.push(workspaceExtensions.gap);
  }
  if ((options.workspaceRoots ?? []).length > MAX_EXTENSION_ROOTS) {
    gaps.push({
      code: "workspace-root-budget-exceeded",
      observed: options.workspaceRoots.length,
      limit: MAX_EXTENSION_ROOTS,
    });
  }
  const stateRoots = extensionRoots(path.join(options.stateDir, "extensions"), "state-extension-root-budget-exceeded");
  for (const rootDir of stateRoots.roots) {
    candidates.push({ rootDir, registry: { origin: "state-extension" } });
  }
  if (stateRoots.gap) gaps.push(stateRoots.gap);
  for (const pluginId of options.configuredPluginIds ?? []) {
    const rootDir = bundledRootForId(bundledSelection.root, pluginId);
    if (rootDir) candidates.push({ rootDir, registry: { pluginId, origin: "bundled-config-reference" } });
  }

  const originsByRoot = new Map();
  for (const candidate of candidates) {
    const root = safeRealpath(candidate.rootDir);
    const origin = candidate.registry?.origin ?? "installed-registry";
    const origins = originsByRoot.get(root) ?? new Set();
    origins.add(origin);
    originsByRoot.set(root, origins);
  }
  const seen = new Set();
  const plugins = [];
  for (const candidate of candidates) {
    const root = safeRealpath(candidate.rootDir);
    if (seen.has(root)) continue;
    seen.add(root);
    const inspected = manifestAt(root, candidate.manifestPath);
    const pluginId = inspected.id || candidate.registry?.pluginId || path.basename(root);
    const installRecord = installRecords?.[pluginId];
    const discoveryOrigins = [...(originsByRoot.get(root) ?? [])].sort((left, right) =>
      originPriority(left) - originPriority(right) || left.localeCompare(right),
    );
    const plugin = {
      id: pluginId,
      configured: (options.configuredPluginIds ?? []).includes(pluginId) ||
        discoveryOrigins.some((origin) => origin === "config-load-path" || origin === "config-load-file"),
      configuredEntryFile: candidate.configuredEntryFile ?? null,
      discoveryOrigins,
      primaryDiscoveryOrigin: discoveryOrigins[0] ?? null,
      registry: candidate.registry,
      installRecord: safeInstallRecord(installRecord),
      ...inspected,
    };
    const origin = candidate.registry?.origin ?? null;
    const bundled = discoveryOrigins.some((entry) => entry === "bundled" || entry === "bundled-config-reference");
    plugin.bundled = bundled;
    plugin.auditEligible = plugin.configured || (!bundled && !inspected.error);
    // Every installed third-party plugin is a direct component for the mandatory
    // static consistency check, even when it is currently disabled or unreferenced.
    plugin.dependencyAuditEligible = !bundled && !inspected.error;
    if (inspected.manifestSha256 && candidate.registry?.manifestHash) {
      plugin.manifestHashStatus = inspected.manifestSha256 === candidate.registry.manifestHash ? "match" : "mismatch";
    } else {
      plugin.manifestHashStatus = "unknown";
    }
    plugins.push(plugin);
    if (inspected.error && !bundled) gaps.push({ code: `plugin-${inspected.error}`, pluginId });
  }

  const discoveredIds = new Set(plugins.map((plugin) => plugin.id));
  for (const configuredId of options.configuredPluginIds ?? []) {
    if (!discoveredIds.has(configuredId)) gaps.push({ code: "configured-plugin-not-discovered", pluginId: configuredId });
  }

  const inventory = plugins.map((plugin) => ({
    id: plugin.id,
    packageName: plugin.packageName ?? plugin.registry?.packageName ?? null,
    version: plugin.version ?? plugin.registry?.packageVersion ?? null,
    origin: plugin.registry?.origin ?? null,
    discoveryOrigins: plugin.discoveryOrigins,
    primaryDiscoveryOrigin: plugin.primaryDiscoveryOrigin,
    enabled: plugin.registry?.enabled ?? null,
    configured: plugin.configured,
    bundled: plugin.bundled,
    auditEligible: plugin.auditEligible,
    dependencyAuditEligible: plugin.dependencyAuditEligible,
    manifestHashStatus: plugin.manifestHashStatus,
    validManifest: !plugin.error,
  }));
  const detailed = plugins.filter((plugin) =>
    plugin.auditEligible || plugin.manifestHashStatus === "mismatch" || plugin.error,
  );

  return {
    databasePath,
    registry: registry.ok
      ? {
          present: true,
          updatedAtMs: registry.updatedAtMs,
          revision: registry.value?.revision ?? null,
          indexVersion: registry.value?.index?.version ?? null,
          hostContractVersion: registry.value?.index?.hostContractVersion ?? null,
          compatibilityRegistryVersion: registry.value?.index?.compatRegistryVersion ?? null,
        }
      : { present: false },
    inventory: inventory.sort((left, right) => `${left.id}:${left.origin}`.localeCompare(`${right.id}:${right.origin}`)),
    plugins: detailed.sort((left, right) => String(left.id).localeCompare(String(right.id))),
    gaps,
  };
}
