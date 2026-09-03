#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { assertPortableAuditData, assertValidAudit } from "./lib/audit-contract.mjs";
import { exportDirectoryFingerprint } from "./lib/target-graph.mjs";
import {
  canonicalWritePath,
  parseArgs,
  readStdinUtf8,
  readTextFile,
  safeRealpath,
  writeTextAtomic,
} from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2), {
  input: { type: "string" },
  output: { type: "string" },
  "forbid-root": { type: "string", multiple: true },
});
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const input = args.input
  ? readTextFile(args.input, MAX_INPUT_BYTES)
  : { raw: await readStdinUtf8(MAX_INPUT_BYTES), stable: true };
if (!input.stable) throw new Error("Canonical audit input changed while it was read");
const raw = input.raw;
const audit = JSON.parse(raw);
assertValidAudit(audit);
assertPortableAuditData(audit);
if (args.output) {
  if (!args.input) throw new Error("Persistent report export requires a persistent --input audit.json");
  if (audit.export?.delivery !== "persistent-file" || audit.export?.authorization !== "explicit" || !audit.export?.directoryFingerprint) {
    throw new Error("Persistent report export requires an explicitly authorized persistent audit.json");
  }
  const guard = audit.run?.targetGuard ?? audit.target?.writeGuard;
  if (guard?.complete !== true || guard?.unresolvedCount !== 0) {
    throw new Error("Persistent report export requires a complete target write guard");
  }
  const inputDirectory = path.dirname(safeRealpath(args.input));
  const outputDirectory = path.dirname(canonicalWritePath(args.output));
  if (inputDirectory !== outputDirectory) throw new Error("Persistent report.md must be written beside its authorized audit.json");
  if (exportDirectoryFingerprint(guard.salt, outputDirectory) !== audit.export.directoryFingerprint) {
    throw new Error("Audit export directory fingerprint does not authorize this report output directory");
  }
}

function text(value, fallback = "unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value)
    .replace(/[\r\n|]/gu, " ")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/`/gu, "ˋ")
    .slice(0, 1000);
}

function list(items, render, empty = "None recorded.") {
  if (!items?.length) return `${empty}\n`;
  return `${items.map((item) => `- ${render(item)}`).join("\n")}\n`;
}

const lines = [];
const selectedPackage = (audit.target?.packages ?? []).find((entry) =>
  entry.rootDir === audit.target?.selectedPackageRoot
);
lines.push("# OpenClaw Drift Audit", "");
lines.push(
  `Public Preview schema: \`${text(audit.schemaVersion)}\``,
  `Run: \`${text(audit.run?.id)}\``,
  `Observation window: ${text(audit.run?.observationWindow?.startedAt)} to ${text(audit.run?.observationWindow?.endedAt)}`,
  `Profiles: \`${(audit.run?.profiles ?? []).map((entry) => text(entry)).join(", ")}\``,
  `Export mode / delivery: \`${text(audit.export?.mode)}\` / \`${text(audit.export?.delivery)}\``,
  "",
);
lines.push("## Installation target", "");
lines.push(
  `- Discovery status: \`${text(audit.target?.status)}\``,
  `- Config: \`${text(audit.target?.configPath)}\``,
  `- Selected package: \`${text(audit.target?.selectedPackageRoot)}\``,
  `- Version / installation: \`${text(selectedPackage?.version)}\` / \`${text(selectedPackage?.installKind)}\``,
  `- Intentional target mutation: \`${text(audit.run?.intentionalTargetMutation)}\``,
  `- Network used: \`${text(audit.run?.networkUsed)}\``,
  `- Persistent export artifacts: \`${text(audit.run?.persistentArtifactsCreated)}\``,
  "",
);
lines.push("## Capability envelope", "");
if (!(audit.capabilities ?? []).length) {
  lines.push("No capabilities were recorded.", "");
} else {
  lines.push("| Capability | Status |", "|---|---|");
  for (const capability of audit.capabilities) {
    const record = typeof capability === "string" ? { id: capability, status: "reported" } : capability;
    lines.push(`| ${text(record.id)} | ${text(record.status)} |`);
  }
  lines.push("");
}
lines.push("## Declared budgets", "");
lines.push("| Budget | Limit | Used | Status |", "|---|---:|---:|---|");
for (const [name, budget] of Object.entries(audit.run?.budgets ?? {})) {
  lines.push(`| ${text(name)} | ${text(budget.limit)} | ${text(budget.used)} | ${text(budget.status)} |`);
}
lines.push("");
lines.push("## Operating context", "");
lines.push(
  `- Context: \`${text(audit.operatingContext?.id)}\``,
  `- Status: \`${text(audit.operatingContext?.status)}\``,
  `- Unknown material facts: \`${audit.operatingContext?.unknowns?.length ?? 0}\``,
  "",
);
lines.push("## Coverage", "");
lines.push("| Data class | Status | Model disclosure | Semantic authorization |", "|---|---|---|---|");
for (const entry of audit.coverage?.classes ?? []) {
  lines.push(`| ${text(entry.id)} | ${text(entry.status)} | ${text(entry.modelDisclosure)} | ${text(entry.semanticDisclosureAuthorization)} |`);
}
lines.push("", "### Coverage gaps", "");
lines.push(list(audit.coverage?.gaps, (gap) => `\`${text(gap.id)}\`: ${text(gap.reason)}`));

