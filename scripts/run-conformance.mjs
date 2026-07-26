#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import { runConformance, verifyConformanceReport } from "../src/conformance.mjs";

const argv = process.argv.slice(2);
const verifyIndex = argv.indexOf("--verify");
const outputIndex = argv.indexOf("--output");

try {
  const report =
    verifyIndex !== -1
      ? await (async () => {
          const parsed = JSON.parse(await readFile(argv[verifyIndex + 1], "utf8"));
          verifyConformanceReport(parsed);
          return parsed;
        })()
      : await runConformance();

  if (verifyIndex === -1 && outputIndex !== -1) {
    await writeFile(argv[outputIndex + 1], canonicalStringify(report), { flag: "w", mode: 0o644 });
  }

  process.stdout.write(`${canonicalStringify(report)}\n`);
} catch (error) {
  process.stderr.write(`conformance: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
