import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { canonicalWritePath, isInside, safeRealpath, sha256 } from "./util.mjs";

const MAX_EXTERNAL_ROOTS = 500;

export function resolveConfiguredRuntimePath(value, options = {}) {
  const runtimeCwd = options.runtimeCwd;
  const effectiveHomeDir = Object.hasOwn(options, "effectiveHomeDir")
    ? options.effectiveHomeDir
    : os.homedir();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) return null;
  if (trimmed === "~") return effectiveHomeDir ? path.resolve(effectiveHomeDir) : null;
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith("~/")) {
    return effectiveHomeDir ? path.resolve(effectiveHomeDir, trimmed.slice(2)) : null;
  }
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return runtimeCwd ? path.resolve(runtimeCwd, trimmed) : null;
}

function runtimeCwdPath(value, runtimeCwd) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return runtimeCwd ? path.resolve(runtimeCwd, trimmed) : null;
}

function valuesAt(config, parts) {
  let cursor = config;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = cursor[part];
  }
  return Array.isArray(cursor) ? cursor : [];
}

function agentEntries(config) {
  const entries = config?.agents?.entries ?? config?.agents?.list;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === "object") return Object.values(entries);
  return [];
}

export function configuredExternalRoots(config, options = {}) {
  const candidates = [];
  const add = (role, value) => candidates.push({
    role,
    configuredValue: value,
    path: resolveConfiguredRuntimePath(value, options),
  });
  add("default-workspace", config?.agents?.defaults?.workspace);
  for (const entry of agentEntries(config)) {
    add("agent-workspace", entry?.workspace);
    add("agent-directory", entry?.agentDir);
  }
  for (const value of valuesAt(config, ["plugins", "load", "paths"])) add("plugin-load-path", value);
  for (const value of valuesAt(config, ["skills", "load", "extraDirs"])) add("skill-extra-directory", value);
  for (const value of valuesAt(config, ["hooks", "internal", "load", "extraDirs"])) add("hook-extra-directory", value);
  const present = candidates.filter((entry) => entry.configuredValue !== undefined && entry.configuredValue !== null);
  const resolved = present.filter((entry) => entry.path).slice(0, MAX_EXTERNAL_ROOTS);
  const gaps = present
    .filter((entry) => !entry.path)
    .slice(0, MAX_EXTERNAL_ROOTS)
    .map((entry) => ({
      code: "configured-external-root-not-statically-resolved",
      role: entry.role,
      reason: "relative-or-invalid-path",
    }));
  if (present.length > MAX_EXTERNAL_ROOTS) {
    gaps.push({ code: "external-root-budget-exceeded", observed: present.length, limit: MAX_EXTERNAL_ROOTS });
  }
  return { roots: resolved, gaps };
}

function normalizedAgentId(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return normalized || "main";
}

function configuredAgents(config) {
  const roster = config?.agents?.entries ?? config?.agents?.list;
  if (Array.isArray(roster)) {
    return roster
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({ ...entry, id: normalizedAgentId(entry.id) }));
  }
  if (roster && typeof roster === "object") {
    return Object.entries(roster)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([id, entry]) => ({ ...entry, id: normalizedAgentId(id) }));
  }
  return [];
}

export function effectiveAgentWorkspaceRoots(config, options = {}) {
  const stateDir = options.stateDir ? safeRealpath(options.stateDir) : null;
  const agents = configuredAgents(config);
  const hasRoster = Boolean(config?.agents && (
    Object.hasOwn(config.agents, "entries") || Object.hasOwn(config.agents, "list")
  ));
  const effectiveAgents = agents.length === 0 && !hasRoster ? [{ id: "main" }] : agents;
  const markedDefaults = config?.agents?.ownership === "explicit"
    ? []
    : effectiveAgents.filter((entry) => entry.default === true);
  const inheritedId = markedDefaults.length === 1
    ? markedDefaults[0].id
    : effectiveAgents.length === 1
      ? effectiveAgents[0].id
      : null;
  const fallback = resolveConfiguredRuntimePath(config?.agents?.defaults?.workspace, options);
  const runtimeWorkspaceConfigured =
    typeof options.runtimeWorkspaceDir === "string" && options.runtimeWorkspaceDir.trim().length > 0;
  const runtimeDefaultWorkspace = runtimeCwdPath(options.runtimeWorkspaceDir, options.runtimeCwd);
  const roots = [];
  const gaps = [];
  if (config?.agents?.defaults?.workspace && !fallback) {
    gaps.push({ code: "agent-default-workspace-not-statically-resolved", reason: "runtime-cwd-required" });
  }
  for (const agent of effectiveAgents) {
    const explicit = resolveConfiguredRuntimePath(agent.workspace, options);
    if (agent.workspace && !explicit) {
      gaps.push({
        code: "agent-workspace-not-statically-resolved",
        reason: "runtime-cwd-required",
        agentId: agent.id,
      });
      continue;
    }
    let workspace = explicit;
    let resolution = "explicit";
    if (!workspace && inheritedId === agent.id) {
      if (fallback) {
        workspace = fallback;
        resolution = "inherited-default";
      } else if (runtimeDefaultWorkspace) {
        workspace = runtimeDefaultWorkspace;
        resolution = "runtime-default-override";
      } else if (runtimeWorkspaceConfigured) {
        gaps.push({
          code: "agent-runtime-default-workspace-not-statically-resolved",
          reason: "runtime-cwd-required",
          agentId: agent.id,
        });
        continue;
      } else {
        workspace = stateDir ? path.join(stateDir, "workspace") : null;
        resolution = "state-default";
      }
    } else if (!workspace && fallback) {
      workspace = path.join(fallback, agent.id);
      resolution = "default-plus-agent-id";
    } else if (!workspace && stateDir) {
      workspace = path.join(stateDir, `workspace-${agent.id}`);
      resolution = "state-plus-agent-id";
    }
    if (workspace) roots.push({ path: workspace, role: "effective-agent-workspace", agentId: agent.id, resolution });
    else gaps.push({ code: "agent-workspace-not-statically-resolved", reason: "state-root-unavailable", agentId: agent.id });
  }
  return { roots, gaps };
}

