import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDoctor,
  formatVersions,
  installability,
  deprecatedInstallRecovery,
  readCompatibility,
  releaseInstallRecovery,
  supportedPair,
  versions
} from "../src/cli.mjs";

test("the supported pair exists only when a release is evidence-eligible", async () => {
  const matrix = await readCompatibility();
  const pair = supportedPair(matrix);

  assert.equal(pair === null, matrix.supportedRelease === null);
  if (pair !== null) {
    assert.equal(pair.id, "phase-6");
    assert.match(pair.kit.commit, /^[0-9a-f]{40}$/u);
    assert.match(pair.hyper.commit, /^[0-9a-f]{40}$/u);
  }
});

test("a published pair is recommended only when supportedRelease is eligible", async () => {
  const matrix = await readCompatibility(process.cwd());
  const result = installability(matrix);

  assert.equal(result.installable, matrix.supportedRelease !== null);

  const ineligible = { ...matrix, published: true, supportedRelease: null };
  const refused = installability(ineligible);

  assert.equal(refused.installable, false);
  assert.match(refused.reason, /evidence|not yet supported/iu);

  const contradictory = {
    ...matrix,
    releaseEvidence: {
      eligible: false,
      issues: [{ code: "package_identity_mismatch" }]
    }
  };

  assert.equal(supportedPair(contradictory), null);
  assert.equal(installability(contradictory).installable, false);
  const dishonest = {
    ...matrix,
    releaseEvidence: {
      eligible: true,
      issues: [{ code: "package_identity_mismatch" }]
    }
  };

  assert.equal(supportedPair(dishonest), null);
  assert.equal(installability(dishonest).installable, false);
  const fakePair = structuredClone(matrix);

  fakePair.pairs.find((pair) => pair.id === "phase-6").kit.commit = "f".repeat(40);
  assert.equal(supportedPair(fakePair), null);
  assert.equal(installability(fakePair).installable, false);

  const eligible = {
    ...matrix,
    supportedRelease: { kit: "0.2.3", hyper: "0.4.3" }
  };
  const supported = installability(eligible);

  assert.equal(supported.installable, true);
  assert.match(supported.reason, /visp-kit@0\.2\.3/u);
  assert.equal(
    supported.guidance,
    "npm install -g visp-kit@0.2.3 visp-hyper-agent@0.4.3"
  );

  // The unpublished path still works and still names the deprecation, because a
  // user may already have one of those versions installed.
  assert.equal(installability({ published: false }).installable, false);
  assert.match(installability({ published: false }).reason, /deprecated/u);
});

test("versions reports the eligible release and keeps every pair pinned by commit", async () => {
  const result = await versions(process.cwd());

  assert.equal(result.published, true);
  assert.deepEqual(result.supportedRelease, { kit: "0.2.3", hyper: "0.4.3" });
  assert.ok(result.pairs.length >= 3);
  for (const pair of result.pairs) {
    assert.match(pair.kit, /^[0-9a-f]{40}$/u);
    assert.match(pair.hyper, /^[0-9a-f]{40}$/u);
  }
  assert.match(formatVersions(result), /supported release:\s+visp-kit@0\.2\.3 \+ visp-hyper-agent@0\.4\.3/u);
});

test("missing supported binaries yield the exact pinned install recovery once", () => {
  const guidance = "npm install -g visp-kit@0.2.3 visp-hyper-agent@0.4.3";
  const install = { installable: true, guidance };

  assert.deepEqual(
    releaseInstallRecovery(install, { kit: null, hyper: null }),
    [guidance]
  );
  assert.deepEqual(
    releaseInstallRecovery(install, { kit: "0.2.3", hyper: "0.4.3" }),
    []
  );
});

test("deprecated installs recover through the same exact eligible release guidance", () => {
  const guidance = "npm install -g visp-kit@0.2.3 visp-hyper-agent@0.4.3";

  assert.equal(
    deprecatedInstallRecovery("visp-kit", "0.1.0", { installable: true, guidance }),
    `Uninstall visp-kit@0.1.0; it is deprecated and unsupported. Then run: ${guidance}`
  );
  assert.match(
    deprecatedInstallRecovery("visp-kit", "0.1.0", {
      installable: false,
      guidance: "Build Kit and Hyper from source at the pinned commits below, or wait for a release."
    }),
    /Build Kit and Hyper from source/u
  );
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
    recovery: ["Uninstall visp-kit@0.1.0"],
    supportedRelease: { kit: "0.2.3", hyper: "0.4.3" }
  };
  const text = formatDoctor(report);

  assert.match(text, /failed/u);
  assert.match(text, /\[deprecated\]/u);
  assert.match(text, /Recovery:/u);
  assert.match(text, /supported release: visp-kit@0\.2\.3 \+ visp-hyper-agent@0\.4\.3/u);
});

test("doctor formatting never names a release when eligibility is incomplete", () => {
  const text = formatDoctor({ status: "blocked", checks: [], recovery: [], supportedRelease: null });

  assert.match(text, /supported release: none \(evidence incomplete\)/u);
  assert.doesNotMatch(text, /0\.2\.3|0\.4\.3/u);
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
