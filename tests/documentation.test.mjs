import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPATIBILITY_MATRIX_ROWS,
  DELIBERATELY_UNSUPPORTED_CASES,
} from "../src/compatibility-matrix.mjs";
import { PHASE_3_COMPATIBILITY_DEFINITION } from "../src/phase-3-compatibility.mjs";
import { PHASE_4_COMPATIBILITY_DEFINITION } from "../src/phase-4-compatibility.mjs";

test("public compatibility documentation matches the frozen exact-pair matrix", async () => {
  const [readme, report] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/compatibility.md", import.meta.url), "utf8"),
  ]);

  for (const row of COMPATIBILITY_MATRIX_ROWS) {
    assert.ok(
      report.includes(`| ${row.id} | \`${row.kit.commit}\` | \`${row.hyper.commit}\` |`),
      `missing published compatibility row ${row.id}`,
    );
  }
  for (const unsupported of DELIBERATELY_UNSUPPORTED_CASES) {
    assert.ok(
      report.includes(`| \`${unsupported.category}\` | \`${unsupported.reasonCode}\` |`),
      `missing published rejection ${unsupported.category}`,
    );
  }

  assert.match(report, /Omitting\s+`--protocol`\s+keeps 2\.0 as the Kit CLI default/u);
  assert.match(report, /run`, `next`, `resume`, checkpoint, `guard`,\s+and the MCP/u);
  assert.match(report, /does not establish a package-version support window|not a package-version support\s+window/u);
  assert.match(readme, /exact compatibility and migration report/u);
  assert.match(readme, /run-phase-3-compatibility\.mjs/u);
  assert.match(report, new RegExp(PHASE_3_COMPATIBILITY_DEFINITION.packages.kitNew.commit, "u"));
  assert.match(report, new RegExp(PHASE_3_COMPATIBILITY_DEFINITION.packages.hyperNew.commit, "u"));
  assert.match(report, new RegExp(PHASE_3_COMPATIBILITY_DEFINITION.schemaHash, "u"));
  assert.doesNotMatch(readme, /dormant and documentation-only during Phase 0/u);
});

test("published Phase 4 evidence names the exact corrected-Kit pair", async () => {
  const report = await readFile(new URL("../docs/compatibility.md", import.meta.url), "utf8");

  for (const id of ["kitNew", "kitOld", "hyperNew", "hyperOld"]) {
    assert.match(
      report,
      new RegExp(PHASE_4_COMPATIBILITY_DEFINITION.packages[id].commit, "u"),
      `missing published Phase 4 ${id} commit`,
    );
  }
  // The Phase 4 claim is that the wire contract did not move.
  assert.match(report, new RegExp(PHASE_4_COMPATIBILITY_DEFINITION.schemaHash, "u"));
  assert.equal(
    PHASE_4_COMPATIBILITY_DEFINITION.schemaHash,
    PHASE_3_COMPATIBILITY_DEFINITION.schemaHash,
  );
  assert.match(report, /all three rows negotiated 3\.2/iu);
  assert.match(report, /exact-pair\s+evidence\s+and\s+does\s+not\s+establish\s+a\s+package-version\s+support\s+window/u);
});

test("the README is outcome-first and states its limitations honestly", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const heading = (name) => readme.indexOf(`## ${name}`);

  // User value before internal architecture. A reader deciding whether this
  // solves their problem should not have to read the design first.
  assert.ok(heading("The problem") > 0, "missing problem statement");
  assert.ok(heading("Five-minute start") > heading("The problem"));
  assert.ok(heading("Limitations") > heading("Five-minute start"));
  assert.ok(
    heading("How it works") > heading("Limitations"),
    "architecture must come after user value"
  );

  // The limitations that would mislead a reader if omitted.
  assert.match(readme, /deprecated/u);
  assert.match(readme, /exact-pair/u);
  assert.match(readme, /inconclusive/u);
  assert.match(readme, /No performance or review-efficiency claim/u);

  // Never point a reader at an install path while nothing supported is published.
  assert.doesNotMatch(readme, /npm i(nstall)? -g visp-kit/u);
  assert.doesNotMatch(readme, /npx visp-dev/u);
});
