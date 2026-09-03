#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  AUDIT_SCHEMA_VERSION,
  assertPortableAuditData,
  assertValidAudit,
} from "./lib/audit-contract.mjs";
import { exportDirectoryFingerprint } from "./lib/target-graph.mjs";
import {
  canonicalWritePath,
  parseArgs,
  readStdinUtf8,
  readTextFile,
  safeRealpath,
  sha256,
  stableStringify,
  writeJsonAtomic,
} from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2), {
  evidence: { type: "string" },
  analysis: { type: "string" },
  output: { type: "string" },
  retention: { type: "string" },
  "forbid-root": { type: "string", multiple: true },
});

const MAX_INPUT_BYTES = 256 * 1024 * 1024;

function readJson(filePath) {
  const read = readTextFile(filePath, MAX_INPUT_BYTES);
  if (!read.stable) throw new Error(`Input changed while it was read: ${filePath}`);
  return JSON.parse(read.raw);
}

let evidence;
let analysis;
if (args.evidence && args.analysis && args.analysis !== "-") {
  evidence = readJson(args.evidence);
  analysis = readJson(args.analysis);
} else if (args.evidence && args.analysis === "-") {
  evidence = readJson(args.evidence);
  analysis = JSON.parse(await readStdinUtf8(MAX_INPUT_BYTES));
} else if (!args.evidence && !args.analysis) {
  const composite = JSON.parse(await readStdinUtf8(MAX_INPUT_BYTES));
  evidence = composite.evidence;
  analysis = composite.analysis;
} else {
  throw new Error("Use --evidence with --analysis <file|->, or provide {evidence,analysis} on stdin");
}

if (evidence?.kind !== "openclaw-drift-evidence" || evidence?.evidenceSchemaVersion !== "0.1.0") {
  throw new Error("Unsupported or invalid evidence document");
}
if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
  throw new Error("Analysis must be an object");
}
if (args.output && !args.retention) {
  throw new Error("Persistent export requires an explicit --retention value");
}
if (args.output && (!args.evidence || !args.analysis)) {
  throw new Error("Persistent export requires --evidence and an explicit --analysis <file|-> input");
}
if (!args.output && args.retention) {
  throw new Error("--retention is only valid with --output");
}

function assertAllowedKeys(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown field ${label}.${key}`);
  }
}

function assertRequiredKeys(value, requiredKeys, label) {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key}: required field is missing`);
  }
}

function assertRecordList(records, allowedKeys, label, nested) {
  if (records === undefined) return;
  if (!Array.isArray(records)) throw new Error(`${label} must be an array`);
  records.forEach((record, index) => {
    const recordLabel = `${label}[${index}]`;
    assertAllowedKeys(record, allowedKeys, recordLabel);
    nested?.(record, recordLabel);
  });
}

const TOP_LEVEL_ANALYSIS_KEYS = [
  "operatingContext",
  "budgets",
  "capabilities",
  "disclosures",
  "sources",
  "baselines",
  "rules",
  "observations",
  "findings",
  "migrationChains",
  "coverageGaps",
  "unresolvedBaselines",
  "networkFreshness",
  "repairHandoffs",
  "diagnostics",
];
assertAllowedKeys(analysis, TOP_LEVEL_ANALYSIS_KEYS, "analysis");

assertAllowedKeys(analysis.operatingContext, ["id", "status", "facts", "unknowns"], "analysis.operatingContext");
assertRecordList(analysis.operatingContext.facts, ["id", "status", "value", "evidenceSourceIds"], "analysis.operatingContext.facts");
assertAllowedKeys(analysis.budgets, ["timeMs", "ioBytes", "semanticItems"], "analysis.budgets");
for (const budgetName of ["timeMs", "ioBytes", "semanticItems"]) {
  assertAllowedKeys(analysis.budgets[budgetName], ["limit", "used", "status", "coverageGapId"], `analysis.budgets.${budgetName}`);
}
assertRecordList(analysis.capabilities, ["id", "status", "implementationVersion"], "analysis.capabilities");
assertRecordList(analysis.disclosures, ["dataClass", "status", "authorizationId"], "analysis.disclosures");
assertRecordList(analysis.sources, [
  "id", "componentId", "owner", "version", "releaseChannel", "applicableClaim", "location", "retrievedAt", "authorityTier", "revision", "sha256",
], "analysis.sources");
assertRecordList(analysis.baselines, [
  "id", "componentId", "componentVersion", "releaseChannel", "timePerspective", "operatingContextId", "kind", "status", "sourceIds", "conditions", "summary",
], "analysis.baselines");
assertRecordList(analysis.rules, ["id", "namespace", "name", "version", "summary"], "analysis.rules");
assertRecordList(analysis.observations, [
  "id", "ruleId", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "surface", "timePerspective", "outcome", "baselineId", "observed", "baseline", "evidenceSourceIds", "observedFingerprint",
], "analysis.observations", (record, label) => {
  assertRequiredKeys(record, ["ruleId", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "surface", "timePerspective", "outcome", "baselineId", "observed", "baseline", "evidenceSourceIds"], label);
  assertAllowedKeys(record.observed, ["status", "disclosure", "value", "fingerprint", "summary"], `${label}.observed`);
  assertAllowedKeys(record.baseline, ["status", "disclosure", "value", "fingerprint", "summary"], `${label}.baseline`);
});
assertRecordList(analysis.findings, [
  "key", "ruleId", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "surface", "timePerspective", "driftClass", "lifecycleState", "observationIds", "impactSeverity", "evidenceConfidence", "causalStatus", "intentStatus", "downstreamExposure", "repairSideEffects", "title", "summary",
], "analysis.findings", (record, label) => {
  assertRequiredKeys(record, ["ruleId", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "surface", "timePerspective", "driftClass", "lifecycleState", "observationIds", "impactSeverity", "evidenceConfidence", "causalStatus", "intentStatus", "downstreamExposure", "repairSideEffects", "title", "summary"], label);
  assertAllowedKeys(record.downstreamExposure, ["status", "summary", "affectedScopes"], `${label}.downstreamExposure`);
  assertAllowedKeys(record.repairSideEffects, ["status", "summary", "classes"], `${label}.repairSideEffects`);
});
assertRecordList(analysis.migrationChains, [
  "id", "componentId", "componentVersion", "releaseChannel", "originVersion", "status", "summary", "events",
], "analysis.migrationChains", (record, label) => {
  assertRecordList(record.events, ["version", "kind", "summary", "sourceIds"], `${label}.events`);
});
assertRecordList(analysis.coverageGaps, ["id", "class", "reason", "componentId", "dataClass", "summary", "relatedIds"], "analysis.coverageGaps");
assertRecordList(analysis.unresolvedBaselines, ["componentId", "reason"], "analysis.unresolvedBaselines");
assertAllowedKeys(analysis.networkFreshness, ["used", "authorized", "sourceClasses", "ownerDomains", "retrievedAt"], "analysis.networkFreshness");
assertRecordList(analysis.repairHandoffs, [
  "id", "findingKey", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "targetSurface", "proposedChange", "expectedDiff", "sideEffects", "prerequisites", "conflicts", "rollbackBoundary", "validation", "repairProof", "uncertainties", "saferAlternatives", "executable",
], "analysis.repairHandoffs");
assertRecordList(analysis.diagnostics, ["code", "severity", "message"], "analysis.diagnostics");

