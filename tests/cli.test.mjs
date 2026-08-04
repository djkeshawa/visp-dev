import assert from "node:assert/strict";
import test from "node:test";

import {
  doctor,
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
    // Deliberately NOT asserting a specific pair id: recommendation is
    // established by five-field identity anchoring, not by which phase happened
    // to prove the pair. Pinning the id here would re-impose the ceiling that
    // stopped any later pair from ever being recommended.
    assert.match(pair.id, /^[a-z0-9-]+$/u);
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

test("versions keeps every pair pinned by commit and names a release only when one is recommended", async () => {
  const result = await versions(process.cwd());

  assert.equal(result.published, true);
  assert.ok(result.pairs.length >= 3);
  for (const pair of result.pairs) {
    assert.match(pair.kit, /^[0-9a-f]{40}$/u);
    assert.match(pair.hyper, /^[0-9a-f]{40}$/u);
  }

  // Once the evidenced pair is superseded on the registry, `versions` must not
  // print a supported release at all — printing the older one is the failure
  // mode this guards.
  if (result.supportedRelease === null) {
    assert.doesNotMatch(formatVersions(result), /supported release:\s+visp-kit@/u);
  } else {
    assert.match(
      formatVersions(result),
      new RegExp(
        `supported release:\\s+visp-kit@${result.supportedRelease.kit} \\+ visp-hyper-agent@${result.supportedRelease.hyper}`,
        "u"
      )
    );
  }
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

test("doctor formatting never names a release when none is recommended", () => {
  const incomplete = formatDoctor({ status: "blocked", checks: [], recovery: [], supportedRelease: null });

  assert.match(incomplete, /supported release: none \(evidence incomplete\)/u);
  assert.doesNotMatch(incomplete, /0\.2\.3|0\.4\.3/u);

  // A superseded pair is a distinct state: the evidence is complete and valid,
  // it just no longer describes what a user should install. Calling that
  // "incomplete" would misdescribe it.
  const superseded = formatDoctor({
    status: "blocked",
    checks: [],
    recovery: [],
    supportedRelease: null,
    registryState: { supersedesEvidencedPair: true }
  });

  assert.match(superseded, /supported release: none \(evidenced pair superseded on the registry\)/u);
  assert.doesNotMatch(superseded, /0\.2\.3|0\.4\.3/u);
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

test("superseded guidance names a command to run, not only one to avoid", async () => {
  // Two independent weak-model evaluators followed the recovery section of a
  // superseded-state doctor report and still did not know what to install:
  // guidance returned only the hazard. Every other branch of installability()
  // returns a real command, and --help promises "the exact next command".
  // Withholding the support claim is honest; withholding the command is not.
  const matrix = await readCompatibility();
  if (matrix.registryState?.supersedesEvidencedPair !== true) return;

  const result = installability(matrix);

  assert.equal(result.installable, false);
  assert.match(result.guidance, /npm install -g/u, "guidance must contain a runnable command");
  assert.match(result.guidance, /visp-kit@\d+\.\d+\.\d+/u);
  assert.match(result.guidance, /visp-hyper-agent@\d+\.\d+\.\d+/u);
  // And it must still carry the hazard, not trade one omission for another.
  assert.match(result.guidance, /Do not install/u);
  // It must not overclaim: no support is being asserted for that pair.
  assert.match(result.guidance, /no support claim/iu);
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
