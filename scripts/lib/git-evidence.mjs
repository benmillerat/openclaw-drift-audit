import { spawnSync } from "node:child_process";
import path from "node:path";
import { normalizeError, pathExists, sanitizeUrl, sha256 } from "./util.mjs";

function runGit(rootDir, args) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "diff.external=",
      "-C",
      rootDir,
      ...args,
    ],
    {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        HOME: process.env.HOME,
        LANG: "C",
        LC_ALL: "C",
      },
    },
  );
  if (result.error) return { ok: false, error: normalizeError(result.error) };
  if (result.status !== 0) {
    return { ok: false, error: normalizeError(result.stderr || `git exited ${result.status}`) };
  }
  return { ok: true, stdout: result.stdout };
}

function parseStatus(raw) {
  const records = raw.split("\0");
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    const change = { status, path: file };
    if (/[RC]/u.test(status) && records[index + 1]) change.originalPath = records[++index];
    changes.push(change);
  }
  return changes;
}

export function classifySourceReleaseBinding(git, packageVersion) {
  if (!git?.present) return { state: "not-a-source-checkout", baselineChannel: null };
  if (!git.readable) return { state: "unknown", baselineChannel: "unknown" };
  const expectedTags = typeof packageVersion === "string"
    ? new Set([packageVersion, `v${packageVersion}`])
    : new Set();
  if (git.exactTag && expectedTags.has(git.exactTag)) {
    return { state: "exact-version-tag", baselineChannel: "version-tag", tag: git.exactTag };
  }
  if (git.exactTag) {
    return { state: "tag-version-mismatch", baselineChannel: "tagged-other-version", tag: git.exactTag };
  }
  if (new Set(["main", "master", "develop", "dev"]).has(git.branch)) {
    return { state: "unreleased-branch-revision", baselineChannel: "unreleased-mainline" };
  }
  return { state: "untagged-source-revision", baselineChannel: "source-revision" };
}

export function inspectGit(rootDir, aliasPath) {
  if (!pathExists(path.join(rootDir, ".git"))) return { present: false };
  const inside = runGit(rootDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return { present: true, readable: false, error: inside.error || "not-a-work-tree" };
  }
  const head = runGit(rootDir, ["rev-parse", "HEAD"]);
  const exactTag = runGit(rootDir, ["describe", "--tags", "--exact-match", "HEAD"]);
  const branch = runGit(rootDir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const remote = runGit(rootDir, ["remote", "get-url", "origin"]);
  const status = runGit(rootDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changes = status.ok ? parseStatus(status.stdout) : [];
  return {
    present: true,
    readable: true,
    root: aliasPath(rootDir),
    head: head.ok ? head.stdout.trim() : null,
    exactTag: exactTag.ok ? exactTag.stdout.trim() : null,
    branch: branch.ok ? branch.stdout.trim() : null,
    origin: remote.ok ? sanitizeUrl(remote.stdout.trim()) : null,
    dirty: status.ok ? changes.length > 0 : null,
    statusFingerprint: status.ok ? sha256(status.stdout) : null,
    changes: changes.slice(0, 5000).map((entry) => ({
      status: entry.status,
      path: aliasPath(path.join(rootDir, entry.path)),
      ...(entry.originalPath ? { originalPath: aliasPath(path.join(rootDir, entry.originalPath)) } : {}),
    })),
    truncated: changes.length > 5000,
    gaps: [head, status]
      .filter((entry) => !entry.ok)
      .map((entry) => ({ code: "git-inspection-failed", message: entry.error })),
  };
}