lines.push("## Baselines and sources", "");
lines.push(
  `- Sources recorded: \`${audit.sources?.length ?? 0}\``,
  `- Dynamic baselines recorded: \`${audit.baselines?.length ?? 0}\``,
  `- Network Freshness used: \`${text(audit.networkFreshness?.used)}\``,
  ...(audit.networkFreshness?.used
    ? [`- Network retrieval recorded at: \`${text(audit.networkFreshness?.retrievedAt)}\``]
    : []),
  "",
);
lines.push("### Source inventory", "");
if (!(audit.sources ?? []).length) {
  lines.push("No sources were recorded.", "");
} else {
  lines.push(
    "| Source | Component | Version / channel | Claim | Authority | Owner | Location | Retrieved |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const source of audit.sources) {
    lines.push(
      `| \`${text(source.id)}\` | \`${text(source.componentId)}\` | \`${text(source.version)}\` / \`${text(source.releaseChannel)}\` | ${text(source.applicableClaim)} | ${text(source.authorityTier)} | ${text(source.owner)} | \`${text(source.location)}\` | ${text(source.retrievedAt)} |`,
    );
  }
  lines.push("");
}
lines.push("### Unknown or conflicting baselines", "");
const unresolvedBaselines = [
  ...(audit.baselineSnapshot?.unresolved ?? []),
  ...(audit.baselines ?? []).filter((baseline) => ["unknown", "conflict"].includes(baseline.status)),
];
lines.push(list(unresolvedBaselines, (entry) => {
  if (typeof entry === "string") return text(entry);
  return `\`${text(entry.id, entry.componentId)}\`: ${text(entry.reason, entry.status)}`;
}));

