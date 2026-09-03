import fs from "node:fs";
import path from "node:path";
import { parseJson5 } from "./json5.mjs";
import { parseVersion, satisfiesVersion } from "./semver.mjs";
import { normalizeError, readTextFile, safeRealpath } from "./util.mjs";

const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;
const SUPPORTED_LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
]);
const UNSUPPORTED_LOCKFILES = new Map([
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
]);

function packagePathParts(packageName) {
  return packageName.startsWith("@") ? packageName.split("/") : [packageName];
}

function findInstalledPackage(componentRoot, packageName, boundaryRoot) {
  let cursor = safeRealpath(componentRoot);
  const boundary = boundaryRoot ? safeRealpath(boundaryRoot) : path.parse(cursor).root;
  for (;;) {
    const candidate = path.join(cursor, "node_modules", ...packagePathParts(packageName), "package.json");
    if (fs.existsSync(candidate)) return candidate;
    if (cursor === boundary || cursor === path.dirname(cursor)) return null;
    cursor = path.dirname(cursor);
  }
}

function readPackageJson(packagePath) {
  const result = readTextFile(packagePath, 4 * 1024 * 1024);
  return { data: parseJson5(result.raw), evidence: result };
}

function dependencyEntries(manifest) {
  const result = [];
  for (const [kind, optional, selecting] of [
    ["dependencies", false, true],
    ["peerDependencies", false, false],
    ["optionalDependencies", true, true],
  ]) {
    const record = manifest?.[kind];
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    for (const [name, requested] of Object.entries(record)) {
      if (typeof requested === "string") result.push({ kind, optional, selecting, name, requested });
    }
  }
  return result.sort((left, right) => `${left.name}:${left.kind}`.localeCompare(`${right.name}:${right.kind}`));
}

function managerHint(manifest) {
  const value = manifest?.packageManager;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(npm|pnpm)@/u);
  return match?.[1] ?? null;
}

function entryKey(kind, name) {
  return `${kind}\0${name}`;
}

function selectingManifestEntries(declared) {
  return new Map(
    declared
      .filter((entry) => entry.selecting)
      .map((entry) => [entryKey(entry.kind, entry.name), entry]),
  );
}

function safeSpecifier(value, componentRoot, aliasPath) {
  if (typeof value !== "string") return null;
  const file = value.match(/^(file:|link:)(.*)$/u);
  if (file) {
    const resolved = path.resolve(componentRoot, file[2]);
    return `${file[1]}${aliasPath(resolved)}`;
  }
  if (/^(?:git(?:\+[^:]+)?:|https?:|ssh:|git@|github:)/u.test(value)) return "$REDACTED_REMOTE_SPEC";
  return value.length <= 512 ? value : `${value.slice(0, 509)}...`;
}

function safeLockedVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = normalizePnpmVersion(value);
  if (normalized) return normalized;
  if (/^(?:link|file|workspace):/u.test(value)) return "$NON_REGISTRY_RESOLUTION";
  return "$UNRECOGNIZED_RESOLUTION";
}

function normalizePnpmVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (parseVersion(trimmed)) return trimmed.replace(/^v/u, "");
  const peerSuffix = trimmed.indexOf("(");
  if (peerSuffix > 0) {
    const base = trimmed.slice(0, peerSuffix);
    if (parseVersion(base)) return base.replace(/^v/u, "");
  }
  return null;
}

function mapDependencySection(record, kind, resolveVersion) {
  const result = new Map();
  if (record === undefined) return { entries: result, valid: true };
  if (!record || typeof record !== "object" || Array.isArray(record)) return { entries: result, valid: false };
  for (const [name, specifier] of Object.entries(record)) {
    if (typeof specifier !== "string") return { entries: result, valid: false };
    const resolution = resolveVersion(name);
    result.set(entryKey(kind, name), {
      kind,
      name,
      specifier,
      version: resolution.version,
      hasIntegrity: resolution.hasIntegrity,
    });
  }
  return { entries: result, valid: true };
}

