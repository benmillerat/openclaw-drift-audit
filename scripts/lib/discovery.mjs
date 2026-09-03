import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson5 } from "./json5.mjs";
import { normalizeError, pathExists, readTextFile, safeRealpath, sanitizeUrl, sha256 } from "./util.mjs";

function executableNames() {
  if (process.platform !== "win32") return ["openclaw"];
  const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return ["openclaw", ...extensions.map((extension) => `openclaw${extension.toLowerCase()}`)];
}

export function versionPrereleaseClass(version) {
  if (typeof version !== "string" || version.length === 0) return "unknown";
  const separator = version.indexOf("-");
  if (separator === -1) return "stable";
  const prerelease = version.slice(separator + 1).toLowerCase();
  if (/^(?:beta|b)(?:[.-]|$)/u.test(prerelease)) return "beta";
  if (/^(?:rc|release-candidate)(?:[.-]|$)/u.test(prerelease)) return "rc";
  if (/^(?:alpha|a)(?:[.-]|$)/u.test(prerelease)) return "alpha";
  if (/^(?:nightly|dev|canary|next)(?:[.-]|$)/u.test(prerelease)) return "nightly";
  return "prerelease-other";
}

function pathLaunchers(explicit = []) {
  const candidates = new Set(explicit.filter(Boolean).map((entry) => path.resolve(entry)));
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of executableNames()) {
      const candidate = path.join(directory, name);
      if (pathExists(candidate)) candidates.add(candidate);
    }
  }
  return [...candidates].sort();
}

function embeddedAbsolutePaths(filePath) {
  try {
    const { raw } = readTextFile(filePath, 256 * 1024);
    const matches = raw.matchAll(/["'](\/[^"'\r\n]+(?:openclaw\.mjs|dist\/(?:entry|index)\.js|package\.json))["']/gu);
    return [...matches].map((match) => match[1]);
  } catch {
    return [];
  }
}

function findPackageRoot(startPath) {
  let cursor;
  try {
    const resolved = safeRealpath(startPath);
    cursor = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    cursor = path.dirname(path.resolve(startPath));
  }
  for (;;) {
    const packageJsonPath = path.join(cursor, "package.json");
    if (pathExists(packageJsonPath)) {
      try {
        const parsed = parseJson5(readTextFile(packageJsonPath, 4 * 1024 * 1024).raw);
        if (parsed?.name === "openclaw") return cursor;
      } catch {
        // Continue upward; unreadable candidate is recorded by package inspection later.
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function launcherRecord(filePath) {
  const realPath = safeRealpath(filePath);
  const starts = [realPath, ...embeddedAbsolutePaths(realPath)];
  const roots = [...new Set(starts.map(findPackageRoot).filter(Boolean))];
  let kind = "file";
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) kind = "symlink";
    else if (embeddedAbsolutePaths(realPath).length > 0) kind = "wrapper";
  } catch {
    kind = "unreadable";
  }
  return { path: filePath, realPath, kind, packageRoots: roots };
}

function inspectPackageRoot(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  try {
    const packageRead = readTextFile(packageJsonPath, 4 * 1024 * 1024);
    const manifest = parseJson5(packageRead.raw);
    const buildInfoPath = path.join(rootDir, "dist", "build-info.json");
    let buildInfo = null;
    if (pathExists(buildInfoPath)) {
      try {
        const read = readTextFile(buildInfoPath, 1024 * 1024);
        const parsed = parseJson5(read.raw);
        buildInfo = {
          path: buildInfoPath,
          sha256: read.sha256,
          version: typeof parsed?.version === "string" ? parsed.version : null,
          commit: typeof parsed?.commit === "string" ? parsed.commit : null,
          builtAt: typeof parsed?.builtAt === "string" ? parsed.builtAt : null,
        };
      } catch (error) {
        buildInfo = { path: buildInfoPath, error: normalizeError(error) };
      }
    }
    const repository = typeof manifest?.repository === "string"
      ? manifest.repository
      : manifest?.repository?.url;
    return {
      rootDir,
      packageJsonPath,
      packageJsonSha256: packageRead.sha256,
      name: manifest?.name ?? null,
      version: manifest?.version ?? null,
      schemaVersions: manifest?.openclaw?.schemaVersions ?? null,
      repository: sanitizeUrl(repository),
      homepage: sanitizeUrl(manifest?.homepage),
      versionPrereleaseClass: versionPrereleaseClass(manifest?.version),
      installKind: pathExists(path.join(rootDir, ".git"))
        ? "source-checkout"
        : rootDir.includes(`${path.sep}node_modules${path.sep}`)
          ? "node-package"
          : "package-or-bundle",
      lifecycleGuards: [
        path.join(rootDir, ".openclaw-lifecycle-pending"),
        path.join(rootDir, "dist", "openclaw-install-guard"),
      ].filter(pathExists),
      buildInfo,
    };
  } catch (error) {
    return { rootDir, error: normalizeError(error) };
  }
}

function validConfiguredChannel(value) {
  return new Set(["stable", "extended-stable", "beta", "dev"]).has(value) ? value : null;
}

function parseSemanticVersion(value) {
  if (typeof value !== "string") return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value.trim());
  if (!match) return null;
  const numeric = match.slice(1, 4).map(Number);
  if (numeric.some((entry) => !Number.isSafeInteger(entry))) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((entry) => /^\d+$/u.test(entry) && entry.length > 1 && entry.startsWith("0"))) {
    return null;
  }
  return {
    major: numeric[0],
    minor: numeric[1],
    patch: numeric[2],
    prerelease,
    build: match[5]?.split(".") ?? [],
  };
}

