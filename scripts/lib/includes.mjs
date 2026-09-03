import fs from "node:fs";
import path from "node:path";
import { parseJson5 } from "./json5.mjs";
import { isInside, normalizeError, readTextFile, safeRealpath, toJsonPointer } from "./util.mjs";

export const MAX_INCLUDE_DEPTH = 10;
export const MAX_INCLUDE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INCLUDE_PATH_LENGTH = 4096;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function sourceNode(value, sourcePath) {
  if (Array.isArray(value)) {
    return { kind: "array", items: value.map((entry) => sourceNode(entry, sourcePath)), sources: [sourcePath] };
  }
  if (isPlainObject(value)) {
    const entries = Object.create(null);
    for (const key of Object.keys(value)) entries[key] = sourceNode(value[key], sourcePath);
    return { kind: "object", entries, sources: [sourcePath] };
  }
  return { kind: "scalar", value, sources: [sourcePath] };
}

function mergeSources(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function mergeNodes(base, override) {
  if (base?.kind === "array" && override?.kind === "array") {
    return {
      kind: "array",
      items: [...base.items, ...override.items],
      sources: mergeSources(base.sources, override.sources),
    };
  }
  if (base?.kind === "object" && override?.kind === "object") {
    const entries = Object.create(null);
    for (const key of Object.keys(base.entries)) entries[key] = base.entries[key];
    for (const key of Object.keys(override.entries)) {
      entries[key] = Object.hasOwn(entries, key)
        ? mergeNodes(entries[key], override.entries[key])
        : override.entries[key];
    }
    return {
      kind: "object",
      entries,
      sources: mergeSources(base.sources, override.sources),
    };
  }
  return override;
}

function unwrap(node) {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.items.map(unwrap);
  const result = Object.create(null);
  for (const key of Object.keys(node.entries)) result[key] = unwrap(node.entries[key]);
  return result;
}

function collectProvenance(node, parts = [], map = new Map()) {
  map.set(toJsonPointer(parts), node.sources ?? []);
  if (node.kind === "array") {
    node.items.forEach((entry, index) => collectProvenance(entry, [...parts, String(index)], map));
  } else if (node.kind === "object") {
    for (const key of Object.keys(node.entries)) collectProvenance(node.entries[key], [...parts, key], map);
  }
  return map;
}

export function resolveConfigGraph(configPath, options = {}) {
  const absoluteConfig = path.resolve(configPath);
  const configRoot = path.dirname(absoluteConfig);
  const roots = [configRoot, ...(options.allowedRoots ?? [])]
    .filter((entry) => typeof entry === "string" && path.isAbsolute(entry))
    .map((entry) => ({ lexical: path.normalize(entry), real: safeRealpath(entry) }));
  const files = new Map();
  const edges = [];
  const diagnostics = [];

  function selectRoot(candidate) {
    const lexical = path.normalize(candidate);
    const lexicalRoot = roots.find((root) => isInside(root.lexical, lexical));
    if (!lexicalRoot) return null;
    let real;
    try {
      real = fs.realpathSync(lexical);
    } catch (error) {
      if (error?.code === "ENOENT") return { lexical, real: lexical, root: lexicalRoot };
      throw error;
    }
    const realRoot = roots.find((root) => isInside(root.real, real));
    return realRoot ? { lexical, real, root: realRoot } : null;
  }

  function readAndParse(filePath) {
    const result = readTextFile(filePath, MAX_INCLUDE_FILE_BYTES);
    files.set(filePath, {
      path: filePath,
      bytes: result.bytes,
      sha256: result.sha256,
      stable: result.stable,
      before: result.before,
      after: result.after,
    });
    return parseJson5(result.raw);
  }

  function resolvePath(reference, includingFile) {
    if (reference.includes("\0")) throw new Error("Include path contains a null byte");
    if (reference.length >= MAX_INCLUDE_PATH_LENGTH) throw new Error("Include path is too long");
    const candidate = path.isAbsolute(reference)
      ? path.normalize(reference)
      : path.resolve(path.dirname(includingFile), reference);
    if (candidate.length >= MAX_INCLUDE_PATH_LENGTH) throw new Error("Resolved include path is too long");
    const selected = selectRoot(candidate);
    if (!selected) throw new Error(`Include path escapes configured roots: ${reference}`);
    return selected.lexical;
  }

  function process(value, currentFile, logicalParts, stack, depth) {
    if (Array.isArray(value)) {
      return {
        kind: "array",
        items: value.map((entry, index) =>
          process(entry, currentFile, [...logicalParts, String(index)], stack, depth),
        ),
        sources: [currentFile],
      };
    }
    if (!isPlainObject(value)) return sourceNode(value, currentFile);

    if (!Object.hasOwn(value, "$include")) {
      const entries = Object.create(null);
      for (const key of Object.keys(value)) {
        entries[key] = process(value[key], currentFile, [...logicalParts, key], stack, depth);
      }
      return { kind: "object", entries, sources: [currentFile] };
    }

    const references = Array.isArray(value.$include) ? value.$include : [value.$include];
    if (references.length === 0) return sourceNode(Object.create(null), currentFile);
    let included = sourceNode(Object.create(null), currentFile);
    const targets = [];
    for (const reference of references) {
      if (typeof reference !== "string") throw new Error("$include must be a string or string array");
      if (depth >= MAX_INCLUDE_DEPTH) throw new Error(`Maximum include depth ${MAX_INCLUDE_DEPTH} exceeded`);
      const target = resolvePath(reference, currentFile);
      if (stack.includes(target)) throw new Error(`Circular include detected: ${[...stack, target].join(" -> ")}`);
      targets.push(target);
      const parsed = readAndParse(target);
      const resolved = process(parsed, target, logicalParts, [...stack, target], depth + 1);
      included = mergeNodes(included, resolved);
    }

    const siblingKeys = Object.keys(value).filter((key) => key !== "$include");
    edges.push({
      from: currentFile,
      targets,
      pointer: toJsonPointer(logicalParts),
      kind: Array.isArray(value.$include) ? "multiple" : "single",
      hasSiblingOverrides: siblingKeys.length > 0,
    });
    if (siblingKeys.length === 0) return included;
    if (included.kind !== "object") throw new Error("Sibling keys require included content to be an object");
    const siblingEntries = Object.create(null);
    for (const key of siblingKeys) {
      siblingEntries[key] = process(value[key], currentFile, [...logicalParts, key], stack, depth);
    }
    return mergeNodes(included, { kind: "object", entries: siblingEntries, sources: [currentFile] });
  }

  let parsed;
  let resolvedNode;
  try {
    parsed = readAndParse(absoluteConfig);
    resolvedNode = process(parsed, absoluteConfig, [], [absoluteConfig], 0);
  } catch (error) {
    diagnostics.push({ code: "config-resolution-failed", severity: "error", message: normalizeError(error) });
    return {
      ok: false,
      authored: parsed ?? null,
      resolved: null,
      provenance: new Map(),
      files: [...files.values()],
      edges,
      diagnostics,
    };
  }

  return {
    ok: true,
    authored: parsed,
    resolved: unwrap(resolvedNode),
    provenance: collectProvenance(resolvedNode),
    files: [...files.values()],
    edges,
    diagnostics,
  };
}
