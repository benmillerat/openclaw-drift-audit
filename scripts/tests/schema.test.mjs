import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

test("public preview schema is valid JSON and preserves the canonical identity split", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "references", "audit-schema-0.1.json"), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "urn:openclaw-drift-audit:schema:0.1.1");
  assert.equal(schema.properties.schemaVersion.const, "0.1.1");
  assert.equal(schema.properties.kind.const, "openclaw-drift-audit");
  assert.equal(schema.additionalProperties, false);
  for (const key of ["run", "export", "operatingContext", "rules", "observations", "findings", "repairHandoffs"]) {
    assert.ok(schema.required.includes(key));
  }
  for (const key of [
    "run", "export", "target", "operatingContext", "source", "baseline", "observation", "finding", "repairHandoff",
    "configurationSummary", "dependencyAudit", "sourceState", "pluginEvidence", "consistencyRecord",
  ]) {
    assert.equal(schema.$defs[key].additionalProperties, false, `${key} must be a closed output object`);
  }
  assert.ok(schema.$defs.observation.required.includes("ruleId"));
  for (const key of ["key", "componentVersion", "effectiveScope", "configurationLayer", "timePerspective", "lifecycleState", "downstreamExposure", "repairSideEffects"]) {
    assert.ok(schema.$defs.finding.required.includes(key));
  }
  assert.equal(schema.$defs.export.properties.mode.const, "portable-redacted");
  assert.equal(schema.$defs.export.properties.localPathExportSupported.const, false);
  assert.deepEqual(schema.$defs.dependencyLock.properties.hasIntegrity.type, ["boolean", "null"]);
  assert.equal(schema.$defs.baseline.properties.sourceIds.minItems, undefined);
  assert.ok(schema.$defs.baseline.allOf.length > 0);
  assert.deepEqual(schema.$defs.repairHandoff.properties.executable, { const: false });
});
