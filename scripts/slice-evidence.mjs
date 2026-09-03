#!/usr/bin/env node
import process from "node:process";
import { parseArgs, readStdinUtf8, readTextFile, stableStringify } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2), {
  input: { type: "string" },
  role: { type: "string" },
  bundle: { type: "boolean", default: false },
  "pointer-prefix": { type: "string", multiple: true },
  "component-id": { type: "string", multiple: true },
});
const roles = new Set([
  "inventory-summary",
  "installation-config",
  "component-dependency",
  "source-migration",
]);
if (!args.bundle && !roles.has(args.role)) {
  throw new Error(`--role must be one of: ${[...roles].join(", ")}`);
}
if (args.bundle && args.role) throw new Error("Use either --bundle or --role, not both");
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const input = args.input
  ? readTextFile(args.input, MAX_INPUT_BYTES)
  : { raw: await readStdinUtf8(MAX_INPUT_BYTES), stable: true };
if (!input.stable) throw new Error("Evidence input changed while it was read");
const evidence = JSON.parse(input.raw);
if (evidence?.kind !== "openclaw-drift-evidence" || evidence?.evidenceSchemaVersion !== "0.1.0") {
  throw new Error("Unsupported or invalid evidence document");
}

const gapClasses = {
  "installation-config": new Set(["installation", "configuration", "includes", "consistency"]),
  "component-dependency": new Set(["plugin-provenance", "direct-dependencies"]),
  "source-migration": new Set(["installation", "source-artifact-state", "migration-chains", "consistency"]),
};

function selectComponents() {
  const selectedIds = new Set(args["component-id"]);
  return selectedIds.size === 0
    ? evidence.components ?? []
    : (evidence.components ?? []).filter((component) => selectedIds.has(component.id));
}

function pointerEntries(entries) {
  if (args["pointer-prefix"].length === 0) return entries ?? [];
  return (entries ?? []).filter((entry) => args["pointer-prefix"].some((prefix) =>
    entry.pointer === prefix || entry.pointer.startsWith(`${prefix}/`)
  ));
}

function topLevelConfigSummary(entries) {
  const result = new Map();
  for (const entry of entries ?? []) {
    const topLevel = entry.pointer === "" ? "/" : `/${entry.pointer.split("/")[1]}`;
    const record = result.get(topLevel) ?? { pointer: topLevel, entries: 0, clear: 0, redacted: 0 };
    record.entries += 1;
    if (entry.disclosure === "clear") record.clear += 1;
    if (entry.disclosure?.startsWith("redacted")) record.redacted += 1;
    result.set(topLevel, record);
  }
  return [...result.values()].sort((left, right) => left.pointer.localeCompare(right.pointer));
}

