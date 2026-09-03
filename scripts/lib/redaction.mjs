import crypto from "node:crypto";
import { fromJsonPointer, sha256, toJsonPointer } from "./util.mjs";

const SECRET_SEGMENT = /token|secret|password|passwd|credential|private[-_]?key|api[-_]?key|client[-_]?secret|cookie|bearer|session[-_]?key/iu;
const PRIVATE_SEGMENT = /(?:^|[-_])(email|phone|sender|recipient|chat|group|room|account|user|username|workspace|path|file|directory|url|hostname|identity)(?:$|[-_])/iu;
const SAFE_EXACT_LEAF = new Set([
  "enabled",
  "disabled",
  "mode",
  "type",
  "level",
  "scope",
  "strategy",
  "policy",
  "backend",
  "provider",
  "model",
  "format",
  "bind",
  "port",
  "concurrency",
  "timezone",
  "releaseChannel",
  "hostFallbackMode",
  "skipStatelessSessions",
  "promptAwareEviction",
  "stubLargeToolPayloads",
  "cacheAwareCompaction",
]);
const SAFE_OPERATIONAL_SUFFIX = /(?:Ms|Seconds|Minutes|Hours|Bytes|Tokens|Count|Limit|Depth|Threshold|Ratio|Factor|Retries|Attempts|Concurrency|Window|Port|TTL)$/u;
const DYNAMIC_PARENT = new Set([
  "accounts",
  "users",
  "groups",
  "rooms",
  "chats",
  "senders",
  "recipients",
  "bindings",
  "identities",
]);
const CREDENTIAL_SHAPE = /^(?:sk-|ghp_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9_\-+/=]{8,}$/u;
const SAFE_CLEAR_TOKEN = /^[A-Za-z0-9@._/:+\-]{1,128}$/u;
const SAFE_POINTER_SEGMENT = /^[A-Za-z0-9@$._:+*\-]{1,128}$/u;
const SAFE_REDACTION_MARKER = /^\$(?:id-(?:\d{4}|redacted)|key-redacted(?:-\d{3})?)$/u;

function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function isSecretScalar(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (CREDENTIAL_SHAPE.test(value)) return true;
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value)) return true;
  if (/^(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$/u.test(value)) return true;
  if (/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/iu.test(value)) return true;
  if (/(?:token|secret|password|passwd|api[_-]?key|credential)=([^&\s]{4,})/iu.test(value)) return true;
  try {
    const parsed = new URL(value.replace(/^git\+/u, ""));
    if (parsed.username || parsed.password) return true;
    for (const key of parsed.searchParams.keys()) if (SECRET_SEGMENT.test(key)) return true;
  } catch {
    // Not a URL.
  }
  return value.length >= 24 && /^[A-Za-z0-9_+/=-]+$/u.test(value) && entropy(value) >= 3.5;
}

function scalarType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function nearestNamedSegment(parts) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!/^\d+$/u.test(parts[index])) return parts[index];
  }
  return "";
}

function isSecretPath(parts) {
  return parts.some((part) => SECRET_SEGMENT.test(part));
}

function isPrivatePath(parts) {
  return parts.some((part) => PRIVATE_SEGMENT.test(part));
}

function isAllowlisted(parts, value) {
  const pointer = toJsonPointer(parts);
  if (/^\/plugins\/(?:allow|deny)\//u.test(pointer)) return typeof value === "string";
  if (/^\/plugins\/entries\/[^/]+\/(?:enabled|mode)$/u.test(pointer)) return true;
  if (/^\/gateway\/(?:mode|bind|port)$/u.test(pointer)) return true;
  const leaf = nearestNamedSegment(parts);
  if (SAFE_EXACT_LEAF.has(leaf)) return true;
  if (SAFE_OPERATIONAL_SUFFIX.test(leaf)) return typeof value === "number" || typeof value === "boolean";
  return false;
}

function lengthBucket(value) {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return "empty";
  if (value.length <= 8) return "1-8";
  if (value.length <= 32) return "9-32";
  if (value.length <= 128) return "33-128";
  return "129+";
}

function safeClearValue(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 128) return `${value.slice(0, 125)}...`;
  return value;
}

function isSafeClearScalar(value) {
  if (typeof value === "string") return SAFE_CLEAR_TOKEN.test(value) && !isSecretScalar(value);
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean" || value === null;
}

function privateIdentifierAlias(context, value) {
  context.identifierAliases ??= new Map();
  if (!context.identifierAliases.has(value)) {
    context.identifierAliases.set(value, `$id-${String(context.identifierAliases.size + 1).padStart(4, "0")}`);
  }
  return context.identifierAliases.get(value);
}

function isDirectPrivateIdentifier(part) {
  return part.includes("@") ||
    /^-?\d{10,}$/u.test(part) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(part);
}

