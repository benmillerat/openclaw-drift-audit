#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, sha256, stableStringify } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2), { root: { type: "string" } });
const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = fs.realpathSync(args.root ? path.resolve(args.root) : defaultRoot);
const MAX_FILES = 4096;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const files = [];
let totalBytes = 0;

function visit(directory, prefix = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (new Set([".git", "node_modules"]).has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill fingerprint refuses symlink: ${relative}`);
    if (entry.isDirectory()) {
      visit(absolute, relative);
      continue;
    }
    if (!entry.isFile()) continue;
    if (files.length >= MAX_FILES) throw new Error(`Skill file budget exceeded: ${MAX_FILES}`);
    const content = fs.readFileSync(absolute);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Skill byte budget exceeded: ${MAX_TOTAL_BYTES}`);
    files.push({ path: relative, bytes: content.byteLength, sha256: sha256(content) });
  }
}

visit(root);
const canonicalFiles = stableStringify(files, 0);
process.stdout.write(`${stableStringify({
  kind: "openclaw-drift-skill-fingerprint",
  algorithm: "sha256-tree-v1",
  fileCount: files.length,
  totalBytes,
  sha256: sha256(canonicalFiles),
  files,
})}\n`);
