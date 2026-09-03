import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.dirname(here);
const fixtures = path.join(here, "fixtures");

async function runPipeline(stages, input) {
  const children = stages.map((argv) => spawn(process.execPath, argv, {
    stdio: ["pipe", "pipe", "pipe"],
  }));
  for (let index = 0; index < children.length - 1; index += 1) {
    children[index].stdout.pipe(children[index + 1].stdin);
  }

  const output = [];
  children.at(-1).stdout.on("data", (chunk) => output.push(chunk));
  const errors = children.map(() => []);
  children.forEach((child, index) => child.stderr.on("data", (chunk) => errors[index].push(chunk)));
  if (input === undefined) children[0].stdin.end();
  else children[0].stdin.end(input);

  const codes = await Promise.all(children.map((child) => new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  })));
  return {
    codes,
    output: Buffer.concat(output).toString("utf8"),
    errors: errors.map((chunks) => Buffer.concat(chunks).toString("utf8")),
  };
}

test("collector streams into the role-slice bundle over an asynchronous pipe", async () => {
  const result = await runPipeline([
    [
      path.join(scriptsDir, "collect-evidence.mjs"),
      "--state-dir", path.join(fixtures, "include-config"),
      "--config", path.join(fixtures, "include-config", "openclaw.json"),
      "--package-root", path.join(fixtures, "v2026.8.2"),
      "--run-id", "pipeline-fixture",
      "--started-at", "2026-09-03T00:00:00.000Z",
    ],
    [path.join(scriptsDir, "slice-evidence.mjs"), "--bundle"],
  ]);
  assert.deepEqual(result.codes, [0, 0], result.errors.join("\n"));
  const bundle = JSON.parse(result.output);
  assert.equal(bundle.kind, "openclaw-drift-evidence-slice-bundle");
  assert.equal(bundle.slices.length, 4);
});

test("finalizer streams canonical JSON into the renderer over asynchronous pipes", async () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(fixtures, "export-evidence.json"), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(fixtures, "export-analysis.json"), "utf8"));
  const result = await runPipeline([
    [path.join(scriptsDir, "finalize-audit.mjs")],
    [path.join(scriptsDir, "render-report.mjs")],
  ], JSON.stringify({ evidence, analysis }));
  assert.deepEqual(result.codes, [0, 0], result.errors.join("\n"));
  assert.ok(result.output.startsWith("# OpenClaw Drift Audit"));
});
