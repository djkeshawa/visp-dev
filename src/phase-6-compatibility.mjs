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
 *
 * Each changes behaviour on damaged, incomplete, or unusual input, which is
 * exactly the kind of change that can break a host relying on the old silence.
 * `schemas/` and `src/integration/` are untouched across the whole range, so
 * every row expects the unchanged WorkflowAction 3.2 schema hash. Proving that
 * is the point: corrections of this kind must be additive at the wire contract.
 *
 * The pin was moved here deliberately rather than left at `2fd30d3`. Two of the
 * three changes landed after that commit and the evidence-currency check
 * classified them as material, meaning they can change observable behaviour.
 * Leaving the pin would have kept evidence that no longer described the Kit in
 * the tree. This is not chasing HEAD — it is re-establishing proof after a
 * change the tooling flagged as capable of invalidating it.
 *
 * The differential row is the one that matters. It asserts that the corrected
 * Kit and the previous Kit produce **identical** action views on a healthy
 * project — so the behaviour change is confined to input that was already
 * broken, and an integrator running healthy projects observes nothing new.
 */
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex
} from "./compatibility-lab.mjs";
import { packAndInstall, toolVersion } from "./phase-2-compatibility.mjs";
import { runPairCompatibilityJourney } from "./phase-4-compatibility.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
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
      commit: "bfe5366cc7a5dc9c74bb4806d8cf46617a7c8d0f",
      tree: "6e39c12b762398a5c1bbcbc8a2c836ace5f8d6d5"
    },
    hyperPrevious: {
      commit: "61858199d90bffafb062bde61453f5def6357efa",
      tree: "a7be744b06510443fe97a06b6aa5c214b1bad0f1"
    },
    kitFixed: {
      commit: "77d1317a197752cd32567f0e856c0fa8abc942cb",
      tree: "9b5bae38de6a6ef96ee7b7290e52b3931a2eef3f"
    },
    kitPrevious: {
      commit: "19d5ffb3276e52462a945c66043f48e31cd6b38f",
      tree: "44a5e805f53c48ad64422c1ebb9261487392bb58"
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
      )
    });
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

export function createPhase6CompatibilityReport(input) {
  const { baseline, corrected } = PHASE_6_COMPATIBILITY_DEFINITION.differential;
  const baselineRow = input.compatibility.find((row) => row.id === baseline);
  const correctedRow = input.compatibility.find((row) => row.id === corrected);

  if (baselineRow === undefined || correctedRow === undefined) {
    throw new Error("Phase 6 requires both differential rows to have run.");
  }

  const report = {
    schemaVersion: "visp.phase-6-compatibility.v1",
    note: "Pins the pair carrying the F-C1 and F-C2 fail-closed corrections. The differential row proves the behaviour change is confined to input that was already broken.",
    definitionSha256: PHASE_6_COMPATIBILITY_SHA256,
    environment: input.environment,
    packages: Object.fromEntries(
      Object.entries(input.packages).map(([id, value]) => [
        id,
        { commit: value.source.commit, tree: value.source.tree, tarballSha256: value.pack.first.sha256 }
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
    }
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyPhase6CompatibilityReport(report);

  return JSON.parse(canonicalStringify(report));
}

export function verifyPhase6CompatibilityReport(report) {
  if (report.schemaVersion !== "visp.phase-6-compatibility.v1") {
    throw new Error("Phase 6 report has an unexpected schema version.");
  }

  if (report.definitionSha256 !== PHASE_6_COMPATIBILITY_SHA256) {
    throw new Error("Phase 6 report was produced against a different frozen definition.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Phase 6 report hash does not match its content.");
  }

  for (const [id, observed] of Object.entries(report.packages)) {
    const pinned = PHASE_6_COMPATIBILITY_DEFINITION.packages[id];

    if (pinned === undefined) throw new Error(`Phase 6 report contains unpinned package ${id}.`);
    if (!COMMIT.test(observed.commit)) throw new Error(`Phase 6 ${id} commit is malformed.`);
    if (observed.commit !== pinned.commit || observed.tree !== pinned.tree) {
      throw new Error(`Phase 6 ${id} drifted from the frozen pair.`);
    }
  }

  const expected = PHASE_6_COMPATIBILITY_DEFINITION.compatibility.map((row) => row.id);
  const observed = report.compatibility.map((row) => row.id);

  if (canonicalStringify(observed) !== canonicalStringify(expected)) {
    throw new Error("Phase 6 report does not contain exactly the frozen compatibility rows.");
  }

  for (const row of report.compatibility) {
    const pinned = PHASE_6_COMPATIBILITY_DEFINITION.compatibility.find(
      (entry) => entry.id === row.id
    );

    for (const surface of row.surfaces) {
      if (surface.view.protocolVersion !== pinned.expectedProtocol) {
        throw new Error(`Phase 6 ${row.id}/${surface.id} negotiated an unexpected protocol.`);
      }

      if (!PREFIXED_HASH.test(surface.view.schemaHash)) {
        throw new Error(`Phase 6 ${row.id}/${surface.id} reported a malformed schema hash.`);
      }

      if (surface.view.schemaHash !== pinned.expectedSchemaHash) {
        throw new Error(`Phase 6 ${row.id}/${surface.id} changed the WorkflowAction schema hash.`);
      }
    }
  }

  // The whole reason this phase exists. A report claiming the corrections were
  // additive while the differential rows disagree is the failure to catch.
  if (report.differential.identical !== true) {
    throw new Error(
      "Phase 6 differential failed: the corrected Kit and the previous Kit disagree on a healthy project."
    );
  }

  return true;
}
