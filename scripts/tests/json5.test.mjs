import assert from "node:assert/strict";
import test from "node:test";
import { Json5SyntaxError, parseJson5 } from "../lib/json5.mjs";

test("parses the JSON5 subset used by OpenClaw config", () => {
  const parsed = parseJson5(`{
    // comment
    unquoted: 'value',
    trailing: [1, 0x10, .5,],
    nested: { enabled: true, },
  }`);
  assert.equal(parsed.unquoted, "value");
  assert.deepEqual(parsed.trailing, [1, 16, 0.5]);
  assert.equal(parsed.nested.enabled, true);
  assert.equal(Object.getPrototypeOf(parsed), null);
});

test("does not evaluate expressions", () => {
  assert.throws(() => parseJson5("{ dangerous: process.exit(1) }"), Json5SyntaxError);
});

test("stores prototype-shaped keys as inert own properties", () => {
  const parsed = parseJson5("{ __proto__: { polluted: true }, constructor: 'value' }");
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
});

test("enforces structural resource limits for strict JSON and JSON5", () => {
  assert.throws(() => parseJson5('{"a":{"b":{"c":1}}}', { maxDepth: 2 }), /depth limit/u);
  assert.throws(() => parseJson5("{a: {b: {c: 1}}}", { maxDepth: 2 }), /depth limit/u);
  assert.throws(() => parseJson5('{"value":"abcdef"}', { maxStringLength: 5 }), /string limit/u);
  assert.throws(() => parseJson5("[1, 2, 3]", { maxNodes: 3 }), /node limit/u);
});
