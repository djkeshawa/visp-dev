import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  conflictDetail,
  conflictRecovery,
  doctor,
  doctorReport,
  nodeCheck,
  overallStatus
} from "../../../src/cli/doctor.mjs";
import { readCompatibility } from "../../../src/cli/installability.mjs";

/** A matrix that recommends nothing, which is the state doctor is stuck in. */
const noRecommendedPair = { pairs: [{ id: "current", node: ">=22" }] };

/** One product's resolution, as `collectEnvironment` reports it. */
function resolution(command, version, filePath, others = []) {
  const candidates = [
    ...(version === null ? [] : [{ command, version, path: filePath }]),
    ...others
  ];
  return {
    command,
    version,
    path: version === null ? null : filePath,
    candidates,
    conflict: new Set(candidates.map((candidate) => candidate.version)).size > 1
  };
}

/** A machine, described rather than arranged. */
function machineWhere({ node = "v26.7.0", kit, hyper, git = "git version 2.43.0" }) {
  return {
    node,
    git,
    gitRepository: true,
    kit: kit.version,
    hyper: hyper.version,
    resolved: { kit, hyper }
  };
}

const noInstall = {
  installable: false,
  reason: "No supported release is published.",
  guidance: "Build Kit and Hyper from source at the pinned commits below."
};

function reportFor(environment, { matrix = noRecommendedPair, pair = null, install = noInstall } = {}) {
  return doctorReport({ matrix, pair, environment, install });
}

const checkNamed = (report, name) => report.checks.find((check) => check.name === name);

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

// ---------------------------------------------------------------------------
// LC-111 — the Node row, and the difference between "unsupported" and
// "unknown to this matrix".
// ---------------------------------------------------------------------------

test("Node is judged against the matrix floor even when no pair is recommended", () => {
  // The reported screen: `[unknown] Node: v26.7.0 — no supported pair (the
  // pairs in this matrix require >=22)`. Whether Kit and Hyper can be matched
  // to an evidenced pair is a question about Kit and Hyper. Answering the Node
  // question only when that one succeeded made a fine Node look like the fault.
  const check = nodeCheck(noRecommendedPair, null, "v26.7.0");

  assert.equal(check.status, "ok", `Node v26.7.0 reported as "${check.status}" against ">=22"`);
  assert.equal(check.requirement, ">=22");
  assert.match(check.detail, /separate question/u, "the row must not read as the reason for the refusal");
});

test("Node still fails when it is genuinely below the floor", () => {
  const check = nodeCheck(noRecommendedPair, null, "v20.11.0");

  assert.equal(check.status, "failed");
  assert.match(check.detail, />=22/u);
});

test("a pair's own Node requirement wins over the matrix floor", () => {
  const check = nodeCheck(noRecommendedPair, { node: ">=24" }, "v22.14.0");

  assert.equal(check.status, "failed", "the recommended pair's requirement is the one that binds");
  assert.equal(check.requirement, ">=24");
  assert.equal(nodeCheck(noRecommendedPair, { node: ">=24" }, "v26.7.0").status, "ok");
});

test("Node is unknown only when the matrix states no requirement", () => {
  const check = nodeCheck({ pairs: [] }, null, "v26.7.0");

  assert.equal(check.status, "unknown");
  assert.equal(check.requirement, null);
  assert.match(check.detail, /no Node requirement/u);
});

// ---------------------------------------------------------------------------
// LC-132 — the Node row must not state a requirement the matrix does not.
// ---------------------------------------------------------------------------

test("a matrix requirement this tool cannot read is never printed as the floor", () => {
  // The floor was picked by comparing requirement strings, and the comparison
  // reads the first version-shaped token in one. `<25` scored as 25 and won, so
  // doctor announced `every pair in this matrix requires Node <25` — a ceiling
  // printed as a floor, with the matrix's only real floor thrown away.
  const check = nodeCheck({ pairs: [{ node: "<25" }, { node: ">=26" }] }, null, "v26.7.0");

  assert.equal(check.status, "unknown");
  assert.equal(check.requirement, null);
  assert.doesNotMatch(check.detail, /requires Node <25/u);
});

test("an unreadable requirement is reported as unreadable, not as absent", () => {
  // `unknown` is right; "this matrix states no Node requirement" is not, and it
  // withholds the one fact a reader could act on. The raw values are named.
  const check = nodeCheck({ pairs: [{ node: "<25" }, { node: "^22" }] }, null, "v26.7.0");

  assert.equal(check.status, "unknown");
  assert.doesNotMatch(check.detail, /states no Node requirement/u);
  assert.match(check.detail, /cannot read/u);
  assert.match(check.detail, /<25/u, "the reader must be told which requirements those were");
  assert.match(check.detail, /\^22/u);
});

