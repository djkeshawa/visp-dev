import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPATIBILITY_MATRIX_ROWS,
  DELIBERATELY_UNSUPPORTED_CASES,
} from "../src/compatibility-matrix.mjs";
import { PHASE_3_COMPATIBILITY_DEFINITION } from "../src/phase-3-compatibility.mjs";
import { PHASE_4_COMPATIBILITY_DEFINITION } from "../src/phase-4-compatibility.mjs";
import {
  PHASE_6_COMPATIBILITY_DEFINITION,
  PHASE_6_COMPATIBILITY_SHA256,
} from "../src/phase-6-compatibility.mjs";

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
  assert.match(
    readme,
    /run-phase-6-compatibility\.mjs[\s\S]*?--package-manager[\s\S]*?--npm[\s\S]*?--run-provider local[\s\S]*?--run-id <stable-local-run-id>[\s\S]*?--run-attempt 1[\s\S]*?--output <new-phase-6-report-path>/u
  );
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

test("published Phase 6 evidence names the exact npm artifacts", async () => {
  const report = await readFile(new URL("../docs/compatibility.md", import.meta.url), "utf8");

  for (const id of ["kitFixed", "kitPrevious", "hyperCurrent", "hyperPrevious"]) {
    const expected = PHASE_6_COMPATIBILITY_DEFINITION.packages[id];

    assert.match(report, new RegExp(expected.commit, "u"), `missing Phase 6 ${id} commit`);
    assert.match(
      report,
      new RegExp(expected.tarballSha256, "u"),
      `missing Phase 6 ${id} tarball hash`,
    );
  }
  assert.match(report, new RegExp(PHASE_6_COMPATIBILITY_DEFINITION.schemaHash, "u"));
  assert.match(report, new RegExp(PHASE_6_COMPATIBILITY_SHA256, "u"));
  assert.match(report, /exact published pair/iu);
  assert.match(report, /do not establish\s+a SemVer compatibility range/iu);
  assert.match(report, /strict C1 aggregate uses `visp\.conformance\.v2`/u);
  assert.match(report, /valid v1 report[\s\S]*cannot establish C1 release eligibility/u);
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

  // A supported release is published, so the README must name the install path
  // and the exact versions — read from the data rather than restated here, or
  // this assertion becomes the next thing to drift out of date. The previous
  // version of this test asserted the *absence* of an install path, which
  // outlived the freeze it was written for and then enforced a false claim.
  const matrix = JSON.parse(
    await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
  );

  assert.equal(matrix.published, true, "this assertion assumes a published release");
  assert.match(
    readme,
    new RegExp(
      `npm install -g visp-kit@${matrix.supportedRelease.kit} visp-hyper-agent@${matrix.supportedRelease.hyper}`,
      "u"
    )
  );
  assert.match(readme, new RegExp(`visp-kit@${matrix.supportedRelease.kit}`, "u"));
  assert.match(readme, new RegExp(`visp-hyper-agent@${matrix.supportedRelease.hyper}`, "u"));

  // P10-US-08 / D-118: visp-dev 0.1.0 is public-ready (private flipped off);
  // publication itself remains the owner's explicit step. Until the registry
  // actually carries it, an npx invocation would still fail for every reader,
  // so the README keeps not suggesting one.
  assert.equal(
    JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).private,
    false,
  );
  assert.doesNotMatch(readme, /npx visp-dev/u);

  // The deprecated builds must never be presented as obtainable.
  for (const { name, version } of matrix.deprecated) {
    assert.doesNotMatch(readme, new RegExp(`install[^\\n]*${name}@${version}`, "u"));
  }
});

test("release documentation preserves history without weakening the active publication freeze", async () => {
  const releaseProcess = await readFile(
    new URL("../docs/release-process.md", import.meta.url),
    "utf8"
  );

  assert.match(releaseProcess, /Current status: publication freeze active/u);
  assert.match(releaseProcess, /Historical decisions D-097 and D-107 authorized/u);
  assert.match(releaseProcess, /controlling D-110 publication freeze is active/u);
  assert.match(
    releaseProcess,
    /no push, tag, pull request, publish, dist-tag, deprecation, or visibility\s+change/u
  );
  assert.doesNotMatch(releaseProcess, /The freeze is gone/u);
});
