#!/usr/bin/env node
// Parses every .mjs under src/ and scripts/. Replaces a hand-written list of
// ~80 `node --check` calls that silently skipped any file nobody remembered to
// add to it.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROOTS = ["src", "scripts"];
const SKIP = new Set(["node_modules", ".git", ".scratch"]);

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith(".mjs")) yield path;
  }
}

const failures = [];
let checked = 0;

for (const root of ROOTS) {
  for await (const file of sourceFiles(join(ROOT, root))) {
    checked += 1;
    try {
      await run(process.execPath, ["--check", file]);
    } catch (error) {
      failures.push({ file: relative(ROOT, file), detail: error.stderr?.trim() ?? String(error) });
    }
  }
}

for (const failure of failures) {
  process.stderr.write(`${failure.file}\n${failure.detail}\n\n`);
}

process.stdout.write(
  failures.length === 0
    ? `syntax: ${checked} files parsed\n`
    : `syntax: ${failures.length} of ${checked} files failed to parse\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