const OUTCOMES = new Set(["match", "drift", "conflict", "unknown", "not-applicable", "not-run"]);
const DRIFT_CLASSES = new Set([
  "recommendation-drift", "default-delta", "constraint-violation", "lifecycle-drift", "source-drift", "artifact-drift", "resolution-drift", "inheritance-drift", "runtime-service-incoherence", "baseline-conflict", "unknown-baseline", "coverage-gap",
]);
const FINDING_OUTCOMES_BY_DRIFT_CLASS = new Map([
  ["recommendation-drift", new Set(["drift"])],
  ["default-delta", new Set(["drift"])],
  ["constraint-violation", new Set(["drift"])],
  ["lifecycle-drift", new Set(["drift"])],
  ["source-drift", new Set(["drift"])],
  ["artifact-drift", new Set(["drift"])],
  ["resolution-drift", new Set(["drift"])],
  ["inheritance-drift", new Set(["drift"])],
  ["runtime-service-incoherence", new Set(["drift"])],
  ["baseline-conflict", new Set(["conflict"])],
  ["unknown-baseline", new Set(["unknown"])],
  ["coverage-gap", new Set(["unknown", "not-run"])],
]);
const SEVERITIES = new Set(["info", "low", "medium", "high", "critical", "unknown"]);
const CONFIDENCE = new Set(["low", "medium", "high", "unknown"]);
const CAUSAL = new Set(["confirmed-cause", "probable-contributor", "plausible-cascade", "coexisting-drift", "unassessed"]);

function normalizedId(prefix, value) {
  return `${prefix}:${sha256(stableStringify(value, 0)).slice(0, 24)}`;
}

function assertUnique(records, field, label) {
  const seen = new Set();
  for (const record of records) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) throw new Error(`${label} needs ${field}`);
    if (seen.has(value)) throw new Error(`Duplicate ${label} ${value}`);
    seen.add(value);
  }
}

function optional(target, key, value) {
  if (value !== undefined) target[key] = value;
  return target;
}

function pick(record, keys) {
  const result = {};
  if (!record || typeof record !== "object" || Array.isArray(record)) return result;
  for (const key of keys) if (Object.hasOwn(record, key) && record[key] !== undefined) result[key] = record[key];
  return result;
}