function isExtendedStableVersion(version) {
  const parsed = parseSemanticVersion(version);
  return Boolean(
    parsed &&
    parsed.build.length === 0 &&
    parsed.prerelease.length === 0 &&
    parsed.major >= 1000 &&
    parsed.major <= 9999 &&
    parsed.minor >= 1 &&
    parsed.minor <= 12 &&
    parsed.patch >= 33,
  );
}

function isPrereleaseTag(tag) {
  const parsed = parseSemanticVersion(tag);
  if (parsed) return parsed.prerelease.some((part) => !/^\d+$/u.test(part));
  return /(?:^|[.-])(?:alpha|beta|rc|pre|preview|canary|dev|next|nightly|experimental)(?:[.-]|$)/iu.test(tag ?? "");
}

export function resolveEffectiveReleaseChannel({ configChannel, currentVersion, installKind, git }) {
  const configured = validConfiguredChannel(typeof configChannel === "string" ? configChannel.trim().toLowerCase() : null);
  if (configured) return { channel: configured, source: "config" };
  if (/(?:^|[.-])beta(?:[.-]|$)/iu.test(currentVersion ?? "")) {
    return { channel: "beta", source: "installed-version" };
  }
  if (installKind === "package" && isExtendedStableVersion(currentVersion)) {
    return { channel: "extended-stable", source: "installed-version" };
  }
  if (installKind === "git") {
    if (git?.exactTag) {
      return {
        channel: /(?:^|[.-])beta(?:[.-]|$)/iu.test(git.exactTag)
          ? "beta"
          : isPrereleaseTag(git.exactTag)
            ? "dev"
            : "stable",
        source: "git-tag",
      };
    }
    return { channel: "dev", source: git?.branch && git.branch !== "HEAD" ? "git-branch" : "default" };
  }
  return { channel: "stable", source: "default" };
}

export function discoverInstallation(options = {}) {
  const stateSource = options.stateDir
    ? "explicit"
    : process.env.OPENCLAW_STATE_DIR
      ? "environment"
      : "default";
  const stateDir = safeRealpath(options.stateDir || process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw"));
  const configSource = options.configPath
    ? "explicit"
    : process.env.OPENCLAW_CONFIG_PATH
      ? "environment"
      : "state-default";
  const configPath = safeRealpath(options.configPath || process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json"));
  const launchers = pathLaunchers(options.launchers ?? []).map(launcherRecord);
  const packageRoots = new Set(options.packageRoot ? [safeRealpath(options.packageRoot)] : []);
  for (const launcher of launchers) for (const root of launcher.packageRoots) packageRoots.add(root);
  if (options.sourceRoot) packageRoots.add(safeRealpath(options.sourceRoot));
  const packages = [...packageRoots].sort().map(inspectPackageRoot);
  const viable = packages.filter((entry) => entry.name === "openclaw" && entry.version);
  const explicitRoot = options.packageRoot ? safeRealpath(options.packageRoot) : null;
  // A single PATH candidate is not enough to prove that package, config, managed
  // service, running Gateway, and desktop runtime belong to one installation.
  // Preview 0.1 therefore requires an explicit package pin before comparison.
  const selected = explicitRoot
    ? viable.find((entry) => safeRealpath(entry.rootDir) === explicitRoot) ?? null
    : null;
  const status = selected
    ? "selected"
    : explicitRoot
      ? "not-found"
      : viable.length > 0
        ? "needs-selection"
        : "not-found";
  return {
    discoveryVersion: "0.1.0",
    platform: { os: process.platform, arch: process.arch, node: process.version },
    stateDir,
    configPath,
    configExists: pathExists(configPath),
    launchers,
    packages,
    selectedPackageRoot: selected?.rootDir ?? null,
    status,
    selection: {
      packageRootSource: explicitRoot ? "explicit" : "unselected",
      stateDirSource: stateSource,
      configPathSource: configSource,
      assurance: selected ? "user-pinned-static" : "unresolved",
      unresolvedRuntimeIdentities: [
        "managed-service-definition",
        "running-gateway",
        "desktop-runtime",
        "external-workspace-references",
      ],
    },
    candidateFingerprint: sha256(
      JSON.stringify({ stateDir, configPath, launchers: launchers.map((entry) => entry.realPath), roots: [...packageRoots] }),
    ),
  };
}