function compareManifestToLock(expected, locked) {
  const missing = [];
  const extra = [];
  const specifierMismatches = [];
  for (const [key, declared] of expected) {
    const selected = locked.get(key);
    if (!selected) {
      missing.push({ kind: declared.kind, name: declared.name });
      continue;
    }
    if (selected.specifier !== declared.requested) {
      specifierMismatches.push({
        kind: declared.kind,
        name: declared.name,
        declared: declared.requested,
        locked: selected.specifier,
      });
    }
  }
  for (const [key, selected] of locked) {
    if (!expected.has(key)) extra.push({ kind: selected.kind, name: selected.name });
  }
  return {
    status: missing.length === 0 && extra.length === 0 && specifierMismatches.length === 0 ? "match" : "mismatch",
    missing,
    extra,
    specifierMismatches,
  };
}

function npmLockCandidate(raw, fileName, expected) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "unsupported", reason: "invalid-json", message: normalizeError(error), candidates: [] };
  }
  const version = Number(parsed?.lockfileVersion);
  if (version !== 2 && version !== 3) {
    return {
      status: "unsupported",
      reason: "unsupported-lockfile-version",
      formatVersion: Number.isFinite(version) ? String(version) : null,
      candidates: [],
    };
  }
  const packages = parsed?.packages;
  const root = packages?.[""];
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { status: "unsupported", reason: "root-package-missing", formatVersion: String(version), candidates: [] };
  }
  const resolveVersion = (name) => {
    const packageRecord = packages?.[`node_modules/${name}`];
    const legacyRecord = parsed?.dependencies?.[name];
    const versionValue = typeof packageRecord?.version === "string"
      ? packageRecord.version
      : typeof legacyRecord?.version === "string"
        ? legacyRecord.version
        : null;
    return {
      version: versionValue,
      hasIntegrity: typeof packageRecord?.integrity === "string" || typeof legacyRecord?.integrity === "string",
    };
  };
  const dependencies = mapDependencySection(root.dependencies, "dependencies", resolveVersion);
  const optional = mapDependencySection(root.optionalDependencies, "optionalDependencies", resolveVersion);
  if (!dependencies.valid || !optional.valid) {
    return { status: "unsupported", reason: "invalid-root-dependency-map", formatVersion: String(version), candidates: [] };
  }
  const entries = new Map([...dependencies.entries, ...optional.entries]);
  const comparison = compareManifestToLock(expected, entries);
  return {
    status: comparison.status === "match" ? "candidate" : "manifest-mismatch",
    adapter: "npm-lock-v2-v3",
    formatVersion: String(version),
    candidates: [{
      id: `${fileName}:root`,
      importer: ".",
      documentIndex: null,
      entries,
      comparison,
    }],
  };
}

function stripYamlComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function splitYamlMapping(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ":" && (index === value.length - 1 || /\s/u.test(value[index + 1]))) {
      return [value.slice(0, index), value.slice(index + 1).trim()];
    }
  }
  return null;
}

function yamlScalar(value) {
  const trimmed = stripYamlComment(value).trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) return null;
    return trimmed.slice(1, -1).replace(/''/gu, "'");
  }
  if (trimmed.startsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed);
      return typeof decoded === "string" ? decoded : null;
    } catch {
      return null;
    }
  }
  if (/^[\[\]{|}>&*!]/u.test(trimmed) || /^(?:null|~|true|false)$/iu.test(trimmed)) return null;
  if (/[\u0000-\u001F\u007F]/u.test(trimmed)) return null;
  return trimmed;
}

