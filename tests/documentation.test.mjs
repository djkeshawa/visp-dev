import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPATIBILITY_MATRIX_ROWS,
  DELIBERATELY_UNSUPPORTED_CASES,
} from "../src/compatibility-matrix.mjs";

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
  assert.doesNotMatch(readme, /dormant and documentation-only during Phase 0/u);
});
