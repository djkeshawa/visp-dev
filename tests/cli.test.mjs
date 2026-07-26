import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDoctor,
  installability,
  readCompatibility,
  supportedPair,
  versions
} from "../src/cli.mjs";

test("the supported pair is the newest accepted end state", async () => {
  const matrix = await readCompatibility();
  const pair = supportedPair(matrix);

  assert.equal(pair.id, matrix.pairs.at(-1).id);
  assert.match(pair.kit.commit, /^[0-9a-f]{40}$/u);
  assert.match(pair.hyper.commit, /^[0-9a-f]{40}$/u);
});

test("nothing is installable while no release is published", async () => {
  const matrix = await readCompatibility();
  const result = installability(matrix);

  // The only Visp versions on npm are deprecated. An installer that fetched
  // them would hand the user the build this product exists to prevent.
  assert.equal(result.installable, false);
  assert.match(result.reason, /deprecated/u);
  assert.ok(result.guidance.length > 0);
});

test("a published matrix would be installable", () => {
  assert.equal(installability({ published: true }).installable, true);
});

test("versions reports pairs by commit and never asserts a release", async () => {
  const result = await versions(process.cwd());

  assert.equal(result.published, false);
  assert.ok(result.pairs.length >= 3);
  for (const pair of result.pairs) {
    assert.match(pair.kit, /^[0-9a-f]{40}$/u);
    assert.match(pair.hyper, /^[0-9a-f]{40}$/u);
  }
});

test("the deprecated register names every published version", async () => {
  const matrix = await readCompatibility();
  const entries = matrix.deprecated ?? [];

  // These are the versions actually on npm. If one is dropped from this list,
  // doctor silently stops warning about a defective build a user may have.
  for (const [name, version] of [
    ["visp-kit", "0.1.0"],
    ["visp-hyper-agent", "0.2.0"],
    ["visp-hyper-agent", "0.3.0"]
  ]) {
    assert.ok(
      entries.some((entry) => entry.name === name && entry.version === version),
      `${name}@${version} must be recorded as deprecated`
    );
  }
  for (const entry of entries) assert.ok(entry.reason.length > 0, `${entry.name} needs a reason`);
});

test("doctor reports a deprecated install as failed, not ok", async () => {
  const report = {
    status: "failed",
    checks: [
      {
        name: "Visp Kit",
        value: "0.1.0",
        status: "deprecated",
        detail: "visp-kit@0.1.0 is deprecated and unsupported."
      }
    ],
    recovery: ["Uninstall visp-kit@0.1.0"]
  };
  const text = formatDoctor(report);

  assert.match(text, /failed/u);
  assert.match(text, /\[deprecated\]/u);
  assert.match(text, /Recovery:/u);
});

test("a detected binary is never reported as verified", async () => {
  // A binary on PATH cannot be matched to the supported pair, because the pair
  // is pinned by commit and the binary does not report one. Claiming otherwise
  // would bless an unknown build.
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/cli.mjs", import.meta.url), "utf8")
  );

  assert.match(source, /"unverified"/u);
  assert.doesNotMatch(source, /status:\s*"ok",\s*\n\s*detail:\s*"detected on PATH"/u);
});
