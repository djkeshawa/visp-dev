/**
 * Phase 6 pins the pair that Phase 4's frozen evidence cannot describe.
 *
 * Kit advanced past the Phase 4 and Phase 5 baselines through three changes,
 * all of which alter what Kit says without altering what it speaks:
 *
 *   - **F-C1 and F-C2** (`2fd30d3`) — `visp next` refuses to advise from a core
 *     state artifact it could not parse, and `doctor` reports a deleted required
 *     artifact as loudly as a corrupted one.
 *   - **F-D4** (`994e46e`) — traceability failures print the exact repair.
 *   - **Override visibility** (`77d1317`) — an override with no expiry is
 *     counted and named.
 *   - **Assurance delta** (`27b49bf`) — a stale review decision reports what
 *     moved, not only that something did.
 *   - **`visp assurance delta`** (`7aa5fa3`) — that report reaches a human. It
 *     was deliberately kept off the canonical action, because `reviewDecision`
 *     lives in the hashed schema and adding a field there would break the very
 *     claim these rows exist to make.
 *
 * Beyond `7aa5fa3` the range includes release packaging, metadata, and later
 * correctness changes culminating in the exact D-107 Kit `0.2.3` identity.
 * Package metadata remains material because the `files` allowlist decides what
 * ships even when no wire-schema source changes. Hyper likewise advanced to
 * the exact D-107 `0.4.3` identity.
 *
 * The behavioural changes alter what Kit says on damaged, incomplete, or
 * unusual input, which is exactly the kind of change that can break a host
 * relying on the old silence. `schemas/` and `src/integration/` are untouched
 * across the whole range, so every row expects the unchanged WorkflowAction 3.2
 * schema hash. Proving that is the point: corrections of this kind must be
 * additive at the wire contract.
 *
 * The current pin describes the D-107 published artifacts by the full
 * five-field identity: package name, version, commit, tree, and tarball hash.
 * Earlier published identities remain historical evidence, not a current
 * recommendation.
 *
 * The pin was moved here after the evidence-currency check flagged both engines
 * as material — the D-094 rule. This is not chasing HEAD: leaving the pin would
 * have kept evidence describing a Kit nobody installs, one commit after the
 * registry started serving this one.
 *
 * This is deliberately a narrow claim. The differential observes one routine,
 * accepted project across the six configured WorkflowAction surfaces. It does
 * not prove equivalence for damaged, incomplete, or unusual input.
 */
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex
} from "./compatibility-lab.mjs";
import { packAndInstall, toolVersion } from "./phase-2-compatibility.mjs";
import { runPairCompatibilityJourney } from "./phase-4-compatibility.mjs";
import { verifyRunIdentity } from "./evidence-identity.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
const REPORT_NOTE =
  "Exercises one routine accepted fixture across exactly six WorkflowAction 3.2 surfaces for the published visp-kit@0.2.3 and visp-hyper-agent@0.4.3 artifacts. It does not prove equivalence for damaged, incomplete, or unusual input.";
const PACKED_RUN_TOKEN = Symbol("packed Phase 6 run");

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function plain(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }

  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);

  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

