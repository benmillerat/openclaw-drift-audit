import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfigGraph } from "../lib/includes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "include-config", "openclaw.json");

test("resolves ordered includes and sibling overrides with provenance", () => {
  const result = resolveConfigGraph(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.resolved.gateway.mode, "local");
  assert.equal(result.resolved.gateway.port, 18789);
  assert.deepEqual(result.resolved.list, ["base", "plugin"]);
  assert.equal(result.resolved.agents.defaults.timeoutSeconds, 600);
  assert.equal(result.edges.length, 1);
  assert.equal(result.files.length, 3);
  assert.ok(result.provenance.get("/gateway/port")[0].endsWith("openclaw.json"));
});

test("rejects cycles and paths outside the config root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-includes-"));
  const outside = path.join(path.dirname(directory), `${path.basename(directory)}-outside.json`);
  fs.writeFileSync(path.join(directory, "a.json"), `{ $include: './b.json' }`);
  fs.writeFileSync(path.join(directory, "b.json"), `{ $include: './a.json' }`);
  fs.writeFileSync(outside, "{}");
  const cycle = resolveConfigGraph(path.join(directory, "a.json"));
  assert.equal(cycle.ok, false);
  assert.match(cycle.diagnostics[0].message, /Circular include/u);
  fs.writeFileSync(path.join(directory, "escape.json"), `{ $include: '../${path.basename(outside)}' }`);
  const escaped = resolveConfigGraph(path.join(directory, "escape.json"));
  assert.equal(escaped.ok, false);
  assert.match(escaped.diagnostics[0].message, /escapes configured roots/u);
});

test("enforces include depth, file-size, and realpath containment limits", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-include-limits-"));
  for (let index = 0; index < 12; index += 1) {
    const body = index === 11 ? "{}" : `{ $include: './${index + 1}.json' }`;
    fs.writeFileSync(path.join(directory, `${index}.json`), body);
  }
  const tooDeep = resolveConfigGraph(path.join(directory, "0.json"));
  assert.equal(tooDeep.ok, false);
  assert.match(tooDeep.diagnostics[0].message, /Maximum include depth/u);

  fs.writeFileSync(path.join(directory, "large.json"), `{"value":"${"x".repeat(2 * 1024 * 1024)}"}`);
  const tooLarge = resolveConfigGraph(path.join(directory, "large.json"));
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.diagnostics[0].message, /File exceeds/u);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-include-outside-"));
  fs.writeFileSync(path.join(outside, "data.json"), "{ safe: true }");
  fs.symlinkSync(path.join(outside, "data.json"), path.join(directory, "linked.json"));
  fs.writeFileSync(path.join(directory, "symlink-root.json"), "{ $include: './linked.json' }");
  const linked = resolveConfigGraph(path.join(directory, "symlink-root.json"));
  assert.equal(linked.ok, false);
  assert.match(linked.diagnostics[0].message, /escapes configured roots/u);
});

test("accepts an explicitly allowlisted external include root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-include-root-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-external-root-"));
  const externalFile = path.join(external, "shared.json");
  fs.writeFileSync(externalFile, "{ gateway: { bind: 'loopback' } }");
  fs.writeFileSync(path.join(directory, "openclaw.json"), `{ $include: '${externalFile}' }`);
  const result = resolveConfigGraph(path.join(directory, "openclaw.json"), { allowedRoots: [external] });
  assert.equal(result.ok, true);
  assert.equal(result.resolved.gateway.bind, "loopback");
});