function canonicalRecord(record) {
  return {
    path: safeRealpath(record.path),
    kind: record.kind === "file" ? "file" : "directory",
    roles: [...new Set(record.roles ?? [record.role].filter(Boolean))].sort(),
  };
}

function minimize(records) {
  const merged = new Map();
  for (const raw of records.filter((entry) => entry?.path)) {
    const record = canonicalRecord(raw);
    const key = `${record.kind}\0${record.path}`;
    const existing = merged.get(key);
    if (existing) existing.roles = [...new Set([...existing.roles, ...record.roles])].sort();
    else merged.set(key, record);
  }
  const directories = [...merged.values()]
    .filter((entry) => entry.kind === "directory")
    .sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));
  const keptDirectories = directories.filter((entry, index) =>
    !directories.slice(0, index).some((parent) => isInside(parent.path, entry.path)),
  );
  const files = [...merged.values()].filter((entry) =>
    entry.kind === "file" && !keptDirectories.some((root) => isInside(root.path, entry.path)),
  );
  return [...keptDirectories, ...files].sort((left, right) => left.path.localeCompare(right.path));
}

export function buildProtectedTargetGraph(options) {
  const records = [
    { path: options.discovery?.stateDir, kind: "directory", role: "state-root" },
    { path: options.packageRoot, kind: "directory", role: "selected-package-root" },
    { path: options.sourceRoot, kind: "directory", role: "source-root" },
    { path: options.discovery?.configPath ? path.dirname(options.discovery.configPath) : null, kind: "directory", role: "config-root" },
    ...(options.includeRoots ?? []).map((entry) => ({ path: entry, kind: "directory", role: "allowed-include-root" })),
    ...(options.discovery?.packages ?? []).map((entry) => ({ path: entry.rootDir, kind: "directory", role: "discovered-package-root" })),
    ...(options.discovery?.launchers ?? []).map((entry) => ({ path: entry.path, kind: "file", role: "launcher" })),
    ...(options.configFiles ?? []).map((entry) => ({ path: entry.path, kind: "file", role: "config-or-include-file" })),
    ...(options.plugins ?? []).map((entry) => ({ path: entry.root, kind: "directory", role: "plugin-root" })),
    ...(options.externalRoots ?? []).map((entry) => ({ path: entry.path, kind: "directory", role: entry.role })),
  ];
  return minimize(records);
}

export function createTargetWriteGuard(records, aliasPath, deterministicSeed, options = {}) {
  const salt = deterministicSeed === undefined
    ? crypto.randomBytes(16).toString("hex")
    : sha256(`openclaw-target-write-guard-test-only\0${deterministicSeed}`).slice(0, 32);
  const roots = records.map((entry) => ({
    alias: aliasPath(entry.path),
    kind: entry.kind,
    roles: entry.roles,
    fingerprint: targetGuardFingerprint(salt, entry.kind, entry.path),
  }));
  return {
    algorithm: "sha256-salted-path-v1",
    salt,
    complete: options.complete !== false,
    unresolvedCount: options.unresolvedCount ?? 0,
    roots,
  };
}

export function targetGuardFingerprint(salt, kind, candidate) {
  return sha256(`openclaw-target-write-guard-v1\0${salt}\0${kind}\0${safeRealpath(candidate)}`);
}

export function exportDirectoryFingerprint(salt, directory) {
  return sha256(`openclaw-export-directory-v1\0${salt}\0${safeRealpath(directory)}`);
}

export function outputConflictsWithTarget(outputPath, records) {
  const output = canonicalWritePath(outputPath);
  return records.find((entry) =>
    entry.kind === "directory" ? isInside(entry.path, output) : safeRealpath(entry.path) === output,
  ) ?? null;
}

export function verifyTargetWriteGuard(writeGuard, suppliedPaths) {
  if (!writeGuard || writeGuard.algorithm !== "sha256-salted-path-v1" || !Array.isArray(writeGuard.roots)) {
    return { ok: false, reason: "missing-or-unsupported-target-write-guard", missing: [] };
  }
  if (writeGuard.complete !== true || writeGuard.unresolvedCount !== 0) {
    return { ok: false, reason: "incomplete-target-write-guard", missing: writeGuard.roots ?? [] };
  }
  const supplied = new Set();
  for (const candidate of suppliedPaths) {
    supplied.add(targetGuardFingerprint(writeGuard.salt, "directory", candidate));
    supplied.add(targetGuardFingerprint(writeGuard.salt, "file", candidate));
  }
  const missing = writeGuard.roots.filter((entry) => !supplied.has(entry.fingerprint));
  return { ok: missing.length === 0, reason: missing.length ? "incomplete-forbidden-target-set" : null, missing };
}