function isSecretPointerIdentity(part) {
  if (CREDENTIAL_SHAPE.test(part)) return true;
  if (/^(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$/u.test(part)) return true;
  if (/^(?:bearer|basic)[._~+\-/=][A-Za-z0-9._~+\-/=]{11,}$/iu.test(part)) return true;
  if (/(?:token|secret|password|passwd|api[_-]?key|credential)=([^&\s]{4,})/iu.test(part)) return true;
  // Pointer tokens normally name fields, so the scalar secret heuristic is too
  // broad here: legitimate names such as hotCacheBudgetHeadroomRatio have high
  // entropy. Retain field identity and reserve this fallback for long opaque IDs.
  return part.length >= 48 && /^[A-Za-z0-9_+/=-]+$/u.test(part) && entropy(part) >= 4;
}

function maskDynamicParts(parts, context) {
  return parts.map((part, index) => {
    if (SAFE_REDACTION_MARKER.test(part)) return part;
    if (isSecretPointerIdentity(part)) return "$id-redacted";
    if ((index > 0 && DYNAMIC_PARENT.has(parts[index - 1])) || isDirectPrivateIdentifier(part)) {
      return privateIdentifierAlias(context, part);
    }
    return SAFE_POINTER_SEGMENT.test(part) ? part : "$key-redacted";
  });
}

export function createDisclosureContext(testSeed) {
  const hmacKey = testSeed === undefined
    ? crypto.randomBytes(32)
    : crypto.createHash("sha256").update(`openclaw-drift-audit-test-only\0${testSeed}`).digest();
  return { hmacKey, metadataOnly: false, identifierAliases: new Map() };
}

export function sanitizeJsonPointer(pointer, context = createDisclosureContext()) {
  if (typeof pointer !== "string") throw new TypeError("JSON Pointer must be a string");
  return toJsonPointer(maskDynamicParts(fromJsonPointer(pointer), context));
}

function opaqueFingerprint(context, value) {
  return crypto
    .createHmac("sha256", context.hmacKey)
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

export function discloseConfigEntries(root, provenanceForPointer = () => [], context = createDisclosureContext()) {
  const entries = [];

  function visit(value, parts) {
    const type = scalarType(value);
    const safeParts = maskDynamicParts(parts, context);
    const pointer = toJsonPointer(safeParts);
    if (type === "object") {
      entries.push({ pointer, type, keys: Object.keys(value).length, sources: provenanceForPointer(parts) });
      for (const key of Object.keys(value).sort()) visit(value[key], [...parts, key]);
      return;
    }
    if (type === "array") {
      entries.push({ pointer, type, items: value.length, sources: provenanceForPointer(parts) });
      value.forEach((entry, index) => visit(entry, [...parts, String(index)]));
      return;
    }

    const secret = isSecretPath(parts) || isSecretScalar(value);
    const allowlisted =
      !context.metadataOnly &&
      !secret &&
      !isPrivatePath(parts) &&
      isAllowlisted(parts, value) &&
      isSafeClearScalar(value);
    const base = { pointer, type, sources: provenanceForPointer(parts) };
    if (allowlisted) {
      entries.push({ ...base, disclosure: "clear", value: safeClearValue(value) });
      return;
    }
    entries.push({
      ...base,
      disclosure: secret ? "redacted-secret" : "redacted-private",
      present: value !== null && value !== "",
      ...(typeof value === "string" ? { lengthBucket: lengthBucket(value) } : {}),
      ...(secret ? {} : { opaqueFingerprint: opaqueFingerprint(context, value) }),
    });
  }

  visit(root, []);
  return entries;
}

export function collectConfiguredPluginIds(config) {
  const ids = new Set();
  const entries = config?.plugins?.entries;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    for (const id of Object.keys(entries)) ids.add(id);
  }
  for (const key of ["allow", "deny"]) {
    const values = config?.plugins?.[key];
    if (Array.isArray(values)) {
      for (const value of values) if (typeof value === "string" && value.length > 0) ids.add(value);
    }
  }
  const channels = config?.channels;
  if (channels && typeof channels === "object" && !Array.isArray(channels)) {
    for (const id of Object.keys(channels)) ids.add(id);
  }
  return [...ids].sort();
}

export function normalizeSchemaConstraints(schema, context = createDisclosureContext()) {
  const constraints = [];
  const seen = new Set();

  function visit(node, parts) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = { pointer: toJsonPointer(maskDynamicParts(parts, context)) };
    if (typeof node.type === "string" && new Set(["null", "boolean", "object", "array", "number", "integer", "string"]).has(node.type)) {
      record.type = node.type;
    }
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]) {
      const value = node[key];
      if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
    }
    if (typeof node.deprecated === "boolean") record.deprecated = node.deprecated;
    if (Array.isArray(node.required)) {
      record.required = node.required
        .filter((value) => typeof value === "string")
        .map((value) => SAFE_POINTER_SEGMENT.test(value) ? value : "$key-redacted")
        .sort();
    }
    if (Array.isArray(node.enum) && node.enum.length <= 100) {
      record.enum = node.enum.map((value) => {
        if (typeof value === "string" && (isSecretPath(parts) || isSecretScalar(value))) {
          return { disclosure: "redacted-secret" };
        }
        return isSafeClearScalar(value) ? safeClearValue(value) : { disclosure: "redacted" };
      });
    }
    if (Object.hasOwn(node, "default")) {
      if (isSecretPath(parts) || isSecretScalar(node.default)) record.default = { disclosure: "redacted-secret" };
      else if (isAllowlisted(parts, node.default) && isSafeClearScalar(node.default)) {
        record.default = safeClearValue(node.default);
      }
      else if (node.default === null || ["string", "number", "boolean"].includes(typeof node.default)) {
        record.default = { disclosure: "redacted", opaqueFingerprint: opaqueFingerprint(context, node.default) };
      } else {
        record.default = { disclosure: "redacted" };
      }
    }
    if (Object.keys(record).length > 1) constraints.push(record);
    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties).sort()) visit(node.properties[key], [...parts, key]);
    }
    if (node.items) visit(node.items, [...parts, "*"]);
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(node[keyword])) node[keyword].forEach((entry) => visit(entry, parts));
    }
  }

  visit(schema, []);
  return constraints;
}
