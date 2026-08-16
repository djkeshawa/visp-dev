import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { doctor } from "../../../src/cli/doctor.mjs";

test("a detected binary is never reported as verified", async () => {
  // A binary on PATH cannot be matched to the supported pair, because the pair
  // is pinned by commit and the binary does not report one. Claiming otherwise
  // would bless an unknown build.
  const source = await readFile(new URL("../../../src/cli/doctor.mjs", import.meta.url), "utf8");

  assert.match(source, /"unverified"/u);
  assert.doesNotMatch(source, /status:\s*"ok",\s*\n\s*detail:\s*"detected on PATH"/u);
});

test("doctor reports what it observed, not a claim about the disk", async () => {
  // detectTool spawns the binary, so absence means "not reachable from this
  // shell". Reporting "not installed" asserted something about the machine
  // that this tool never checked — a user who installed under a prefix off
  // PATH was told a falsehood.
  const report = await doctor(process.cwd());
  for (const check of report.checks) {
    assert.doesNotMatch(
      String(check.value ?? ""),
      /^not installed$/u,
      `${check.name} must not claim absence it did not verify`
    );
  }
});