test("a pair the floor calculation cannot read never fails a machine that pair supports", () => {
  // The regression that ranking only the readable pairs would have introduced.
  // `>=22 <25` is unreadable and `>=26` is not, so a subset answer reports
  // `requires Node >=26`, fails the row and pushes `Install Node >=26` — at a
  // Node 24 machine that the discarded pair explicitly supports. Telling a
  // working machine to change is worse than saying nothing.
  const matrix = { pairs: [{ node: ">=26" }, { node: ">=22 <25" }] };
  const check = nodeCheck(matrix, null, "v24.15.0");

  assert.notEqual(check.status, "failed", `v24.15.0 failed against ${check.requirement}`);
  assert.equal(check.status, "unknown");
  assert.equal(check.requirement, null, "no floor is true of every pair here");
});

test("having no evidence about an installed pair is not a refusal", () => {
  // Every installable binary reports `unverified`, because the matrix pins its
  // pairs by commit and a binary on PATH does not report one. Folding that into
  // `blocked` made doctor a gate that could only say no — it could not
  // green-light a correct installation, so its verdict carried no information.
  assert.equal(
    overallStatus([{ status: "ok" }, { status: "unverified" }, { status: "unverified" }]),
    "unknown"
  );
});

test("absence still blocks and a deprecated build still fails", () => {
  // The fix must not be "stop saying no". These are the answers that must
  // survive it, or the change would be weakening what the check detects.
  assert.equal(overallStatus([{ status: "ok" }, { status: "unavailable" }]), "blocked");
  assert.equal(overallStatus([{ status: "unverified" }, { status: "deprecated" }]), "failed");
  assert.equal(overallStatus([{ status: "unverified" }, { status: "failed" }]), "failed");
  // A failure outranks a missing component, which outranks an unknown one.
  assert.equal(overallStatus([{ status: "unavailable" }, { status: "deprecated" }]), "failed");
  assert.equal(overallStatus([{ status: "unavailable" }, { status: "unverified" }]), "blocked");
  assert.equal(overallStatus([{ status: "ok" }, { status: "ok" }]), "ok");
});

test("doctor answers the Node question on the matrix this repository ships", async () => {
  // The unit tests above use a hand-built matrix. This one drives the real
  // file, because the defect was reported against the real file — and against a
  // Node that clears its floor, which every supported runtime does.
  //
  // It asserts nothing about the OVERALL verdict, which depends on whether this
  // machine has Visp installed: a CI runner has none, and `blocked` is the right
  // answer there. Only the Node row is a fact about the matrix rather than about
  // the machine; `doctorReport` above covers the verdict deterministically.
  const report = await doctor(process.cwd());
  const node = report.checks.find((check) => check.name === "Node");

  assert.equal(
    node.status,
    "ok",
    `Node ${process.version} reported as "${node.status}" against the shipped matrix, whose ` +
      "floor this repository's own engines field also requires"
  );
  assert.deepEqual(
    report.recovery.filter((line) => line.startsWith("Install Node")),
    [],
    "a Node that clears the floor must not produce an instruction to install another one"
  );
  assert.ok(report.statusReason.length > 0, "the verdict must say what it means");
});

test("doctor names the path each reported version came from", async () => {
  const report = await doctor(process.cwd());

  for (const check of report.checks.filter((entry) => entry.name.startsWith("Visp"))) {
    if (check.value === "not found on PATH") continue;
    assert.ok(
      typeof check.path === "string" && check.path.length > 0,
      `${check.name} reported ${check.value} without saying which file printed it`
    );
  }
});

test("a correct installation is no longer refused for lack of an evidenced pair", () => {
  // The state battleground round two was in: a current pair installed, a matrix
  // that recommends nothing, a fine Node. Every part of that machine works, and
  // the report said "blocked".
  const report = reportFor(
    machineWhere({
      kit: resolution("visp-kit", "0.6.0", "/opt/bin/visp-kit"),
      hyper: resolution("visp", "0.9.0", "/opt/bin/visp")
    })
  );

  assert.equal(report.status, "unknown");
  assert.equal(checkNamed(report, "Node").status, "ok");
  assert.match(report.statusReason, /nothing is wrong/u);
});

test("a machine with nothing installed is still blocked", () => {
  const report = reportFor(
    machineWhere({
      kit: resolution("visp-kit", null, null),
      hyper: resolution("visp-hyper", null, null)
    })
  );

  assert.equal(report.status, "blocked");
  assert.equal(checkNamed(report, "Visp Kit").value, "not found on PATH");
  assert.equal(checkNamed(report, "Visp Kit").path, null);
  assert.deepEqual(report.recovery, [noInstall.guidance]);
});