function yamlLines(document) {
  const result = [];
  for (const [lineNumber, raw] of document.replace(/^\uFEFF/u, "").split(/\r?\n/u).entries()) {
    if (/^\s*$/u.test(raw) || /^\s*#/u.test(raw)) continue;
    const indentText = raw.match(/^ */u)?.[0] ?? "";
    if (raw.slice(indentText.length).startsWith("\t") || indentText.length !== raw.search(/\S/u)) {
      return { lines: [], error: `unsupported-indentation-at-line-${lineNumber + 1}` };
    }
    const content = stripYamlComment(raw.slice(indentText.length));
    if (content.trim() === "") continue;
    const mapping = splitYamlMapping(content);
    result.push({
      lineNumber: lineNumber + 1,
      indent: indentText.length,
      content,
      mapping,
      key: mapping ? yamlScalar(mapping[0]) : null,
      value: mapping ? mapping[1] : null,
    });
  }
  return { lines: result, error: null };
}

function childMappings(lines, parentIndex, endIndex) {
  const parentIndent = lines[parentIndex].indent;
  const descendants = [];
  for (let index = parentIndex + 1; index < endIndex; index += 1) {
    if (lines[index].indent <= parentIndent) break;
    if (lines[index].mapping) descendants.push({ ...lines[index], index });
  }
  if (descendants.length === 0) return [];
  const childIndent = Math.min(...descendants.map((entry) => entry.indent));
  return descendants.filter((entry) => entry.indent === childIndent);
}

function blockEnd(lines, startIndex, limit = lines.length) {
  const indent = lines[startIndex].indent;
  for (let index = startIndex + 1; index < limit; index += 1) {
    if (lines[index].indent <= indent) return index;
  }
  return limit;
}

function parsePnpmSection(lines, section, rootEnd, kind) {
  const entries = new Map();
  const issues = [];
  if (section.value === "{}") return { entries, issues };
  if (section.value !== "") return { entries, issues: [`inline-${kind}-map-unsupported`] };
  const sectionEnd = blockEnd(lines, section.index, rootEnd);
  for (const dependency of childMappings(lines, section.index, sectionEnd)) {
    if (typeof dependency.key !== "string" || dependency.key === "") {
      issues.push(`invalid-${kind}-name-at-line-${dependency.lineNumber}`);
      continue;
    }
    let specifier = null;
    let version = null;
    if (dependency.value !== "") {
      version = yamlScalar(dependency.value);
    } else {
      const dependencyEnd = blockEnd(lines, dependency.index, sectionEnd);
      const fields = childMappings(lines, dependency.index, dependencyEnd);
      for (const field of fields) {
        if (field.key === "specifier") specifier = yamlScalar(field.value);
        if (field.key === "version") version = yamlScalar(field.value);
      }
    }
    if (typeof specifier !== "string" || typeof version !== "string") {
      issues.push(`incomplete-${kind}-entry:${dependency.key}`);
    }
    entries.set(entryKey(kind, dependency.key), {
      kind,
      name: dependency.key,
      specifier,
      version,
      hasIntegrity: null,
    });
  }
  return { entries, issues };
}

function parsePnpmDocument(document, documentIndex, expected) {
  const parsedLines = yamlLines(document);
  if (parsedLines.error) return { status: "unsupported", reason: parsedLines.error };
  const { lines } = parsedLines;
  const lockVersionLine = lines.find((line) => line.indent === 0 && line.key === "lockfileVersion");
  const lockVersion = lockVersionLine ? yamlScalar(lockVersionLine.value) : null;
  if (lockVersion !== "9.0" && lockVersion !== "9") {
    return { status: "unsupported", reason: "unsupported-lockfile-version", formatVersion: lockVersion };
  }
  const importersIndex = lines.findIndex((line) => line.indent === 0 && line.key === "importers" && line.value === "");
  if (importersIndex < 0) return { status: "unsupported", reason: "importers-map-missing", formatVersion: lockVersion };
  const importersEnd = blockEnd(lines, importersIndex);
  const importer = childMappings(lines, importersIndex, importersEnd).find((entry) => entry.key === ".");
  if (!importer) return { status: "unsupported", reason: "root-importer-missing", formatVersion: lockVersion };
  const importerEnd = blockEnd(lines, importer.index, importersEnd);
  const rootFields = childMappings(lines, importer.index, importerEnd);
  const fieldNames = new Set(rootFields.map((entry) => entry.key));
  const dependencySection = rootFields.find((entry) => entry.key === "dependencies");
  const optionalSection = rootFields.find((entry) => entry.key === "optionalDependencies");
  if (!dependencySection && !optionalSection &&
      (fieldNames.has("configDependencies") || fieldNames.has("packageManagerDependencies"))) {
    return { status: "environment-lock", reason: "non-project-root-importer", formatVersion: lockVersion };
  }
  const dependencies = dependencySection
    ? parsePnpmSection(lines, dependencySection, importerEnd, "dependencies")
    : { entries: new Map(), issues: [] };
  const optional = optionalSection
    ? parsePnpmSection(lines, optionalSection, importerEnd, "optionalDependencies")
    : { entries: new Map(), issues: [] };
  const entries = new Map([...dependencies.entries, ...optional.entries]);
  const issues = [...dependencies.issues, ...optional.issues];
  const comparison = compareManifestToLock(expected, entries);
  if (issues.length > 0) comparison.status = "unsupported";
  return {
    status: comparison.status === "match" ? "candidate" : comparison.status,
    adapter: "pnpm-lock-v9",
    formatVersion: lockVersion,
    candidate: {
      id: `pnpm-lock.yaml:document-${documentIndex}:root`,
      importer: ".",
      documentIndex,
      entries,
      comparison,
      issues,
    },
  };
}

function splitYamlDocuments(raw) {
  const documents = [];
  let current = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (/^---(?:\s+#.*)?\s*$/u.test(line)) {
      if (current.some((entry) => entry.trim() !== "")) documents.push(current.join("\n"));
      current = [];
      continue;
    }
    if (/^\.\.\.\s*$/u.test(line)) {
      if (current.some((entry) => entry.trim() !== "")) documents.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.some((entry) => entry.trim() !== "")) documents.push(current.join("\n"));
  return documents;
}

function pnpmLockCandidates(raw, expected) {
  const documents = splitYamlDocuments(raw);
  if (documents.length === 0) return { status: "unsupported", reason: "empty-yaml", candidates: [] };
  const parsed = documents.map((document, index) => parsePnpmDocument(document, index, expected));
  const candidates = parsed.filter((entry) => entry.candidate).map((entry) => entry.candidate);
  const matching = parsed.filter((entry) => entry.status === "candidate");
  let status = "manifest-mismatch";
  if (matching.length > 0) status = "candidate";
  else if (parsed.every((entry) => ["unsupported", "environment-lock"].includes(entry.status))) status = "unsupported";
  return {
    status,
    adapter: "pnpm-lock-v9",
    formatVersion: parsed.find((entry) => entry.formatVersion)?.formatVersion ?? null,
    reason: status === "unsupported" ? "no-supported-project-document" : undefined,
    candidates,
    documents: parsed.map((entry, index) => ({
      documentIndex: index,
      status: entry.status,
      reason: entry.reason,
      formatVersion: entry.formatVersion ?? null,
    })),
  };
}

function publicComparison(comparison, componentRoot, aliasPath) {
  return {
    status: comparison.status,
    missing: comparison.missing,
    extra: comparison.extra,
    specifierMismatches: comparison.specifierMismatches.map((entry) => ({
      ...entry,
      declared: safeSpecifier(entry.declared, componentRoot, aliasPath),
      locked: safeSpecifier(entry.locked, componentRoot, aliasPath),
    })),
  };
}

function inspectLockfiles(componentRoot, manifest, declared, aliasPath) {
  const expected = selectingManifestEntries(declared);
  const lockfiles = [];
  const gaps = [];
  const matches = [];
  const unsupportedPresent = [];

  for (const [fileName, manager] of [...SUPPORTED_LOCKFILES, ...UNSUPPORTED_LOCKFILES]) {
    const filePath = path.join(componentRoot, fileName);
    if (!fs.existsSync(filePath)) continue;
    let evidence;
    try {
      evidence = readTextFile(filePath, MAX_LOCKFILE_BYTES);
    } catch (error) {
      lockfiles.push({ path: aliasPath(filePath), kind: fileName, manager, status: "unreadable", error: normalizeError(error) });
      gaps.push({ code: "dependency-lockfile-unreadable", lockfile: fileName, message: normalizeError(error) });
      unsupportedPresent.push({ fileName, manager, reason: "unreadable" });
      continue;
    }
    const base = { path: aliasPath(filePath), kind: fileName, manager, bytes: evidence.bytes, sha256: evidence.sha256 };
    if (UNSUPPORTED_LOCKFILES.has(fileName)) {
      lockfiles.push({ ...base, status: "unsupported", reason: "adapter-not-available" });
      unsupportedPresent.push({ fileName, manager, reason: "adapter-not-available" });
      continue;
    }
    const analysis = manager === "npm"
      ? npmLockCandidate(evidence.raw, fileName, expected)
      : pnpmLockCandidates(evidence.raw, expected);
    const summaries = (analysis.candidates ?? []).map((candidate) => ({
      id: candidate.id,
      importer: candidate.importer,
      documentIndex: candidate.documentIndex,
      manifestComparison: publicComparison(candidate.comparison, componentRoot, aliasPath),
    }));
    lockfiles.push({
      ...base,
      status: analysis.status,
      adapter: analysis.adapter ?? null,
      formatVersion: analysis.formatVersion ?? null,
      reason: analysis.reason,
      candidates: summaries,
      ...(analysis.documents ? { documents: analysis.documents } : {}),
    });
    if (analysis.status === "unsupported") {
      unsupportedPresent.push({ fileName, manager, reason: analysis.reason ?? "unsupported-format" });
      gaps.push({ code: "dependency-lockfile-unsupported", lockfile: fileName, reason: analysis.reason ?? "unsupported-format" });
    }
    for (const candidate of analysis.candidates ?? []) {
      if (candidate.comparison.status === "match") {
        matches.push({ ...candidate, fileName, manager, path: aliasPath(filePath), adapter: analysis.adapter, formatVersion: analysis.formatVersion });
      } else if (candidate.comparison.status === "mismatch") {
        gaps.push({
          code: "dependency-lockfile-manifest-mismatch",
          lockfile: fileName,
          documentIndex: candidate.documentIndex,
          comparison: publicComparison(candidate.comparison, componentRoot, aliasPath),
        });
      } else {
        gaps.push({
          code: "dependency-lockfile-unsupported",
          lockfile: fileName,
          documentIndex: candidate.documentIndex,
          reason: candidate.issues?.join(",") || "unsupported-root-importer",
        });
      }
    }
  }

  if (expected.size === 0) return { lockfiles, selection: { status: "not-required" }, selected: null, gaps };

  const hint = managerHint(manifest);
  const eligible = hint ? matches.filter((candidate) => candidate.manager === hint) : matches;
  const unresolvedUnsupported = hint
    ? unsupportedPresent.filter((candidate) => candidate.manager === hint)
    : unsupportedPresent;
  if (eligible.length === 1 && unresolvedUnsupported.length === 0) {
    const selected = eligible[0];
    return {
      lockfiles,
      selection: {
        status: "selected",
        manager: selected.manager,
        lockfile: selected.fileName,
        path: selected.path,
        adapter: selected.adapter,
        formatVersion: selected.formatVersion,
        importer: selected.importer,
        documentIndex: selected.documentIndex,
        selectedBy: hint ? "package-manager-and-manifest-match" : "unique-manifest-match",
      },
      selected,
      gaps,
    };
  }
  if (eligible.length > 1 || (eligible.length === 1 && unresolvedUnsupported.length > 0)) {
    gaps.push({
      code: "dependency-lock-selection-ambiguous",
      packageManagerHint: hint,
      matchingCandidates: eligible.map((entry) => ({ lockfile: entry.fileName, documentIndex: entry.documentIndex })),
      unsupportedCandidates: unresolvedUnsupported.map((entry) => ({ lockfile: entry.fileName, reason: entry.reason })),
    });
    return { lockfiles, selection: { status: "ambiguous", packageManagerHint: hint }, selected: null, gaps };
  }
  if (unresolvedUnsupported.length > 0) {
    gaps.push({
      code: "dependency-lock-selection-unsupported",
      packageManagerHint: hint,
      candidates: unresolvedUnsupported.map((entry) => ({ lockfile: entry.fileName, reason: entry.reason })),
    });
  }
  gaps.push({ code: "dependency-lock-selection-missing", packageManagerHint: hint, declaredSelectingDependencies: expected.size });
  return { lockfiles, selection: { status: "missing", packageManagerHint: hint }, selected: null, gaps };
}

function lockCheckFor(entry, selected, installedVersion, componentRoot, aliasPath, gaps) {
  if (!entry.selecting) return { status: "not-selecting-peer" };
  if (!selected) return { status: "unavailable" };
  const locked = selected.entries.get(entryKey(entry.kind, entry.name));
  if (!locked) {
    gaps.push({ code: "dependency-lock-entry-missing", dependency: entry.name, kind: entry.kind });
    return { status: "missing" };
  }
  const resolvedVersion = normalizePnpmVersion(locked.version);
  if (!resolvedVersion) {
    gaps.push({ code: "dependency-lock-version-not-comparable", dependency: entry.name, kind: entry.kind });
  }
  const declaredStatus = resolvedVersion
    ? satisfiesVersion(resolvedVersion, entry.requested)
    : { status: "unknown", reason: "locked-version-unrecognized" };
  if (declaredStatus.status === "unknown") {
    gaps.push({
      code: "dependency-lock-range-not-evaluated",
      dependency: entry.name,
      kind: entry.kind,
      reason: declaredStatus.reason,
    });
  }
  const installedStatus = !installedVersion
    ? "not-installed"
    : !resolvedVersion
      ? "unknown"
      : installedVersion === resolvedVersion
        ? "match"
        : "mismatch";
  return {
    status: "selected",
    specifier: safeSpecifier(locked.specifier, componentRoot, aliasPath),
    version: safeLockedVersion(locked.version),
    hasIntegrity: locked.hasIntegrity,
    declaredStatus: declaredStatus.status,
    declaredReason: declaredStatus.reason,
    installedStatus,
  };
}

export function inspectDirectDependencies(component, options) {
  const aliasPath = options.aliasPath;
  const gaps = [];
  let manifest;
  let manifestEvidence;
  try {
    const read = readPackageJson(path.join(component.rootDir, "package.json"));
    manifest = read.data;
    manifestEvidence = read.evidence;
  } catch (error) {
    return {
      componentId: component.id,
      checks: [],
      lockfiles: [],
      lockSelection: { status: "unavailable" },
      gaps: [{ code: "component-package-json-unreadable", message: normalizeError(error) }],
    };
  }

  const allDeclared = dependencyEntries(manifest);
  const lockInspection = inspectLockfiles(component.rootDir, manifest, allDeclared, aliasPath);
  gaps.push(...lockInspection.gaps);
  const declared = allDeclared.slice();
  if (declared.length > 1000) {
    gaps.push({ code: "dependency-budget-exceeded", declared: declared.length, limit: 1000 });
    declared.length = 1000;
  }

  const checks = declared.map((entry) => {
    const publicEntry = {
      ...entry,
      requested: safeSpecifier(entry.requested, component.rootDir, aliasPath),
    };
    const installedManifestPath = findInstalledPackage(component.rootDir, entry.name, options.resolutionBoundary);
    let installed = null;
    let status = entry.optional ? "not-installed-optional" : "missing";
    let reason;
    if (installedManifestPath) {
      try {
        const read = readPackageJson(installedManifestPath);
        const version = typeof read.data?.version === "string" ? read.data.version : null;
        const satisfaction = version
          ? satisfiesVersion(version, entry.requested)
          : { status: "unknown", reason: "installed-version-missing" };
        status = satisfaction.status;
        reason = satisfaction.reason;
        if (satisfaction.status === "unknown") {
          gaps.push({
            code: "dependency-range-not-evaluated",
            dependency: entry.name,
            requested: safeSpecifier(entry.requested, component.rootDir, aliasPath),
            reason: satisfaction.reason,
          });
        }
        installed = {
          name: typeof read.data?.name === "string" ? read.data.name : entry.name,
          version,
          packageJsonPath: aliasPath(installedManifestPath),
          packageJsonSha256: read.evidence.sha256,
          resolvedRoot: aliasPath(path.dirname(safeRealpath(installedManifestPath))),
          nameStatus: typeof read.data?.name !== "string" || read.data.name === entry.name ? "match" : "mismatch",
        };
      } catch (error) {
        gaps.push({ code: "installed-package-unreadable", dependency: entry.name, message: normalizeError(error) });
        status = "unknown";
      }
    }
    const lock = lockCheckFor(
      entry,
      lockInspection.selected,
      installed?.version ?? null,
      component.rootDir,
      aliasPath,
      gaps,
    );
    return { ...publicEntry, status, reason, installed, lock };
  });

  return {
    componentId: component.id,
    packageJson: {
      path: aliasPath(path.join(component.rootDir, "package.json")),
      sha256: manifestEvidence.sha256,
      name: typeof manifest?.name === "string" ? manifest.name : null,
      version: typeof manifest?.version === "string" ? manifest.version : null,
      packageManager: typeof manifest?.packageManager === "string" ? manifest.packageManager : null,
    },
    checks,
    lockfiles: lockInspection.lockfiles,
    lockSelection: lockInspection.selection,
    gaps,
  };
}