function exactValue(actual, expected, label) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} drifted from the frozen Phase 6 definition`);
  }
}

const SCHEMA_HASH =
  "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";

export const PHASE_6_COMPATIBILITY_DEFINITION = deepFreeze({
  compatibility: [
    {
      // The row that matters most: corrected Kit against a Hyper that predates
      // the corrections. Proves the fail-closed change is additive.
      expectedProtocol: "3.2",
      expectedSchemaHash: SCHEMA_HASH,
      hyper: "hyperPrevious",
      id: "fixed_kit_previous_hyper",
      kit: "kitFixed"
    },
    {
      expectedProtocol: "3.2",
      expectedSchemaHash: SCHEMA_HASH,
      hyper: "hyperCurrent",
      id: "fixed_kit_current_hyper",
      kit: "kitFixed"
    },
    {
      // The baseline the differential assertion compares against.
      expectedProtocol: "3.2",
      expectedSchemaHash: SCHEMA_HASH,
      hyper: "hyperCurrent",
      id: "previous_kit_current_hyper",
      kit: "kitPrevious"
    }
  ],
  packages: {
    hyperCurrent: {
      commit: "3538457ae51f79245358321668c1f3566c5eac74",
      name: "visp-hyper-agent",
      tarballSha256: "27ce00657b98b8303119122fe5851300059a21581ff5a4ab7f0cc4c3a08a89e2",
      tree: "55ca7ea10865630119f792eb227c9634e0fee8f9",
      version: "0.4.3"
    },
    hyperPrevious: {
      commit: "61858199d90bffafb062bde61453f5def6357efa",
      name: "visp-hyper-agent",
      tarballSha256: "0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55",
      tree: "a7be744b06510443fe97a06b6aa5c214b1bad0f1",
      version: "0.3.0"
    },
    kitFixed: {
      commit: "eb70bce84568e9237690be1eea61355bbff23157",
      name: "visp-kit",
      tarballSha256: "1261d18eee28f7f196ab94d5099b54a3f66c36c74dfd1fab83bbba86f1f7e538",
      tree: "c1cef391194a20a57704bfaa6ed36c7f1b163756",
      version: "0.2.3"
    },
    kitPrevious: {
      commit: "19d5ffb3276e52462a945c66043f48e31cd6b38f",
      name: "visp-kit",
      tarballSha256: "7118b04daf8ec5adaf0a7a67ddac6d4dc4782a5b59a442f5e458442558b3dc5c",
      tree: "44a5e805f53c48ad64422c1ebb9261487392bb58",
      version: "0.2.0"
    }
  },
  /**
   * The pair whose action views must match exactly. Named here rather than
   * derived, so the assertion cannot quietly start comparing a row against
   * itself.
   */
  differential: {
    baseline: "previous_kit_current_hyper",
    corrected: "fixed_kit_current_hyper"
  },
  expectedView: {
    actionVerdict: "ready",
    nextCommand: "visp verify --task T001",
    selectionMode: "advertised"
  },
  scenario: {
    assuranceVerdict: "inconclusive",
    flow: "accepted",
    humanApproval: false,
    id: "routine_accepted",
    profile: "routine",
    reviewStatus: "current",
    riskFactors: [],
    riskLevel: "low",
    summaryState: "available",
    taskClass: "documentation",
    taskId: "T001",
    testIndependence: "pre_existing"
  },
  schemaHash: SCHEMA_HASH,
  surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"]
});

export const PHASE_6_COMPATIBILITY_SHA256 = sha256Hex(
  canonicalStringify(PHASE_6_COMPATIBILITY_DEFINITION)
);

export async function runPackedPhase6Compatibility(input) {
  for (const field of [
    "hyperRepositoryRoot",
    "kitRepositoryRoot",
    "offlineCacheSource",
    "offlineStoreSource",
    "packageManagerCommand",
    "npmCommand"
  ]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  verifyRunIdentity(input.runIdentity, "Phase 6 run identity");

  const owned = await createOwnedRoot();

  try {
    const packages = {};

    for (const [id, definition] of Object.entries(PHASE_6_COMPATIBILITY_DEFINITION.packages)) {
      const kind = id.startsWith("kit") ? "kit" : "hyper";

      packages[id] = await packAndInstall({
        definition,
        kind,
        offlineCacheSource: input.offlineCacheSource,
        offlineStoreSource: input.offlineStoreSource,
        npmCommand: input.npmCommand,
        ownedRoot: owned.root,
        packageManagerCommand: input.packageManagerCommand,
        repositoryRoot: kind === "kit" ? input.kitRepositoryRoot : input.hyperRepositoryRoot
      });
    }

    const compatibility = [];

    for (const definition of PHASE_6_COMPATIBILITY_DEFINITION.compatibility) {
      const rowRoot = await createOwnedRoot({ baseDirectory: owned.root });

      compatibility.push(
        await runPairCompatibilityJourney({
          definition,
          hyper: packages[definition.hyper],
          kit: packages[definition.kit],
          root: rowRoot.root,
          scenario: PHASE_6_COMPATIBILITY_DEFINITION.scenario,
          surfaces: PHASE_6_COMPATIBILITY_DEFINITION.surfaces,
          label: "Phase 6"
        })
      );
    }

    return createPhase6CompatibilityReport({
      compatibility,
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion(input.npmCommand),
        operatingSystem: process.platform,
        pnpm: await toolVersion(input.packageManagerCommand)
      },
      packages: Object.fromEntries(
        Object.entries(packages).map(([id, value]) => [id, value.report])
      ),
      runIdentity: input.runIdentity
    }, PACKED_RUN_TOKEN);
  } finally {
    await cleanupOwnedRoot({ root: owned.root });
  }
}

/**
 * The action views a row observed, keyed by surface, for exact comparison.
 *
 * `actionId` is excluded because it is **not reproducible between runs** — the
 * same packages produce a different id each time, which is why Phase 4 removed
 * it from its frozen semantics too. Including it here would make the
 * differential permanently false and prove nothing.
 *
 * Everything an integrator actually depends on is compared: the verdict, the
 * next command, the negotiated protocol, the schema hash, and the selection
 * mode.
 */
function surfaceViews(row) {
  return Object.fromEntries(
    row.surfaces.map((surface) => {
      const { actionId, ...comparable } = surface.view;

      return [surface.id, comparable];
    })
  );
}

export function createPhase6CompatibilityReport(input, producerToken = null) {
  const { baseline, corrected } = PHASE_6_COMPATIBILITY_DEFINITION.differential;
  const baselineRow = input.compatibility.find((row) => row.id === baseline);
  const correctedRow = input.compatibility.find((row) => row.id === corrected);

  if (baselineRow === undefined || correctedRow === undefined) {
    throw new Error("Phase 6 requires both differential rows to have run.");
  }

  const report = {
    schemaVersion: "visp.phase-6-compatibility.v2",
    note: REPORT_NOTE,
    definitionSha256: PHASE_6_COMPATIBILITY_SHA256,
    environment: input.environment,
    producer: producerToken === PACKED_RUN_TOKEN ? "packed-runner" : "synthetic-constructor",
    runIdentity: structuredClone(input.runIdentity),
    packages: Object.fromEntries(
      Object.entries(input.packages).map(([id, value]) => [
        id,
        {
          commit: value.source.commit,
          name: value.pack.first.package.name,
          tarballSha256: value.pack.first.sha256,
          tree: value.source.tree,
          version: value.pack.first.package.version
        }
      ])
    ),
    compatibility: input.compatibility,
    differential: {
      baseline,
      corrected,
      // Identical action views on a healthy project is the claim. If this is
      // ever false, the fail-closed correction changed something an integrator
      // running healthy projects can observe, and that is a finding.
      identical:
        canonicalStringify(surfaceViews(baselineRow)) ===
        canonicalStringify(surfaceViews(correctedRow))
    },
    schemaHash: PHASE_6_COMPATIBILITY_DEFINITION.schemaHash
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyPhase6CompatibilityReport(report);

  return JSON.parse(canonicalStringify(report));
}

export function verifyPhase6CompatibilityReport(report) {
  exactKeys(
    report,
    [
      "compatibility",
      "definitionSha256",
      "differential",
      "environment",
      "note",
      "packages",
      "producer",
      "reportSha256",
      "runIdentity",
      "schemaHash",
      "schemaVersion"
    ],
    "Phase 6 report"
  );

  if (
    report.schemaVersion !== "visp.phase-6-compatibility.v2" ||
    report.definitionSha256 !== PHASE_6_COMPATIBILITY_SHA256 ||
    report.schemaHash !== PHASE_6_COMPATIBILITY_DEFINITION.schemaHash ||
    report.note !== REPORT_NOTE ||
    !HASH.test(report.reportSha256)
  ) {
    throw new Error("Phase 6 report identity is invalid.");
  }
  if (!["packed-runner", "synthetic-constructor"].includes(report.producer)) {
    throw new Error("Phase 6 report producer is invalid.");
  }
  verifyRunIdentity(report.runIdentity, "Phase 6 run identity");

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Phase 6 report hash does not match its content.");
  }

  exactKeys(
    report.packages,
    Object.keys(PHASE_6_COMPATIBILITY_DEFINITION.packages),
    "Phase 6 packages"
  );

  for (const [id, pinned] of Object.entries(PHASE_6_COMPATIBILITY_DEFINITION.packages)) {
    const observed = report.packages[id];

    exactKeys(
      observed,
      ["commit", "name", "tarballSha256", "tree", "version"],
      `Phase 6 package ${id}`
    );

    if (
      !COMMIT.test(observed.commit) ||
      !COMMIT.test(observed.tree) ||
      !HASH.test(observed.tarballSha256)
    ) {
      throw new Error(`Phase 6 ${id} package identity is malformed.`);
    }

    exactValue(observed, pinned, `Phase 6 package ${id}`);
  }

  exactKeys(
    report.environment,
    ["architecture", "git", "node", "npm", "operatingSystem", "pnpm"],
    "Phase 6 environment"
  );

  if (
    Object.values(report.environment).some(
      (value) => typeof value !== "string" || value.length === 0
    )
  ) {
    throw new Error("Phase 6 environment is incomplete.");
  }

  if (
    !Array.isArray(report.compatibility) ||
    report.compatibility.length !== PHASE_6_COMPATIBILITY_DEFINITION.compatibility.length
  ) {
    throw new Error("Phase 6 report does not contain exactly the frozen compatibility rows.");
  }

  report.compatibility.forEach((row, rowIndex) => {
    const pinned = PHASE_6_COMPATIBILITY_DEFINITION.compatibility[rowIndex];

    exactKeys(row, ["id", "surfaces"], `Phase 6 compatibility ${pinned.id}`);

    if (
      row.id !== pinned.id ||
      !Array.isArray(row.surfaces) ||
      row.surfaces.length !== PHASE_6_COMPATIBILITY_DEFINITION.surfaces.length
    ) {
      throw new Error(`Phase 6 compatibility ${pinned.id} drifted.`);
    }

    let rowView;

    row.surfaces.forEach((surface, surfaceIndex) => {
      const expectedSurfaceId = PHASE_6_COMPATIBILITY_DEFINITION.surfaces[surfaceIndex];

      exactKeys(surface, ["id", "view"], `Phase 6 compatibility ${pinned.id} surface`);
      exactKeys(
        surface.view,
        [
          "actionId",
          "actionVerdict",
          "nextCommand",
          "protocolVersion",
          "schemaHash",
          "selectionMode"
        ],
        `Phase 6 compatibility ${pinned.id}/${expectedSurfaceId}`
      );

      if (
        surface.id !== expectedSurfaceId ||
        !PREFIXED_HASH.test(surface.view.actionId) ||
        surface.view.protocolVersion !== pinned.expectedProtocol ||
        surface.view.schemaHash !== pinned.expectedSchemaHash
      ) {
        throw new Error(`Phase 6 compatibility ${pinned.id}/${expectedSurfaceId} drifted.`);
      }

      exactValue(
        {
          actionVerdict: surface.view.actionVerdict,
          nextCommand: surface.view.nextCommand,
          selectionMode: surface.view.selectionMode
        },
        PHASE_6_COMPATIBILITY_DEFINITION.expectedView,
        `Phase 6 compatibility ${pinned.id}/${expectedSurfaceId} semantic observation`
      );

      rowView ??= surface.view;
      exactValue(
        surface.view,
        rowView,
        `Phase 6 compatibility ${pinned.id}/${expectedSurfaceId} surface equality`
      );
    });
  });

  exactKeys(report.differential, ["baseline", "corrected", "identical"], "Phase 6 differential");
  exactValue(
    {
      baseline: report.differential.baseline,
      corrected: report.differential.corrected
    },
    PHASE_6_COMPATIBILITY_DEFINITION.differential,
    "Phase 6 differential identity"
  );

  const baselineRow = report.compatibility.find(
    (row) => row.id === report.differential.baseline
  );
  const correctedRow = report.compatibility.find(
    (row) => row.id === report.differential.corrected
  );
  const observedIdentical =
    canonicalStringify(surfaceViews(baselineRow)) ===
    canonicalStringify(surfaceViews(correctedRow));

  if (report.differential.identical !== observedIdentical) {
    throw new Error("Phase 6 differential result does not match the reported rows.");
  }

  // The whole reason this phase exists. A report claiming the corrections were
  // additive while the differential rows disagree is the failure to catch.
  if (observedIdentical !== true) {
    throw new Error(
      "Phase 6 differential failed: the corrected Kit and the previous Kit disagree on a healthy project."
    );
  }

  if (
    /visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu.test(
      canonicalStringify(report)
    )
  ) {
    throw new Error("Phase 6 report contains unstable runtime content.");
  }

  return true;
}
