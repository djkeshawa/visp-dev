#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import { runConformance, verifyConformanceReport } from "../src/conformance.mjs";

const argv = process.argv.slice(2);
const verifyIndex = argv.indexOf("--verify");
const outputIndex = argv.indexOf("--output");

/**
 * `--verify` with no path verifies the committed report. Requiring a path made
 * the packaged `conformance:verify` script fail on its own arguments, which is
 * how a verifier stays broken: nothing ever runs it.
 */
const COMMITTED_REPORT = new URL(
  "../evidence/conformance-linux-x64-node24.json",
  import.meta.url
);

try {
  const report =
    verifyIndex !== -1
      ? await (async () => {
          const target = argv[verifyIndex + 1] ?? COMMITTED_REPORT;
          const parsed = JSON.parse(await readFile(target, "utf8"));
          verifyConformanceReport(parsed);
          return parsed;
        })()
      : await runConformance();

  if (verifyIndex === -1 && outputIndex !== -1) {
    await writeFile(argv[outputIndex + 1], canonicalStringify(report), { flag: "w", mode: 0o644 });
  }

  if (verifyIndex !== -1) {
    const { covered, required, gapIds, knownDefects } = report.summary;

    process.stdout.write(
      `PASS conformance verified: ${covered}/${required} families covered, ` +
        `gaps [${gapIds.join(", ")}], known defects [${knownDefects.join(", ")}]\n`
    );
  } else {
    process.stdout.write(`${canonicalStringify(report)}\n`);
  }
} catch (error) {
  process.stderr.write(`conformance: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