function createSlice(role) {
  const common = {
    evidenceSchemaVersion: evidence.evidenceSchemaVersion,
    kind: "openclaw-drift-evidence-slice",
    role,
    run: evidence.run,
    capabilities: evidence.capabilities ?? [],
    coverageClasses: evidence.coverage?.classes ?? [],
  };
  const filteredGaps = gapClasses[role]
    ? (evidence.coverage?.gaps ?? []).filter((gap) => gapClasses[role].has(gap.class))
    : [];
  let slice;
  if (role === "inventory-summary") {
  const dependencyChecks = (evidence.dependencies ?? []).flatMap((component) => component.checks ?? []);
  slice = {
    ...common,
    target: {
      status: evidence.target?.status,
      platform: evidence.target?.platform,
      configPath: evidence.target?.configPath,
      selectedPackageRoot: evidence.target?.selectedPackageRoot,
      packages: (evidence.target?.packages ?? []).map((entry) => ({
        rootDir: entry.rootDir,
        version: entry.version,
        installKind: entry.installKind,
        releaseChannel: entry.releaseChannel,
        buildInfo: entry.buildInfo,
      })),
    },
    counts: {
      authoredConfigEntries: evidence.configuration?.authoredEntries?.length ?? 0,
      resolvedConfigEntries: evidence.configuration?.resolvedSameAsAuthored
        ? evidence.configuration?.authoredEntries?.length ?? 0
        : evidence.configuration?.resolvedEntries?.length ?? 0,
      pluginInventory: evidence.plugins?.inventory?.length ?? evidence.plugins?.plugins?.length ?? 0,
      auditedComponents: evidence.components?.length ?? 0,
      dependencyComponents: evidence.dependencies?.length ?? 0,
      dependencyChecks: dependencyChecks.length,
      dependencyMismatches: dependencyChecks.filter((entry) =>
        entry.status === "mismatch" || entry.lock?.declaredStatus === "mismatch" || entry.lock?.installedStatus === "mismatch"
      ).length,
      coverageGaps: evidence.coverage?.gaps?.length ?? 0,
      unstableConsistencyMarkers: (evidence.consistency ?? []).filter((entry) => entry.stable === false).length,
    },
    configurationIndex: topLevelConfigSummary(evidence.configuration?.authoredEntries),
    componentIndex: (evidence.components ?? []).map((component) => ({
      id: component.id,
      kind: component.kind,
      pluginId: component.pluginId,
      packageName: component.packageName,
      version: component.version,
      versionPrereleaseClass: component.versionPrereleaseClass,
      releaseChannel: component.releaseChannel,
      bundled: component.bundled,
      dependencyAuditEligible: component.dependencyAuditEligible,
    })),
    gapSummary: Object.entries(
      (evidence.coverage?.gaps ?? []).reduce((result, gap) => {
        const key = `${gap.class}:${gap.reason}`;
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {}),
    ).map(([key, count]) => ({ key, count })),
    redaction: evidence.redaction,
  };
  } else if (role === "installation-config") {
  slice = {
    ...common,
    target: evidence.target,
    configuration: {
      ...evidence.configuration,
      authoredEntries: pointerEntries(evidence.configuration?.authoredEntries),
      resolvedEntries: pointerEntries(evidence.configuration?.resolvedEntries),
      slicePointerPrefixes: args["pointer-prefix"],
    },
    source: evidence.source,
    consistency: evidence.consistency,
    coverageGaps: filteredGaps,
  };
  } else if (role === "component-dependency") {
  const selectedIds = new Set(args["component-id"]);
  const selectedComponents = selectComponents();
  const selectedPluginIds = new Set(selectedComponents.map((component) => component.pluginId).filter(Boolean));
  const selectedPlugins = selectedIds.size === 0
    ? evidence.plugins
    : {
        ...evidence.plugins,
        inventory: (evidence.plugins?.inventory ?? []).filter((plugin) => selectedPluginIds.has(plugin.id)),
        plugins: (evidence.plugins?.plugins ?? []).filter((plugin) => selectedPluginIds.has(plugin.id)),
      };
  slice = {
    ...common,
    target: {
      status: evidence.target?.status,
      platform: evidence.target?.platform,
      selectedPackageRoot: evidence.target?.selectedPackageRoot,
      packages: evidence.target?.packages,
    },
    components: selectedComponents,
    plugins: selectedPlugins,
    dependencies: selectedIds.size === 0
      ? evidence.dependencies
      : (evidence.dependencies ?? []).filter((component) => selectedIds.has(component.componentId)),
    sliceComponentIds: args["component-id"],
    coverageGaps: filteredGaps,
  };
  } else {
  const selectedIds = new Set(args["component-id"]);
  const selectedComponents = selectComponents();
  const includesOpenClaw = selectedIds.size === 0 || selectedComponents.some((component) => component.kind === "openclaw");
  const selectedGaps = selectedIds.size === 0
    ? filteredGaps
    : filteredGaps.filter((gap) => {
        if (gap.componentId) return selectedIds.has(gap.componentId);
        if (gap.class === "source-artifact-state" || gap.class === "migration-chains") return includesOpenClaw;
        return true;
      });
  slice = {
    ...common,
    target: evidence.target,
    components: selectedComponents,
    source: includesOpenClaw ? evidence.source : null,
    migrationSourceInventory: includesOpenClaw ? evidence.migrationSourceInventory : [],
    consistency: evidence.consistency,
    sliceComponentIds: args["component-id"],
    coverageGaps: selectedGaps,
  };
  }
  return slice;
}

const output = args.bundle
  ? {
      evidenceSchemaVersion: evidence.evidenceSchemaVersion,
      kind: "openclaw-drift-evidence-slice-bundle",
      run: evidence.run,
      slices: [...roles].map((role) => createSlice(role)),
    }
  : createSlice(args.role);
process.stdout.write(`${stableStringify(output)}\n`);
