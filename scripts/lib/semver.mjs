const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function parseVersion(input) {
  if (typeof input !== "string") return null;
  const match = input.trim().match(VERSION_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".").map(parseIdentifier) : [],
    raw: input,
  };
}

function parseIdentifier(value) {
  return /^\d+$/u.test(value) ? Number(value) : value;
}

export function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b !== "number") return -1;
    if (typeof a !== "number" && typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function comparator(operator, boundary) {
  return (version) => {
    const comparison = compareVersions(version, boundary);
    if (operator === ">") return comparison > 0;
    if (operator === ">=") return comparison >= 0;
    if (operator === "<") return comparison < 0;
    if (operator === "<=") return comparison <= 0;
    return comparison === 0;
  };
}

function parseLooseParts(value) {
  const cleaned = value.trim().replace(/^v/u, "");
  const [core, prerelease = ""] = cleaned.split("-", 2);
  const parts = core.split(".");
  if (parts.length > 3 || parts.some((part) => !/^(?:\d+|x|X|\*)$/u.test(part))) return null;
  return { parts, prerelease };
}

function expandBareRange(token) {
  const parsed = parseLooseParts(token);
  if (!parsed) return null;
  const wildcardIndex = parsed.parts.findIndex((part) => /^(?:x|X|\*)$/u.test(part));
  const specified = wildcardIndex === -1 ? parsed.parts.length : wildcardIndex;
  if (specified === 3 && parsed.parts.length === 3) {
    const exact = parseVersion(`${parsed.parts.join(".")}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`);
    return exact ? [comparator("=", exact)] : null;
  }
  const numbers = [0, 0, 0];
  for (let index = 0; index < specified; index += 1) numbers[index] = Number(parsed.parts[index]);
  const lower = parseVersion(numbers.join("."));
  if (specified === 0) return [() => true];
  const upperParts = [...numbers];
  if (specified === 1) upperParts[0] += 1;
  else upperParts[1] += 1;
  for (let index = specified; index < 3; index += 1) upperParts[index] = 0;
  const upper = parseVersion(upperParts.join("."));
  return [comparator(">=", lower), comparator("<", upper)];
}

function expandToken(token) {
  if (token === "" || token === "*" || /^x$/iu.test(token)) return [() => true];
  const caret = token.match(/^\^(.+)$/u);
  if (caret) {
    const base = parseVersion(normalizeFullVersion(caret[1]));
    if (!base) return null;
    let upper;
    if (base.major > 0) upper = { ...base, major: base.major + 1, minor: 0, patch: 0, prerelease: [] };
    else if (base.minor > 0) upper = { ...base, minor: base.minor + 1, patch: 0, prerelease: [] };
    else upper = { ...base, patch: base.patch + 1, prerelease: [] };
    return [comparator(">=", base), comparator("<", upper)];
  }
  const tilde = token.match(/^~(.+)$/u);
  if (tilde) {
    const normalized = normalizeFullVersion(tilde[1]);
    const base = parseVersion(normalized);
    if (!base) return null;
    const rawParts = tilde[1].split("-")[0].split(".").length;
    const upper = rawParts === 1
      ? { ...base, major: base.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { ...base, minor: base.minor + 1, patch: 0, prerelease: [] };
    return [comparator(">=", base), comparator("<", upper)];
  }
  const comparison = token.match(/^(>=|<=|>|<|=)?(.+)$/u);
  if (comparison && comparison[1]) {
    const boundary = parseVersion(normalizeFullVersion(comparison[2]));
    return boundary ? [comparator(comparison[1], boundary)] : null;
  }
  return expandBareRange(token);
}

function normalizeFullVersion(value) {
  const [core, prerelease] = value.split("-", 2);
  const parts = core.split(".");
  while (parts.length < 3) parts.push("0");
  return `${parts.join(".")}${prerelease ? `-${prerelease}` : ""}`;
}

function expandClause(clause) {
  const hyphen = clause.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/u);
  if (hyphen) {
    const lower = parseVersion(normalizeFullVersion(hyphen[1]));
    const upper = parseVersion(normalizeFullVersion(hyphen[2]));
    return lower && upper ? [comparator(">=", lower), comparator("<=", upper)] : null;
  }
  const tokens = clause.trim().split(/\s+/u).filter(Boolean);
  const predicates = [];
  for (const token of tokens) {
    const expanded = expandToken(token);
    if (!expanded) return null;
    predicates.push(...expanded);
  }
  return predicates;
}

export function satisfiesVersion(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (!version) return { status: "unknown", reason: "unrecognized-installed-version" };
  if (typeof rangeText !== "string" || rangeText.trim() === "") {
    return { status: "unknown", reason: "missing-range" };
  }
  const range = rangeText.trim();
  if (/^(?:workspace|file|link|git|https?|github|npm):/u.test(range)) {
    return { status: "unknown", reason: "non-semver-spec" };
  }
  if (version.prerelease.length > 0 && !range.includes("-")) {
    return { status: "unknown", reason: "prerelease-range-requires-explicit-evidence" };
  }
  const clauses = range.split("||").map((entry) => entry.trim()).filter(Boolean);
  if (clauses.length === 0) return { status: "unknown", reason: "empty-range" };
  let understood = false;
  for (const clause of clauses) {
    const predicates = expandClause(clause);
    if (!predicates) continue;
    understood = true;
    if (predicates.every((predicate) => predicate(version))) return { status: "match" };
  }
  return understood ? { status: "mismatch" } : { status: "unknown", reason: "unsupported-range" };
}
