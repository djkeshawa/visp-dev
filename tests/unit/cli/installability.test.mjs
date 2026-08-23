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
  matrixNodeFloor,
  readCompatibility,
  releaseInstallRecovery,
  supportedPair,
  unreadableNodeRequirements
} from "../../../src/cli/installability.mjs";
import { satisfiesFloor } from "../../../src/cli/version-order.mjs";

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

test("does not tell a user running a newer pair to install an older one", () => {
  // LC-111 defect 3. The verdict is "this matrix makes no support claim about
  // what you have"; the advice was "downgrade to something it makes no support
  // claim about either". A recovery that contradicts its own verdict and costs
  // the reader a working installation is worse than no recovery.
  const guidance = installability(supersededMatrix, {
    kit: "0.6.0",
    hyper: "0.9.0"
  }).guidance;

  assert.ok(
    !/npm install -g/u.test(guidance),
    `Recovery told a user running a newer pair to install an older one:\n${guidance}`
  );
  assert.match(guidance, /downgrade/u, "it must say why it is not naming an install command");
  assert.match(guidance, /visp-kit@0\.6\.0/u, "it must name what the user actually has");
  // And it must still withhold the support claim rather than trade one
  // omission for another.
  assert.match(guidance, /no support claim/iu);
  assert.match(guidance, /Do not mix the pairs/u);
});

test("a single package ahead of the registry is enough to withhold the downgrade", () => {
  // The mixed machine: Hyper newer, Kit older. Naming the pair install would
  // still downgrade Hyper, so the command is withheld and the state described.
  const guidance = installability(supersededMatrix, {
    kit: "0.2.3",
    hyper: "0.9.0"
  }).guidance;

  assert.ok(!/npm install -g/u.test(guidance), guidance);
  assert.match(guidance, /visp-hyper-agent@0\.9\.0/u);
});

test("the lowest Node floor in the matrix is the one doctor can rely on", () => {
  assert.equal(matrixNodeFloor(supersededMatrix), ">=22");
  assert.equal(
    matrixNodeFloor({ pairs: [{ node: ">=24" }, { node: ">=22" }, { node: ">=26" }] }),
    ">=22",
    "a pair requiring less is still a pair this matrix knows about"
  );
  assert.equal(matrixNodeFloor({ pairs: [] }), null);
  assert.equal(matrixNodeFloor({}), null);
});

test("the shapes the live matrix really writes are all still ranked", () => {
  // The filter that rejects a compound range could just as easily reject a
  // legitimate floor and quietly turn every Node row into "no requirement".
  assert.equal(matrixNodeFloor({ pairs: [{ node: "24" }, { node: "22" }] }), "22");
  assert.equal(matrixNodeFloor({ pairs: [{ node: ">= 24" }, { node: ">=26" }] }), ">= 24");
  assert.equal(matrixNodeFloor({ pairs: [{ node: "v24" }, { node: "v22" }] }), "v22");
  assert.equal(
    matrixNodeFloor({ pairs: [{ node: ">=22.5.0" }, { node: ">=22.1.0" }] }),
    ">=22.1.0",
    "the minor decides, exactly as it does in satisfiesFloor"
  );
  assert.equal(
    matrixNodeFloor({ pairs: [{ node: ">=22.0.0-rc.1" }, { node: ">=22.0.0" }] }),
    ">=22.0.0-rc.1",
    "an rc ranks below the release it precedes"
  );
});

test("a requirement that is not a floor is never ranked as one", () => {
  // LC-132. matrixNodeFloor compared requirement STRINGS, and the comparison
  // reads the first version-shaped token anywhere in the string. `<25` scored
  // as 25, so a matrix stating one ceiling and one floor handed doctor the
  // ceiling and doctor printed "every pair in this matrix requires Node <25" —
  // a sentence the matrix does not say, about a bound it inverts.
  for (const unreadable of ["<25", "^22", "~22", ">22", ">=22 <25", ">=22 || >=24", "lts"]) {
    assert.equal(
      matrixNodeFloor({ pairs: [{ node: unreadable }, { node: ">=26" }] }),
      null,
      `${unreadable} was read as a floor and ranked against >=26`
    );
  }
});

test("one unreadable requirement makes the floor unknown, not the readable subset", () => {
  // Ranking only the pairs that parse fixes the sentence and breaks the
  // quantifier instead. doctor prints "EVERY pair in this matrix requires Node
  // X" and fails the row below it, so on this matrix a subset answer of ">=26"
  // tells a working Node 24 machine to upgrade — while the pair that was
  // dropped, ">=22 <25", is precisely the one that supports Node 24. Unknown is
  // the answer that is true about every pair.
  const partlyReadable = { pairs: [{ node: ">=26" }, { node: ">=22 <25" }] };

  assert.equal(matrixNodeFloor(partlyReadable), null);
  assert.deepEqual(unreadableNodeRequirements(partlyReadable), [">=22 <25"]);
});

test("a matrix stating no floor anyone can read reports what it does state", () => {
  // The distinction doctor's wording turns on: nothing stated is not the same
  // as something stated that this tool will not guess at. Saying "no Node
  // requirement" about a matrix of `<25` withholds the one fact a reader on
  // Node 26 could act on.
  for (const nodes of [["<25"], ["^22"], [">=22 || >=24"], ["lts"], ["<25", "^22", "lts"]]) {
    const matrix = { pairs: nodes.map((node) => ({ node })) };

    assert.equal(matrixNodeFloor(matrix), null, `${nodes.join(", ")} contains no floor`);
    assert.deepEqual(unreadableNodeRequirements(matrix), nodes);
  }
});

test("a matrix that truly states nothing is distinguishable from one that does", () => {
  for (const matrix of [
    { pairs: [] },
    {},
    { pairs: [{ id: "no-node-key" }] },
    { pairs: [{ node: null }, { node: "" }, { node: "   " }] },
    { pairs: [{ node: ">=22" }] }
  ]) {
    assert.deepEqual(
      unreadableNodeRequirements(matrix),
      [],
      `${JSON.stringify(matrix)} states nothing unreadable`
    );
  }
  assert.equal(matrixNodeFloor({ pairs: [{ node: null }, { node: "" }] }), null);
});

test("the floor doctor reports is one the same matrix would accept a machine against", () => {
  // The contract between the two functions, asserted rather than assumed:
  // whatever matrixNodeFloor hands doctor, satisfiesFloor must be able to
  // answer about. A requirement that ranks but cannot be judged is the
  // [unknown] row this ticket exists to remove.
  const floor = matrixNodeFloor({ pairs: [{ node: ">=26" }, { node: ">=28" }] });

  assert.equal(floor, ">=26");
  assert.equal(satisfiesFloor("v26.7.0", floor), true);
  assert.equal(satisfiesFloor("v24.15.0", floor), false);
});
