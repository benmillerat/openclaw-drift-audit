import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const AUDIT_SCHEMA_VERSION = "0.1.1";

const schemaPath = fileURLToPath(new URL("../../references/audit-schema-0.1.json", import.meta.url));
export const auditSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

function typeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  return typeof value === expected;
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported schema reference ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .reduce((node, part) => node?.[part], rootSchema);
}

function validateNode(value, schema, rootSchema, location, errors) {
  if (schema.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`${location}: unresolved schema reference ${schema.$ref}`);
      return;
    }
    validateNode(value, resolved, rootSchema, location, errors);
    return;
  }

  for (const clause of schema.allOf ?? []) validateNode(value, clause, rootSchema, location, errors);
  if (schema.anyOf) {
    const matched = schema.anyOf.some((clause) => {
      const branchErrors = [];
      validateNode(value, clause, rootSchema, location, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matched) errors.push(`${location}: value does not match any allowed schema`);
  }
  if (schema.if) {
    const conditionErrors = [];
    validateNode(value, schema.if, rootSchema, location, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) validateNode(value, schema.then, rootSchema, location, errors);
    if (conditionErrors.length > 0 && schema.else) validateNode(value, schema.else, rootSchema, location, errors);
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    errors.push(`${location}: expected constant ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${location}: value is not in the allowed enum`);
    return;
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => typeMatches(value, expected))) {
      errors.push(`${location}: expected ${expectedTypes.join(" or ")}`);
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: string is shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, "u")).test(value)) {
      errors.push(`${location}: string does not match required pattern`);
    }
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) {
      errors.push(`${location}: invalid date-time`);
    }
  }

  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${location}: number is below minimum ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: array has fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${location}: array items must be unique`);
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${location}[${index}]`, errors));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key}: required field is missing`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(child, properties[key], rootSchema, `${location}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}.${key}: additional property is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(child, schema.additionalProperties, rootSchema, `${location}.${key}`, errors);
      }
    }
  }
}

export function validateAudit(value) {
  const errors = [];
  validateNode(value, auditSchema, auditSchema, "audit", errors);
  return errors;
}

export function assertValidAudit(value) {
  const errors = validateAudit(value);
  if (errors.length > 0) {
    throw new Error(`Canonical audit schema validation failed:\n${errors.slice(0, 20).join("\n")}`);
  }
}

const POINTER_VALUE_FIELDS = new Set(["surface", "targetSurface", "pointer"]);

function hasPrivatePointerIdentity(value, key) {
  if (!POINTER_VALUE_FIELDS.has(key)) return false;
  if (key !== "pointer" && !value.startsWith("/")) return false;
  return value.split("/").some((segment) =>
    segment.includes("@") || /^-?\d{10,}$/u.test(segment)
  );
}

function hasAbsoluteLocalPath(value, key) {
  if (/file:\/{1,3}(?:[A-Za-z]:[\\/]|\/)/iu.test(value)) return true;
  if (/(?:^|[\s"'(=\[{,])[A-Za-z]:[\\/][^\s"'<>]*/u.test(value)) return true;
  if (/(?:^|[\s"'(=\[{,])\\\\[^\\\s"'<>]+\\[^\s"'<>]*/u.test(value)) return true;
  if (POINTER_VALUE_FIELDS.has(key) && value.startsWith("/") && !/[\s"'(=\[{,]\/(?!\/)/u.test(value)) {
    return false;
  }
  return /(?:^|[\s"'(=\[{,])\/(?!\/)[^\s"'<>]*/u.test(value);
}

export function assertPortableAuditData(value) {
  function walk(node, parts = []) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, [...parts, String(index)]));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, entry] of Object.entries(node)) {
        if (hasAbsoluteLocalPath(key, "")) {
          throw new Error(`Absolute local path detected in export key ${[...parts, key].join(".")}`);
        }
        walk(entry, [...parts, key]);
      }
      return;
    }
    if (typeof node !== "string") return;
    const key = parts.at(-1) || "";
    if (/token|secret|password|passwd|credential|private[-_]?key|api[-_]?key|client[-_]?secret|cookie|bearer/iu.test(key)) {
      if (!/^(?:\$REDACTED|redacted|present|absent|unknown|null)$/iu.test(node)) {
        throw new Error(`Possible secret value in exported field ${parts.join(".")}`);
      }
    }
    if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(node)) throw new Error("PEM private key detected in export");
    if (/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/u.test(node)) {
      throw new Error("Credential-like token detected in export");
    }
    if (hasPrivatePointerIdentity(node, key)) {
      throw new Error(`Private identity-like segment detected in export field ${parts.join(".")}`);
    }
    if (hasAbsoluteLocalPath(node, key)) {
      throw new Error(`Absolute local path detected in export field ${parts.join(".")}`);
    }
    try {
      const parsed = new URL(node.replace(/^git\+/u, ""));
      if (parsed.username || parsed.password) throw new Error("Credential-bearing URL detected in export");
      for (const queryKey of parsed.searchParams.keys()) {
        if (/token|secret|password|passwd|credential|api[-_]?key/iu.test(queryKey)) {
          throw new Error("Secret-bearing URL query detected in export");
        }
      }
    } catch (error) {
      if (error instanceof TypeError) return;
      throw error;
    }
  }
  walk(value);
}