function scalarEntries(record) {
  const result = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return result;
  for (const [key, value] of Object.entries(record)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) result.push({ name: key, value });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function fingerprint(record) {
  return pick(record, ["exists", "type", "size", "mtimeNs", "ino", "mode", "sha256", "oversized", "stable", "error"]);
}

function evidenceGap(record) {
  return pick(record, [
    "code", "message", "reason", "componentId", "dataClass", "dependency", "kind", "lockfile", "packageManagerHint",
    "declared", "limit", "observed", "documentIndex", "pluginId", "requiredAction", "identity", "sourceClass", "path",
  ]);
}

function normalizeTarget(raw) {
  const target = pick(raw, [
    "discoveryVersion", "stateDir", "configPath", "configExists", "selectedPackageRoot", "status", "candidateFingerprint", "graphResolution",
  ]);
  if (raw?.platform) target.platform = pick(raw.platform, ["os", "arch", "node"]);
  target.launchers = (raw?.launchers ?? []).map((launcher) => ({
    ...pick(launcher, ["path", "realPath", "kind"]),
    packageRoots: Array.isArray(launcher?.packageRoots) ? launcher.packageRoots.slice() : [],
  }));
  target.packages = (raw?.packages ?? []).map((entry) => {
    const normalized = pick(entry, [
      "rootDir", "packageJsonPath", "packageJsonSha256", "name", "version", "repository", "homepage", "versionPrereleaseClass", "releaseChannel", "releaseChannelSource", "installKind", "error",
    ]);
    normalized.lifecycleGuards = Array.isArray(entry?.lifecycleGuards) ? entry.lifecycleGuards.slice() : [];
    if (entry?.schemaVersions && typeof entry.schemaVersions === "object") normalized.schemaVersions = scalarEntries(entry.schemaVersions);
    if (entry?.buildInfo && typeof entry.buildInfo === "object") {
      normalized.buildInfo = pick(entry.buildInfo, ["path", "sha256", "version", "commit", "builtAt", "error"]);
    } else if (entry?.buildInfo === null) {
      normalized.buildInfo = null;
    }
    return normalized;
  });
  if (raw?.selection) {
    target.selection = {
      ...pick(raw.selection, ["packageRootSource", "stateDirSource", "configPathSource", "runtimeCwdSource", "assurance"]),
      unresolvedRuntimeIdentities: Array.isArray(raw.selection.unresolvedRuntimeIdentities)
        ? raw.selection.unresolvedRuntimeIdentities.slice()
        : [],
    };
  }
  if (raw?.writeGuard) {
    target.writeGuard = {
      ...pick(raw.writeGuard, ["algorithm", "salt", "complete", "unresolvedCount"]),
      roots: (raw.writeGuard.roots ?? []).map((entry) => ({
        ...pick(entry, ["alias", "kind", "fingerprint"]),
        roles: Array.isArray(entry?.roles) ? entry.roles.slice() : [],
      })),
    };
  }
  return target;
}

function normalizeConfigEntry(entry) {
  return pick(entry, [
    "pointer", "type", "sources", "keys", "items", "present", "disclosure", "value", "lengthBucket", "opaqueFingerprint",
  ]);
}

function normalizeConfiguration(raw) {
  return {
    status: raw?.status,
    root: raw?.root,
    authoredEntryCount: (raw?.authoredEntries ?? []).length,
    resolvedEntryCount: raw?.resolvedSameAsAuthored ? (raw?.authoredEntries ?? []).length : (raw?.resolvedEntries ?? []).length,
    authoredEntries: (raw?.authoredEntries ?? []).map(normalizeConfigEntry),
    resolvedEntries: (raw?.resolvedEntries ?? []).map(normalizeConfigEntry),
    resolvedSameAsAuthored: raw?.resolvedSameAsAuthored ?? false,
    includeFiles: (raw?.includeFiles ?? []).map((entry) => ({
      ...pick(entry, ["path", "bytes", "sha256", "stable"]),
      before: fingerprint(entry?.before),
      after: fingerprint(entry?.after),
    })),
    includeEdges: (raw?.includeEdges ?? []).map((entry) => ({
      ...pick(entry, ["from", "pointer", "kind", "hasSiblingOverrides"]),
      targets: Array.isArray(entry?.targets) ? entry.targets.slice() : [],
    })),
    diagnostics: (raw?.diagnostics ?? []).map((entry) => pick(entry, ["code", "severity", "message"])),
  };
}

function normalizeComparison(raw) {
  return {
    ...pick(raw, ["status"]),
    missing: (raw?.missing ?? []).map((entry) => pick(entry, ["kind", "name"])),
    extra: (raw?.extra ?? []).map((entry) => pick(entry, ["kind", "name"])),
    specifierMismatches: (raw?.specifierMismatches ?? []).map((entry) => pick(entry, ["kind", "name", "declared", "locked"])),
  };
}

function normalizeDependencies(records) {
  return (records ?? []).map((record) => ({
    componentId: record?.componentId,
    packageJson: pick(record?.packageJson, ["path", "sha256", "name", "version", "packageManager"]),
    checks: (record?.checks ?? []).map((entry) => ({
      ...pick(entry, ["kind", "optional", "selecting", "name", "requested", "status", "reason"]),
      installed: entry?.installed === null ? null : pick(entry?.installed, [
        "name", "version", "packageJsonPath", "packageJsonSha256", "resolvedRoot", "nameStatus",
      ]),
      lock: pick(entry?.lock, ["status", "specifier", "version", "hasIntegrity", "declaredStatus", "declaredReason", "installedStatus"]),
    })),
    lockfiles: (record?.lockfiles ?? []).map((entry) => ({
      ...pick(entry, ["path", "kind", "manager", "bytes", "sha256", "status", "error", "reason", "adapter", "formatVersion"]),
      candidates: (entry?.candidates ?? []).map((candidate) => ({
        ...pick(candidate, ["id", "importer", "documentIndex"]),
        manifestComparison: normalizeComparison(candidate?.manifestComparison),
      })),
      documents: (entry?.documents ?? []).map((document) => pick(document, ["documentIndex", "status", "reason", "formatVersion"])),
    })),
    lockSelection: pick(record?.lockSelection, [
      "status", "manager", "lockfile", "path", "adapter", "formatVersion", "importer", "documentIndex", "selectedBy", "packageManagerHint",
    ]),
    gaps: (record?.gaps ?? []).map(evidenceGap),
  }));
}

const VERSION_CONTRACT_KEYS = ["minHostVersion", "minGatewayVersion", "pluginApi", "tested", "version", "channel", "openclawVersion"];
function normalizeVersionContract(value) {
  if (value === null || typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
  const result = {};
  for (const key of VERSION_CONTRACT_KEYS) if (Object.hasOwn(value ?? {}, key)) result[key] = normalizeVersionContract(value[key]);
  return result;
}

function normalizeConstraintValue(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return pick(value, ["disclosure", "opaqueFingerprint"]);
}

function normalizePlugins(raw) {
  return {
    databasePath: raw?.databasePath ?? null,
    registry: {
      present: Boolean(raw?.registry?.present),
      ...pick(raw?.registry, ["updatedAtMs", "revision", "indexVersion", "hostContractVersion", "compatibilityRegistryVersion"]),
    },
    inventory: (raw?.inventory ?? []).map((entry) => pick(entry, [
      "id", "packageName", "version", "origin", "enabled", "configured", "bundled", "auditEligible", "dependencyAuditEligible", "manifestHashStatus", "validManifest",
    ])),
    plugins: (raw?.plugins ?? []).map((entry) => ({
      ...pick(entry, [
        "id", "configured", "configuredEntryFile", "root", "manifestPath", "manifestSha256", "packageJsonPath", "packageJsonSha256", "name", "packageName", "version", "repository", "homepage", "error", "bundled", "auditEligible", "dependencyAuditEligible", "manifestHashStatus",
      ]),
      registry: entry?.registry === null ? null : pick(entry?.registry, [
        "pluginId", "enabled", "origin", "source", "setupSource", "packageName", "packageVersion", "manifestHash", "installRecordHash",
      ]),
      installRecord: entry?.installRecord === null ? null : pick(entry?.installRecord, [
        "source", "spec", "version", "resolvedName", "resolvedSpec", "resolvedVersion", "artifactKind", "artifactFormat", "integrity", "npmIntegrity", "npmShasum", "shasum", "clawpackSha256", "clawhubPackage", "clawhubFamily", "clawhubChannel", "clawhubTrustDisposition", "clawhubTrustScanStatus",
      ]),
      compatibility: normalizeVersionContract(entry?.compatibility),
      schemaConstraints: (entry?.schemaConstraints ?? []).map((constraint) => ({
        ...pick(constraint, ["pointer", "type", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "deprecated"]),
        ...(Array.isArray(constraint?.required) ? { required: constraint.required.slice() } : {}),
        ...(Array.isArray(constraint?.enum) ? { enum: constraint.enum.map(normalizeConstraintValue) } : {}),
        ...(Object.hasOwn(constraint ?? {}, "default") ? { default: normalizeConstraintValue(constraint.default) } : {}),
      })),
      entries: (entry?.entries ?? []).map((candidate) => pick(candidate, ["entry", "insideRoot", "exists", "path"])),
    })),
    gaps: (raw?.gaps ?? []).map(evidenceGap),
  };
}

function normalizeSourceState(raw) {
  const result = {};
  if (raw?.git) {
    result.git = {
      ...pick(raw.git, ["present", "readable", "root", "head", "exactTag", "branch", "origin", "dirty", "statusFingerprint", "truncated", "error"]),
      changes: (raw.git.changes ?? []).map((entry) => pick(entry, ["status", "path", "originalPath"])),
      gaps: (raw.git.gaps ?? []).map(evidenceGap),
    };
  }
  if (raw?.releaseBinding) result.releaseBinding = pick(raw.releaseBinding, ["state", "baselineChannel", "tag"]);
  return result;
}

function normalizeConsistency(records) {
  return (records ?? []).map((entry) => ({
    path: entry?.path,
    stable: entry?.stable,
    before: fingerprint(entry?.before),
    after: fingerprint(entry?.after),
  }));
}

function valueRepresentation(value) {
  return {
    status: value.status,
    disclosure: value.disclosure,
    value: value.value ?? null,
    fingerprint: value.fingerprint ?? null,
    summary: value.summary ?? "",
  };
}

const selectedPackage = (evidence.target?.packages ?? []).find((entry) =>
  entry.rootDir === evidence.target?.selectedPackageRoot
);
const pluginDetails = new Map((evidence.plugins?.plugins ?? []).map((plugin) => [plugin.id, plugin]));
const components = (evidence.components ?? []).map((component) => {
  const plugin = component.pluginId ? pluginDetails.get(component.pluginId) : null;
  const packageRecord = component.kind === "openclaw" ? selectedPackage : null;
  const record = {
    id: component.id,
    kind: component.kind,
    version: component.version ?? null,
    releaseChannel: packageRecord?.releaseChannel ?? (component.version?.includes("-") ? "prerelease" : component.version ? "stable" : null),
    provenanceStatus: component.version && (component.packageJsonSha256 || plugin?.manifestSha256) ? "partial" : "unknown",
  };
  optional(record, "pluginId", component.pluginId);
  optional(record, "packageName", component.packageName ?? null);
  optional(record, "revision", packageRecord?.buildInfo?.commit ?? null);
  optional(record, "manifestSha256", plugin?.manifestSha256 ?? component.packageJsonSha256 ?? null);
  optional(record, "installationOrigin", plugin?.registry?.origin ?? packageRecord?.installKind ?? null);
  optional(record, "bundled", component.bundled);
  optional(record, "dependencyAuditEligible", component.dependencyAuditEligible);
  optional(record, "versionPrereleaseClass", component.versionPrereleaseClass);
  optional(record, "releaseChannelSource", packageRecord?.releaseChannelSource);
  if (component.sourceReleaseBinding) record.sourceReleaseBinding = pick(component.sourceReleaseBinding, ["state", "baselineChannel", "tag"]);
  return record;
});
assertUnique(components, "id", "component");
const componentIds = new Set(components.map((component) => component.id));

const sources = (analysis.sources ?? []).map((source) => ({
  id: source.id || normalizedId("source", source),
  componentId: source.componentId,
  owner: source.owner,
  version: source.version ?? null,
  releaseChannel: source.releaseChannel ?? null,
  applicableClaim: source.applicableClaim,
  location: source.location,
  retrievedAt: source.retrievedAt,
  authorityTier: source.authorityTier,
  revision: source.revision ?? null,
  sha256: source.sha256 ?? null,
}));
assertUnique(sources, "id", "source");
const sourceIds = new Set(sources.map((source) => source.id));
for (const source of sources) {
  if (!componentIds.has(source.componentId)) throw new Error(`Source references unknown component ${source.componentId}`);
}

const operatingContext = {
  id: analysis.operatingContext.id,
  status: analysis.operatingContext.status,
  facts: (analysis.operatingContext.facts ?? []).map((fact) => ({
    id: fact.id,
    status: fact.status,
    value: fact.value ?? null,
    evidenceSourceIds: fact.evidenceSourceIds ?? [],
  })),
  unknowns: analysis.operatingContext.unknowns ?? [],
};
for (const fact of operatingContext.facts) {
  for (const sourceId of fact.evidenceSourceIds) if (!sourceIds.has(sourceId)) throw new Error(`Operating context references unknown source ${sourceId}`);
}

const baselines = (analysis.baselines ?? []).map((baseline) => ({
  id: baseline.id || normalizedId("baseline", baseline),
  componentId: baseline.componentId,
  componentVersion: baseline.componentVersion ?? null,
  releaseChannel: baseline.releaseChannel ?? null,
  timePerspective: baseline.timePerspective,
  operatingContextId: baseline.operatingContextId,
  kind: baseline.kind,
  status: baseline.status,
  sourceIds: baseline.sourceIds ?? [],
  conditions: baseline.conditions ?? [],
  ...(baseline.summary === undefined ? {} : { summary: baseline.summary }),
}));
assertUnique(baselines, "id", "baseline");
const baselineIds = new Set(baselines.map((baseline) => baseline.id));
const BASELINE_CLAIMS = new Map([
  ["recommendation", "recommendation"],
  ["runtime-default", "runtime-default"],
  ["constraint", "accepted-constraints"],
  ["upgrade-contract", "upgrade-contract"],
]);
for (const baseline of baselines) {
  if (!componentIds.has(baseline.componentId)) throw new Error(`Baseline references unknown component ${baseline.componentId}`);
  if (baseline.operatingContextId !== operatingContext.id) throw new Error(`Baseline references unknown operating context ${baseline.operatingContextId}`);
  if (baseline.status !== "unknown" && baseline.sourceIds.length === 0) {
    throw new Error(`${baseline.status} baseline ${baseline.id} requires at least one source`);
  }
  const expectedClaim = BASELINE_CLAIMS.get(baseline.kind);
  for (const sourceId of baseline.sourceIds) {
    const source = sources.find((entry) => entry.id === sourceId);
    if (!source) throw new Error(`Baseline references unknown source ${sourceId}`);
    if (source.componentId !== baseline.componentId) throw new Error(`Baseline source ${sourceId} belongs to a different component`);
    if (expectedClaim && source.applicableClaim !== expectedClaim) {
      throw new Error(`Baseline ${baseline.id} requires source claim ${expectedClaim}, received ${source.applicableClaim}`);
    }
  }
}

const rules = (analysis.rules ?? []).map((rule) => {
  const identity = { namespace: rule.namespace || "openclaw-drift-audit", name: rule.name, version: rule.version || AUDIT_SCHEMA_VERSION };
  return {
    id: rule.id || normalizedId("rule", identity),
    identity,
    name: rule.name,
    ...(rule.summary === undefined ? {} : { summary: rule.summary }),
  };
});
assertUnique(rules, "id", "rule");
const ruleIds = new Set(rules.map((rule) => rule.id));

const observations = (analysis.observations ?? []).map((observation) => {
  if (!ruleIds.has(observation.ruleId)) throw new Error(`Observation references unknown rule ${observation.ruleId}`);
  if (!componentIds.has(observation.componentId)) throw new Error(`Observation references unknown component ${observation.componentId}`);
  if (!OUTCOMES.has(observation.outcome)) throw new Error(`Invalid observation outcome ${observation.outcome}`);
  if (observation.baselineId && !baselineIds.has(observation.baselineId)) throw new Error(`Observation references unknown baseline ${observation.baselineId}`);
  for (const sourceId of observation.evidenceSourceIds ?? []) if (!sourceIds.has(sourceId)) throw new Error(`Observation references unknown source ${sourceId}`);
  const identity = {
    runId: evidence.run.id,
    ruleId: observation.ruleId,
    componentId: observation.componentId,
    effectiveScope: observation.effectiveScope,
    surface: observation.surface,
    observedFingerprint: observation.observedFingerprint ?? null,
  };
  return {
    id: observation.id || normalizedId("observation", identity),
    ruleId: observation.ruleId,
    componentId: observation.componentId,
    componentVersion: observation.componentVersion ?? null,
    effectiveScope: observation.effectiveScope,
    configurationLayer: observation.configurationLayer,
    surface: observation.surface,
    timePerspective: observation.timePerspective,
    outcome: observation.outcome,
    baselineId: observation.baselineId ?? null,
    observed: valueRepresentation(observation.observed),
    baseline: valueRepresentation(observation.baseline),
    evidenceSourceIds: observation.evidenceSourceIds ?? [],
    observedFingerprint: observation.observedFingerprint ?? null,
  };
});
assertUnique(observations, "id", "observation");
const observationsById = new Map(observations.map((observation) => [observation.id, observation]));

const findings = (analysis.findings ?? []).map((finding) => {
  if (!ruleIds.has(finding.ruleId)) throw new Error(`Finding references unknown rule ${finding.ruleId}`);
  if (!componentIds.has(finding.componentId)) throw new Error(`Finding references unknown component ${finding.componentId}`);
  if (!DRIFT_CLASSES.has(finding.driftClass)) throw new Error(`Invalid drift class ${finding.driftClass}`);
  if (!SEVERITIES.has(finding.impactSeverity)) throw new Error("Invalid impact severity");
  if (!CONFIDENCE.has(finding.evidenceConfidence)) throw new Error("Invalid evidence confidence");
  if (!CAUSAL.has(finding.causalStatus)) throw new Error("Invalid causal status");
  if (!Array.isArray(finding.observationIds) || finding.observationIds.length === 0) throw new Error("Every finding needs at least one observation");
  for (const observationId of finding.observationIds) {
    const observation = observationsById.get(observationId);
    if (!observation) throw new Error(`Finding references unknown observation ${observationId}`);
    for (const key of ["ruleId", "componentId", "componentVersion", "effectiveScope", "configurationLayer", "surface", "timePerspective"]) {
      if (observation[key] !== finding[key]) throw new Error(`Finding and observation identity mismatch for ${observationId}`);
    }
    const allowedOutcomes = FINDING_OUTCOMES_BY_DRIFT_CLASS.get(finding.driftClass);
    if (!allowedOutcomes?.has(observation.outcome)) {
      throw new Error(
        `Finding drift class ${finding.driftClass} is incompatible with observation outcome ${observation.outcome} for ${observationId}`,
      );
    }
  }
  if ((finding.driftClass === "lifecycle-drift") !== (finding.lifecycleState !== "not-applicable")) {
    throw new Error("Lifecycle findings require lifecycle-drift and a concrete lifecycleState");
  }
  const semanticIdentity = {
    ruleId: finding.ruleId,
    componentId: finding.componentId,
    effectiveScope: finding.effectiveScope,
    surface: finding.surface,
    driftClass: finding.driftClass,
  };
  return {
    key: finding.key || normalizedId("finding", semanticIdentity),
    ruleId: finding.ruleId,
    componentId: finding.componentId,
    componentVersion: finding.componentVersion ?? null,
    effectiveScope: finding.effectiveScope,
    configurationLayer: finding.configurationLayer,
    surface: finding.surface,
    timePerspective: finding.timePerspective,
    driftClass: finding.driftClass,
    lifecycleState: finding.lifecycleState,
    observationIds: finding.observationIds,
    impactSeverity: finding.impactSeverity,
    evidenceConfidence: finding.evidenceConfidence,
    causalStatus: finding.causalStatus,
    intentStatus: finding.intentStatus,
    downstreamExposure: {
      status: finding.downstreamExposure.status,
      summary: finding.downstreamExposure.summary,
      affectedScopes: finding.downstreamExposure.affectedScopes ?? [],
    },
    repairSideEffects: {
      status: finding.repairSideEffects.status,
      summary: finding.repairSideEffects.summary,
      classes: finding.repairSideEffects.classes ?? [],
    },
    title: finding.title,
    summary: finding.summary,
  };
});
assertUnique(findings, "key", "finding");
const findingKeys = new Set(findings.map((finding) => finding.key));

const migrationChains = (analysis.migrationChains ?? []).map((chain) => ({
  id: chain.id || normalizedId("migration", chain),
  componentId: chain.componentId,
  componentVersion: chain.componentVersion ?? null,
  releaseChannel: chain.releaseChannel ?? null,
  originVersion: chain.originVersion ?? null,
  status: chain.status,
  summary: chain.summary ?? "",
  events: (chain.events ?? []).map((event) => ({
    version: event.version ?? null,
    kind: event.kind,
    summary: event.summary ?? "",
    sourceIds: event.sourceIds ?? [],
  })),
}));
for (const chain of migrationChains) {
  if (!componentIds.has(chain.componentId)) throw new Error(`Migration chain references unknown component ${chain.componentId}`);
  for (const event of chain.events) for (const sourceId of event.sourceIds) if (!sourceIds.has(sourceId)) throw new Error(`Migration event references unknown source ${sourceId}`);
}

const coverageGaps = [
  ...(evidence.coverage?.gaps ?? []).map((gap) => ({
    id: gap.id,
    class: gap.class,
    reason: gap.reason,
    ...pick(gap, ["componentId", "dataClass", "summary", "relatedIds", "requiredAction", "identity", "sourceClass", "path", "paths", "error", "code", "observed", "limit"]),
  })),
  ...(analysis.coverageGaps ?? []).map((gap) => ({
    id: gap.id,
    class: gap.class,
    reason: gap.reason,
    ...(gap.componentId === undefined ? {} : { componentId: gap.componentId }),
    ...(gap.dataClass === undefined ? {} : { dataClass: gap.dataClass }),
    ...(gap.summary === undefined ? {} : { summary: gap.summary }),
    ...(gap.relatedIds === undefined ? {} : { relatedIds: gap.relatedIds }),
  })),
];
const coverageGapIds = new Set(coverageGaps.map((gap) => gap.id));
const budgets = {
  timeMs: { ...analysis.budgets.timeMs },
  ioBytes: { ...analysis.budgets.ioBytes },
  semanticItems: { ...analysis.budgets.semanticItems },
};
for (const [name, budget] of Object.entries(budgets)) {
  if (budget.status === "within-budget" && budget.coverageGapId !== null) throw new Error(`${name} within-budget must not reference a Coverage Gap`);
  if (budget.status !== "within-budget" && !coverageGapIds.has(budget.coverageGapId)) {
    throw new Error(`${name} ${budget.status} requires a matching Coverage Gap`);
  }
}

const disclosureByClass = new Map((analysis.disclosures ?? []).map((entry) => [entry.dataClass, entry]));
for (const dataClass of disclosureByClass.keys()) {
  if (!(evidence.coverage?.classes ?? []).some((entry) => entry.id === dataClass)) throw new Error(`Disclosure references unknown data class ${dataClass}`);
}
const coverageClasses = (evidence.coverage?.classes ?? []).map((entry) => {
  const disclosure = disclosureByClass.get(entry.id);
  return {
    id: entry.id,
    status: entry.status,
    modelDisclosure: entry.modelDisclosure ?? "unknown",
    semanticDisclosureAuthorization: disclosure?.status ?? "not-requested",
    authorizationId: disclosure?.authorizationId ?? null,
  };
});
for (const entry of coverageClasses) {
  if (entry.semanticDisclosureAuthorization === "authorized" && !entry.authorizationId) {
    throw new Error(`Authorized disclosure for ${entry.id} requires authorizationId`);
  }
  if (entry.semanticDisclosureAuthorization !== "authorized" && entry.authorizationId) {
    throw new Error(`Disclosure ${entry.id} may only carry authorizationId when authorized`);
  }
}

const repairHandoffs = (analysis.repairHandoffs ?? []).map((handoff) => {
  if (handoff.executable !== false) throw new Error("Repair handoffs must explicitly set executable: false");
  if (!findingKeys.has(handoff.findingKey)) throw new Error(`Repair handoff references unknown finding ${handoff.findingKey}`);
  return {
    id: handoff.id || normalizedId("handoff", handoff),
    findingKey: handoff.findingKey,
    componentId: handoff.componentId,
    componentVersion: handoff.componentVersion ?? null,
    effectiveScope: handoff.effectiveScope,
    configurationLayer: handoff.configurationLayer,
    targetSurface: handoff.targetSurface,
    proposedChange: handoff.proposedChange,
    expectedDiff: handoff.expectedDiff,
    sideEffects: handoff.sideEffects ?? [],
    prerequisites: handoff.prerequisites ?? [],
    conflicts: handoff.conflicts ?? [],
    rollbackBoundary: handoff.rollbackBoundary,
    validation: handoff.validation,
    repairProof: handoff.repairProof,
    uncertainties: handoff.uncertainties ?? [],
    saferAlternatives: handoff.saferAlternatives ?? [],
    executable: false,
  };
});

const networkFreshness = {
  used: analysis.networkFreshness.used,
  authorized: analysis.networkFreshness.authorized,
  sourceClasses: analysis.networkFreshness.sourceClasses ?? [],
  ownerDomains: analysis.networkFreshness.ownerDomains ?? [],
  retrievedAt: analysis.networkFreshness.retrievedAt ?? null,
};

const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
function parseDateTime(value, label) {
  const timestamp = typeof value === "string" && RFC3339_DATE_TIME.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid RFC 3339 date-time`);
  return { value, timestamp };
}

function validateObservationWindow(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const startedAt = parseDateTime(value.startedAt, `${label}.startedAt`);
  const endedAt = parseDateTime(value.endedAt, `${label}.endedAt`);
  if (startedAt.timestamp > endedAt.timestamp) throw new Error(`${label} must not end before it starts`);
  return { startedAt, endedAt };
}

const collectorObservationWindow = validateObservationWindow(
  evidence.run.observationWindow,
  "Evidence observation window",
);
if (networkFreshness.used && (!networkFreshness.authorized || !networkFreshness.retrievedAt)) {
  throw new Error("Network Freshness use requires authorization and retrieval time");
}
if (!networkFreshness.used && networkFreshness.authorized) {
  throw new Error("Unused Network Freshness must not claim authorization");
}
const networkRetrievedAt = networkFreshness.used
  ? parseDateTime(networkFreshness.retrievedAt, "Network Freshness retrievedAt")
  : null;

const capabilitiesById = new Map();
for (const capability of [...(evidence.capabilities ?? []), ...(analysis.capabilities ?? [])]) {
  const normalized = typeof capability === "string"
    ? { id: capability, status: "reported" }
    : {
        id: capability.id,
        status: capability.status,
        ...(capability.implementationVersion === undefined ? {} : { implementationVersion: capability.implementationVersion }),
      };
  if (!normalized.id) throw new Error("Every capability needs an id");
  capabilitiesById.set(normalized.id, normalized);
}

const networkUsed = Boolean(evidence.run.networkUsed || networkFreshness.used);
if (networkUsed !== networkFreshness.used) throw new Error("Network use in evidence and Network Freshness analysis disagree");
let persistentDirectoryFingerprint = null;
if (args.output) {
  if (evidence.exportBoundary?.mode !== "portable-redacted" || !evidence.exportBoundary?.directoryFingerprint) {
    throw new Error("Persistent finalization requires Evidence created by an authorized persistent export");
  }
  if (evidence.exportBoundary.retention !== args.retention) {
    throw new Error("Persistent finalization retention must match the Evidence export retention");
  }
  if (evidence.target?.writeGuard?.complete !== true || evidence.target?.writeGuard?.unresolvedCount !== 0) {
    throw new Error("Persistent finalization requires a complete target write guard");
  }
  const evidenceDirectory = path.dirname(safeRealpath(args.evidence));
  const outputDirectory = path.dirname(canonicalWritePath(args.output));
  if (evidenceDirectory !== outputDirectory) {
    throw new Error("Persistent audit.json must be written beside its authorized evidence.json input");
  }
  if (args.analysis !== "-") {
    const analysisDirectory = path.dirname(safeRealpath(args.analysis));
    if (evidenceDirectory !== analysisDirectory) {
      throw new Error("A file-based persistent analysis.json input must be beside its authorized evidence.json input");
    }
  }
  persistentDirectoryFingerprint = exportDirectoryFingerprint(evidence.target.writeGuard.salt, outputDirectory);
  if (persistentDirectoryFingerprint !== evidence.exportBoundary.directoryFingerprint) {
    throw new Error("Evidence export directory fingerprint does not authorize this output directory");
  }
}
const run = {
  id: evidence.run.id,
  profiles: ["offline-core", ...(networkUsed ? ["network-freshness"] : [])],
  auditLogicVersion: AUDIT_SCHEMA_VERSION,
  metadataOnly: Boolean(evidence.run.metadataOnly),
  observationWindow: {
    startedAt: networkRetrievedAt && networkRetrievedAt.timestamp < collectorObservationWindow.startedAt.timestamp
      ? networkRetrievedAt.value
      : collectorObservationWindow.startedAt.value,
    endedAt: networkRetrievedAt && networkRetrievedAt.timestamp > collectorObservationWindow.endedAt.timestamp
      ? networkRetrievedAt.value
      : collectorObservationWindow.endedAt.value,
  },
  intentionalTargetMutation: false,
  networkUsed,
  persistentArtifactsCreated: Boolean(evidence.run.persistentArtifactsCreated || args.output),
  budgets,
};
if (evidence.target?.writeGuard) run.targetGuard = normalizeTarget(evidence.target).writeGuard;

const target = normalizeTarget(evidence.target);
const migrationSourceInventory = (evidence.migrationSourceInventory ?? []).map((entry) => pick(entry, [
  "path", "present", "sourceClass", "sourceKind", "bytes", "sha256", "stable",
]));
const dependencies = normalizeDependencies(evidence.dependencies);
const sourceState = normalizeSourceState(evidence.source);
const configurationSummary = normalizeConfiguration(evidence.configuration);
const plugins = normalizePlugins(evidence.plugins);
const consistency = normalizeConsistency(evidence.consistency);

const audit = {
  schemaVersion: AUDIT_SCHEMA_VERSION,
  kind: "openclaw-drift-audit",
  preview: true,
  run,
  export: {
    mode: "portable-redacted",
    delivery: args.output ? "persistent-file" : "interactive-stdout",
    authorization: args.output ? "explicit" : "not-required",
    retention: args.output ? args.retention : "not-persisted",
    localPathExportSupported: false,
    directoryFingerprint: persistentDirectoryFingerprint,
  },
  target,
  operatingContext,
  components,
  capabilities: [...capabilitiesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
  coverage: { classes: coverageClasses, gaps: coverageGaps },
  sources,
  baselineSnapshot: {
    generatedForRun: evidence.run.id,
    sourceIds: sources.map((source) => source.id).sort(),
    unresolved: (analysis.unresolvedBaselines ?? []).map((entry) => ({ componentId: entry.componentId, reason: entry.reason })),
  },
  baselines,
  rules,
  observations,
  findings,
  migrationChains,
  migrationSourceInventory,
  dependencies,
  sourceState,
  configurationSummary,
  plugins,
  repairHandoffs,
  redaction: {
    policy: evidence.redaction.policy,
    modelVisibleRawValues: false,
    secretValuesHashed: false,
    ...(evidence.redaction.clearConfigScalars === undefined ? {} : { clearConfigScalars: evidence.redaction.clearConfigScalars }),
    ...(evidence.redaction.redactedConfigScalars === undefined ? {} : { redactedConfigScalars: evidence.redaction.redactedConfigScalars }),
  },
  networkFreshness,
  consistency,
  diagnostics: (analysis.diagnostics ?? []).map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
};

for (const key of ["sources", "baselines", "rules", "observations", "findings", "migrationChains", "repairHandoffs"]) {
  audit[key].sort((left, right) => String(left.id ?? left.key ?? "").localeCompare(String(right.id ?? right.key ?? "")));
}

assertValidAudit(audit);
assertPortableAuditData(audit);

if (args.output) {
  const outputPath = canonicalWritePath(args.output);
  for (const rootEntry of args["forbid-root"]) {
    const root = safeRealpath(rootEntry);
    if (outputPath === root || outputPath.startsWith(`${root}${path.sep}`)) {
      throw new Error("Audit export must be outside every canonical Installation Target root");
    }
  }
  writeJsonAtomic(outputPath, audit);
} else {
  process.stdout.write(`${stableStringify(audit)}\n`);
}
