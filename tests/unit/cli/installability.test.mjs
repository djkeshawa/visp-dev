/**
 * Whether a release can be obtained, and whether the answer is actionable.
 *
 * A weak-model evaluation drove this tool on a real project and came away
 * unable to answer "is my machine set up correctly?". Two of the three reasons
 * lived here: the recovery said `npm install -g visp-kit@0.5.0
 * visp-hyper-agent@0.8.0` when `npm list -g` showed those exact versions
 * already installed, and `no supported pair` withheld every fact needed to act
 * on it. An instruction that changes nothing reads as "this tool does not know
 * what is on my machine" — and knowing that is its entire job.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  deprecatedInstallRecovery,
  installability,
  readCompatibility,
  releaseInstallRecovery,
  supportedNodeRanges,
  supportedPair
} from "../../../src/cli/installability.mjs";

test("the supported pair exists only when a release is evidence-eligible", async () => {
  const matrix = await readCompatibility();
  const pair = supportedPair(matrix);

  assert.equal(pair === null, matrix.supportedRelease === null);
  if (pair !== null) {
    // Deliberately NOT asserting a specific pair id: recommendation is
    // established by five-field identity anchoring, not by which suite happened
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

const supersededMatrix = {
  published: false,
  supportedRelease: null,
  pairs: [{ id: "phase-6", node: ">=22" }],
  registryState: {
    supersedesEvidencedPair: true,
    npm: { "visp-kit": "0.5.0", "visp-hyper-agent": "0.8.0" },
    hazard: "Do not mix the pairs."
  }
};

test("does not recommend installing versions that are already installed", () => {
  const guidance = installability(supersededMatrix, {
    kit: "0.5.0",
    hyper: "0.8.0"
  }).guidance;

  assert.ok(
    /already have/u.test(guidance),
    `Recovery still tells a user to install what they have:\n${guidance}`
  );
  assert.ok(
    !/npm install -g visp-kit@0\.5\.0/u.test(guidance),
    `Recovery contains a no-op install command:\n${guidance}`
  );
});

test("still names the install command when the versions differ", () => {
  // The converse. Suppressing the command whenever anything is installed would
  // strand the user who genuinely has the wrong pair.
  const guidance = installability(supersededMatrix, {
    kit: "0.2.3",
    hyper: "0.8.0"
  }).guidance;

  assert.ok(
    /npm install -g visp-kit@0\.5\.0 visp-hyper-agent@0\.8\.0/u.test(guidance),
    `Recovery withheld the install command from a user who needs it:\n${guidance}`
  );
});

test("still names the install command when nothing is installed at all", () => {
  const guidance = installability(supersededMatrix, { kit: null, hyper: null }).guidance;
  assert.ok(/npm install -g/u.test(guidance), guidance);
});

test("names the Node versions the matrix requires", () => {
  assert.equal(supportedNodeRanges(supersededMatrix), " (the pairs in this matrix require >=22)");
});

test("says nothing rather than something empty when there are no pairs", () => {
  assert.equal(supportedNodeRanges({ pairs: [] }), "");
  assert.equal(supportedNodeRanges({}), "");
});
