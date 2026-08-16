/**
 * What this suite proves: the published pair behaves identically to the pair it
 * superseded, on a healthy project, across all six WorkflowAction 3.2 surfaces.
 *
 * Kit advanced past the previous baselines through changes that alter what it
 * SAYS without altering what it SPEAKS:
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
 * Beyond `7aa5fa3` the range includes release packaging, metadata and later
 * correctness changes culminating in the exact D-107 Kit `0.2.3` identity.
 * Package metadata remains material because the `files` allowlist decides what
 * ships even when no wire-schema source changes. Hyper likewise advanced to the
 * exact D-107 `0.4.3` identity.
 *
 * The behavioural changes alter what Kit says on damaged, incomplete or unusual
 * input — exactly the kind of change that can break a host relying on the old
 * silence. `schemas/` and `src/integration/` are untouched across the whole
 * range, so every row expects the unchanged 3.2 schema hash.
 *
 * The pin describes the D-107 published artifacts by the full five-field
 * identity: name, version, commit, tree and tarball hash. It moved here after
 * the evidence-currency check flagged both engines as material — the D-094 rule.
 * That is not chasing HEAD: leaving the pin would have kept evidence describing
 * a Kit nobody installs, one commit after the registry started serving this one.
 *
 * This is deliberately a narrow claim. The differential observes ONE routine,
 * accepted project. It does not prove equivalence for damaged, incomplete or
 * unusual input.
 */
import { defineSuite } from "../../engine/definition.mjs";

const SCHEMA_HASH = "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";

export const PUBLISHED_ARTIFACT_DIFFERENTIAL = defineSuite({
  id: "published-artifact-differential",
  reportKind: "visp.published-artifact-differential.v2",
  definition: {
    compatibility: [
      {
        // The row that matters most: corrected Kit against a Hyper that
        // predates the corrections. Proves the fail-closed change is additive.
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperPrevious",
        id: "fixed_kit_previous_hyper",
        kit: "kitFixed",
      },
      {
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperCurrent",
        id: "fixed_kit_current_hyper",
        kit: "kitFixed",
      },
      {
        // The baseline the differential assertion compares against.
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperCurrent",
        id: "previous_kit_current_hyper",
        kit: "kitPrevious",
      },
    ],
    packages: {
      hyperCurrent: {
        commit: "3538457ae51f79245358321668c1f3566c5eac74",
        name: "visp-hyper-agent",
        tarballSha256: "27ce00657b98b8303119122fe5851300059a21581ff5a4ab7f0cc4c3a08a89e2",
        tree: "55ca7ea10865630119f792eb227c9634e0fee8f9",
        version: "0.4.3",
      },
      hyperPrevious: {
        commit: "61858199d90bffafb062bde61453f5def6357efa",
        name: "visp-hyper-agent",
        tarballSha256: "0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55",
        tree: "a7be744b06510443fe97a06b6aa5c214b1bad0f1",
        version: "0.3.0",
      },
      kitFixed: {
        commit: "eb70bce84568e9237690be1eea61355bbff23157",
        name: "visp-kit",
        tarballSha256: "1261d18eee28f7f196ab94d5099b54a3f66c36c74dfd1fab83bbba86f1f7e538",
        tree: "c1cef391194a20a57704bfaa6ed36c7f1b163756",
        version: "0.2.3",
      },
      kitPrevious: {
        commit: "19d5ffb3276e52462a945c66043f48e31cd6b38f",
        name: "visp-kit",
        tarballSha256: "7118b04daf8ec5adaf0a7a67ddac6d4dc4782a5b59a442f5e458442558b3dc5c",
        tree: "44a5e805f53c48ad64422c1ebb9261487392bb58",
        version: "0.2.0",
      },
    },
    /**
     * The pair whose action views must match exactly. Named here rather than
     * derived, so the assertion cannot quietly start comparing a row against
     * itself.
     */
    differential: {
      baseline: "previous_kit_current_hyper",
      corrected: "fixed_kit_current_hyper",
    },
    expectedView: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
      selectionMode: "advertised",
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
      testIndependence: "pre_existing",
    },
    schemaHash: SCHEMA_HASH,
    surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
  },
});

export const PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION = PUBLISHED_ARTIFACT_DIFFERENTIAL.definition;
export const PUBLISHED_ARTIFACT_DIFFERENTIAL_SHA256 = PUBLISHED_ARTIFACT_DIFFERENTIAL.sha256;

/** Verified by the report, so a reader learns the claim's limits from the document. */
export const REPORT_NOTE =
  "Exercises one routine accepted fixture across exactly six WorkflowAction 3.2 surfaces for the published visp-kit@0.2.3 and visp-hyper-agent@0.4.3 artifacts. It does not prove equivalence for damaged, incomplete, or unusual input.";
