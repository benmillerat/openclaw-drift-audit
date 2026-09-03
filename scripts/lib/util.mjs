import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value, space = 2) {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = sortValue(value[key]);
  return result;
}

export function safeRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function readTextFile(filePath, maxBytes = 2 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
  if (stat.size > maxBytes) throw new Error(`File exceeds ${maxBytes} bytes: ${filePath}`);
  const before = fingerprintStat(stat);
  const raw = fs.readFileSync(filePath, "utf8");
  const afterStat = fs.statSync(filePath);
  const after = fingerprintStat(afterStat);
  return {
    raw,
    bytes: Buffer.byteLength(raw),
    sha256: sha256(raw),
    before,
    after,
    stable: before.size === after.size && before.mtimeNs === after.mtimeNs && before.ino === after.ino,
  };
}

export async function readStdinUtf8(maxBytes = 256 * 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) throw new Error(`Standard input exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export function fingerprintFile(filePath, maxBytes = 64 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    if (!stat.isFile()) return { exists: true, type: "other", ...fingerprintStat(stat) };
    if (stat.size > BigInt(maxBytes)) {
      return { exists: true, type: "file", ...fingerprintStat(stat), sha256: null, oversized: true };
    }
    const buffer = fs.readFileSync(filePath);
    const after = fs.statSync(filePath, { bigint: true });
    return {
      exists: true,
      type: "file",
      ...fingerprintStat(after),
      sha256: sha256(buffer),
      stable:
        stat.size === after.size && stat.mtimeNs === after.mtimeNs && stat.ino === after.ino,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") return { exists: false };
    return { exists: null, error: normalizeError(error) };
  }
}

function fingerprintStat(stat) {
  const bigint = typeof stat.size === "bigint";
  const number = (entry) => (typeof entry === "bigint" ? entry.toString() : String(entry ?? ""));
  return {
    size: number(stat.size),
    mtimeNs: bigint ? number(stat.mtimeNs) : String(Math.trunc(stat.mtimeMs * 1e6)),
    ino: number(stat.ino),
    mode: Number(stat.mode).toString(8),
  };
}

export function normalizeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\u0000-\u001F\u007F]/gu, " ").slice(0, 512);
}

export function createPathAliaser(entries = {}) {
  const roots = Object.entries({
    "$TARGET": entries.target,
    "$STATE": entries.state,
    "$CONFIG": entries.config ? path.dirname(entries.config) : undefined,
    "$PACKAGE": entries.packageRoot,
    "$SOURCE": entries.sourceRoot,
    "~": os.homedir(),
  })
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([label, value]) => [label, safeRealpath(value)])
    .sort((left, right) => right[1].length - left[1].length);

  return (candidate) => {
    if (typeof candidate !== "string" || candidate.length === 0) return candidate;
    const absolute = path.isAbsolute(candidate) ? safeRealpath(candidate) : candidate;
    for (const [label, root] of roots) {
      if (absolute === root) return label;
      if (absolute.startsWith(`${root}${path.sep}`)) {
        return `${label}/${absolute.slice(root.length + 1).split(path.sep).join("/")}`;
      }
    }
    return path.isAbsolute(absolute) ? `$ABS/${sha256(absolute).slice(0, 16)}` : absolute;
  };
}

export function sanitizeUrl(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/^git\+/u, "");
  try {
    const parsed = new URL(normalized);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    const safeProtocols = new Set(["https:", "http:", "ssh:"]);
    if (!safeProtocols.has(parsed.protocol)) return `${parsed.protocol}//$REDACTED`;
    return parsed.toString();
  } catch {
    if (/^(?:git@|ssh:)/u.test(normalized)) return "$REDACTED_SSH_REMOTE";
    return null;
  }
}

export function parseArgs(argv, specification) {
  const result = { _: [] };
  for (const [name, value] of Object.entries(specification)) {
    result[name] = value.multiple ? [] : value.default;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const [rawName, inline] = token.slice(2).split(/=(.*)/su, 2);
    const config = specification[rawName];
    if (!config) throw new Error(`Unknown option --${rawName}`);
    if (config.type === "boolean") {
      if (inline !== undefined && inline !== "") {
        if (!new Set(["true", "false"]).has(inline)) throw new Error(`Invalid boolean for --${rawName}`);
        result[rawName] = inline === "true";
      } else {
        result[rawName] = true;
      }
      continue;
    }
    const value = inline !== undefined && inline !== "" ? inline : argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${rawName}`);
    if (config.multiple) result[rawName].push(value);
    else result[rawName] = value;
  }
  return result;
}

export function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${stableStringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export function canonicalWritePath(filePath) {
  const absolute = path.resolve(filePath);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink output path: ${absolute}`);
    if (stat.isDirectory()) throw new Error(`Output path is a directory: ${absolute}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const missing = [];
  let cursor = path.dirname(absolute);
  while (!pathExists(cursor)) {
    missing.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const canonicalParent = path.join(safeRealpath(cursor), ...missing);
  return path.join(canonicalParent, path.basename(absolute));
}

export function writeTextAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export function toJsonPointer(parts) {
  if (parts.length === 0) return "";
  return `/${parts.map((part) => String(part).replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`;
}

export function fromJsonPointer(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}