test("a deprecated build is a failure with an uninstall instruction", () => {
  const matrix = {
    ...noRecommendedPair,
    deprecated: [{ name: "visp-kit", version: "0.1.0", reason: "Predates the enforcement fixes." }]
  };
  const report = reportFor(
    machineWhere({
      kit: resolution("visp-kit", "0.1.0", "/opt/bin/visp-kit"),
      hyper: resolution("visp-hyper", "0.8.0", "/opt/bin/visp-hyper")
    }),
    { matrix }
  );

  assert.equal(report.status, "failed");
  assert.equal(checkNamed(report, "Visp Kit").status, "deprecated");
  assert.match(report.recovery.join("\n"), /Uninstall visp-kit@0\.1\.0/u);
});

test("a Node below the floor produces the one command that changes it", () => {
  const report = reportFor(
    machineWhere({
      node: "v20.11.0",
      kit: resolution("visp-kit", "0.6.0", "/opt/bin/visp-kit"),
      hyper: resolution("visp", "0.9.0", "/opt/bin/visp")
    })
  );

  assert.equal(report.status, "failed");
  assert.match(report.recovery.join("\n"), /Install Node >=22, then re-run visp-dev doctor\./u);
});

test("a missing Git is reported without being confused for a missing Visp", () => {
  const report = reportFor({
    ...machineWhere({
      kit: resolution("visp-kit", "0.6.0", "/opt/bin/visp-kit"),
      hyper: resolution("visp", "0.9.0", "/opt/bin/visp")
    }),
    git: null,
    gitRepository: false
  });

  assert.equal(checkNamed(report, "Git").status, "failed");
  assert.equal(checkNamed(report, "Git").value, "not found");
  assert.match(report.recovery.join("\n"), /Install Git/u);
  assert.match(report.recovery.join("\n"), /git init/u);
});

test("two installations of one product are named in the row and in the recovery", () => {
  // LC-95 as a user meets it: the version reported is the one the shell runs,
  // and the one it beat is printed rather than left to be inferred.
  const hyper = resolution("visp", "0.9.0", "/opt/bin/visp", [
    { command: "visp-hyper", version: "0.8.0", path: "/usr/lib/node/bin/visp-hyper" }
  ]);
  const report = reportFor(
    machineWhere({ kit: resolution("visp-kit", "0.6.0", "/opt/bin/visp-kit"), hyper })
  );
  const row = checkNamed(report, "Visp Hyper Agent");

  assert.equal(row.value, "0.9.0");
  assert.equal(row.path, "/opt/bin/visp");
  assert.match(row.detail, /also on PATH: visp-hyper 0\.8\.0 at \/usr\/lib\/node\/bin\/visp-hyper/u);
  assert.match(report.recovery.join("\n"), /PATH carries two installations of visp-hyper-agent/u);
  assert.match(report.recovery.join("\n"), /Your shell runs visp 0\.9\.0/u);
});

test("the conflict wording names both installations and which one wins", () => {
  const hyper = resolution("visp", "0.9.0", "/opt/bin/visp", [
    { command: "visp-hyper", version: "0.8.0", path: "/usr/lib/node/bin/visp-hyper" }
  ]);

  assert.equal(
    conflictDetail(hyper),
    "also on PATH: visp-hyper 0.8.0 at /usr/lib/node/bin/visp-hyper"
  );
  const advice = conflictRecovery("visp-hyper-agent", hyper);
  assert.match(advice, /visp 0\.9\.0 \(\/opt\/bin\/visp\)/u);
  assert.match(advice, /visp-hyper 0\.8\.0 \(\/usr\/lib\/node\/bin\/visp-hyper\)/u);
  assert.match(advice, /Remove one installation, or reorder PATH/u);
});

test("an installable release turns an absent binary into a failure, not an unknown", () => {
  // When a pair CAN be obtained, not having it is the user's problem to fix and
  // the report says so. The distinction only holds while both halves work.
  const install = {
    installable: true,
    reason: "A supported release is published.",
    guidance: "npm install -g visp-kit@0.2.3 visp-hyper-agent@0.4.3"
  };
  const report = reportFor(
    machineWhere({
      kit: resolution("visp-kit", null, null),
      hyper: resolution("visp-hyper", null, null)
    }),
    { pair: { node: ">=22" }, install }
  );

  assert.equal(report.status, "failed");
  assert.equal(checkNamed(report, "Visp Kit").status, "failed");
  assert.equal(checkNamed(report, "Node").detail, "requires >=22");
});

test("the shipped matrix states a Node floor for every pair it holds", async () => {
  // The Node row is only actionable while this holds. If a pair ever lands
  // without one, doctor goes back to saying "unknown" — legitimately, but this
  // says so at the point the data changes rather than in a user's terminal.
  const matrix = await readCompatibility();

  for (const pair of matrix.pairs) {
    assert.ok(pair.node, `pair ${pair.id} states no Node requirement`);
  }
});