lines.push("## Observations", "");
if (!(audit.observations ?? []).length) {
  lines.push("No observations were recorded. This is not a claim of complete coverage.", "");
} else {
  lines.push(
    "| Observation | Outcome | Component | Version | Scope | Layer | Surface | Observed | Baseline | Evidence sources |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const observation of audit.observations) {
    lines.push(
      `| \`${text(observation.id)}\` | ${text(observation.outcome)} | \`${text(observation.componentId)}\` | \`${text(observation.componentVersion)}\` | \`${text(observation.effectiveScope)}\` | ${text(observation.configurationLayer)} | \`${text(observation.surface)}\` | ${text(observation.observed?.summary, observation.observed?.status)} | ${text(observation.baseline?.summary, observation.baseline?.status)} | ${(observation.evidenceSourceIds ?? []).map((entry) => `\`${text(entry)}\``).join(", ") || "unknown"} |`,
    );
  }
  lines.push("");
}

lines.push("## Findings", "");
if (!(audit.findings ?? []).length) {
  lines.push("No findings were recorded. This is not a claim of complete coverage.", "");
} else {
  lines.push("| Finding | Drift class | Perspective | Layer | Impact | Confidence |", "|---|---|---|---|---|---|");
  for (const finding of audit.findings) {
    lines.push(
      `| \`${text(finding.key)}\` | ${text(finding.driftClass)} | ${text(finding.timePerspective)} | ${text(finding.configurationLayer)} | ${text(finding.impactSeverity)} | ${text(finding.evidenceConfidence)} |`,
    );
  }
  lines.push("");
  for (const finding of audit.findings) {
    lines.push(`### ${text(finding.title, finding.key)}`, "");
    lines.push(
      `- Key: \`${text(finding.key)}\``,
      `- Component: \`${text(finding.componentId)}\``,
      `- Component version: \`${text(finding.componentVersion)}\``,
      `- Scope: \`${text(finding.effectiveScope, "global")}\``,
      `- Layer / perspective: \`${text(finding.configurationLayer)}\` / \`${text(finding.timePerspective)}\``,
      `- Surface: \`${text(finding.surface)}\``,
      `- Classification: \`${text(finding.driftClass)}\``,
      `- Lifecycle: \`${text(finding.lifecycleState)}\``,
      `- Impact / confidence: \`${text(finding.impactSeverity)}\` / \`${text(finding.evidenceConfidence)}\``,
      `- Causality: \`${text(finding.causalStatus)}\``,
      `- Intent: \`${text(finding.intentStatus)}\``,
      `- Downstream exposure: \`${text(finding.downstreamExposure?.status)}\` — ${text(finding.downstreamExposure?.summary)}`,
      `- Repair side effects: \`${text(finding.repairSideEffects?.status)}\` — ${text(finding.repairSideEffects?.summary)}`,
      "",
      text(finding.summary, "No narrative summary supplied."),
      "",
    );
  }
}

lines.push("## Migration chains", "");
lines.push(list(audit.migrationChains, (chain) => `\`${text(chain.componentId)}\`: ${text(chain.summary, chain.status)}`));
lines.push("## Causal and compatibility links", "");
const causalFindings = (audit.findings ?? []).filter((finding) =>
  ["confirmed-cause", "probable-contributor", "plausible-cascade"].includes(finding.causalStatus)
);
lines.push(list(causalFindings, (finding) =>
  `\`${text(finding.key)}\` — ${text(finding.causalStatus)}: ${text(finding.summary)}`
));
lines.push("## Repair handoffs", "");
lines.push(
  list(
    audit.repairHandoffs,
    (handoff) => `\`${text(handoff.id)}\` — executable: \`false\`; ${text(handoff.proposedChange)}`,
    "No repair handoff was requested.",
  ),
);
lines.push("## Evidence boundary", "");
lines.push(
  `- Config scalar disclosure policy: \`${text(audit.redaction?.policy)}\``,
  `- Raw model-visible values: \`${text(audit.redaction?.modelVisibleRawValues)}\``,
  `- Secret values hashed: \`${text(audit.redaction?.secretValuesHashed)}\``,
  "",
  "## Consistency-marker scope",
  "",
  `- Source-appropriate markers recorded: \`${audit.consistency?.length ?? 0}\``,
  `- Stable markers: \`${(audit.consistency ?? []).filter((entry) => entry.stable === true).length}\``,
  `- Unstable markers: \`${(audit.consistency ?? []).filter((entry) => entry.stable !== true).length}\``,
  "- These markers cover the inputs named in `audit.json`; they are not a byte-for-byte fingerprint of every protected target root.",
  "",
  "## Diagnostics",
  "",
  list(audit.diagnostics, (diagnostic) => text(diagnostic.code, diagnostic.message)),
  "This report is derived from audit.json. It does not authorize repairs and does not assign a global pass/fail score.",
  "",
);

const report = `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").replace(/\n+$/u, "")}\n`;
if (args.output) {
  const outputPath = canonicalWritePath(args.output);
  for (const rootEntry of args["forbid-root"]) {
    const root = safeRealpath(rootEntry);
    if (outputPath === root || outputPath.startsWith(`${root}${path.sep}`)) {
      throw new Error("Report export must be outside every canonical Installation Target root");
    }
  }
  writeTextAtomic(outputPath, report);
} else {
  process.stdout.write(report);
}
