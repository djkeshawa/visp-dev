import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  importSpecifiers,
  suiteImportViolations,
  suiteNames,
  suiteReachViolations,
  suiteReachedBy,
} from "../../../../src/compatibility/engine/isolation.mjs";

test("the suites directory holds the four named suites and nothing else", () => {
  assert.deepEqual(suiteNames(), [
    "additive-enforcement-fixes",
    "mixed-generation-negotiation",
    "published-artifact-differential",
    "risk-profile-evidence-validity",
  ]);
});

test("R5: no suite imports from a sibling suite", () => {
  const offenders = suiteImportViolations();
  assert.deepEqual(offenders, [], `R5 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("R5: no suite reaches outside engine, platform and toolchain", () => {
  const offenders = suiteReachViolations();
  assert.deepEqual(offenders, [], `R5 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("static, multi-line and dynamic import forms are all seen", () => {
  const source = [
    'import { a } from "./one.mjs";',
    "import {",
    "  b,",
    '} from "../../engine/two.mjs";',
    'export { c } from "./three.mjs";',
    'const d = await import("../other-suite/four.mjs");',
    'import fs from "node:fs";',
  ].join("\n");
  assert.deepEqual(importSpecifiers(source), [
    "./one.mjs",
    "../../engine/two.mjs",
    "./three.mjs",
    "node:fs",
    "../other-suite/four.mjs",
  ]);
});

test("a cross-suite import is detected on a synthetic tree", (t) => {
  // A guard that never fires is indistinguishable from a guard that cannot.
  // This builds the exact violation the refactor removed and asserts it is
  // caught, so the passing result above means something.
  const root = mkdtempSync(path.join(tmpdir(), "visp-suite-isolation-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "older"));
  mkdirSync(path.join(root, "newer"));
  writeFileSync(path.join(root, "older", "definition.mjs"), "export const PIN = 1;\n");
  writeFileSync(
    path.join(root, "newer", "journey.mjs"),
    'import { PIN } from "../older/definition.mjs";\nexport const use = () => PIN;\n',
  );

  const offenders = suiteImportViolations(`${root}${path.sep}`);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /newer\/journey\.mjs/u);
  assert.match(offenders[0], /resolves into the older suite/u);
  assert.match(offenders[0], /move the shared code into src\/compatibility\/engine\//u);

  assert.equal(
    suiteReachedBy(path.join(root, "newer", "journey.mjs"), "../older/definition.mjs", `${root}${path.sep}`),
    "older",
  );
  assert.equal(
    suiteReachedBy(path.join(root, "newer", "journey.mjs"), "../../engine/shape.mjs", `${root}${path.sep}`),
    null,
  );
});
