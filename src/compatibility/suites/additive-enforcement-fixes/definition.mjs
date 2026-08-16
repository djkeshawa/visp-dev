/**
 * What this suite proves: four enforcement-hole fixes plus local
 * review-decision signature verification (VSP025, Kit ADR 0003) are ADDITIVE at
 * the wire contract.
 *
 * Kit advanced past the previous suite's accepted baseline `d92364e` with
 * commits that change gate, policy, validator and diff behaviour — exactly the
 * strict-authority surfaces Hyper consumes — so that suite's report no longer
 * describes the shipped pair. `schemas/workflow-action/` is untouched across the
 * range, so every row here expects the unchanged WorkflowAction 3.2 schema hash.
 * Proving that is the point.
 */
import { deepFreeze } from "../../../platform/freeze.mjs";
import { defineSuite } from "../../engine/definition.mjs";

const SCHEMA_HASH = "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";

export const ADDITIVE_ENFORCEMENT_FIXES = defineSuite({
  id: "additive-enforcement-fixes",
  reportKind: "visp.additive-enforcement-fixes.evidence.v1",
  definition: {
    compatibility: [
      {
        // The row that matters most: corrected Kit against a Hyper that
        // predates the corrections. Proves the fixes are additive.
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperOld",
        id: "new_kit_old_hyper",
        kit: "kitNew",
      },
      {
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperNew",
        id: "old_kit_new_hyper",
        kit: "kitOld",
      },
      {
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH,
        hyper: "hyperNew",
        id: "new_kit_new_hyper",
        kit: "kitNew",
      },
    ],
    packages: {
      hyperNew: {
        commit: "61858199d90bffafb062bde61453f5def6357efa",
        tree: "a7be744b06510443fe97a06b6aa5c214b1bad0f1",
      },
      hyperOld: {
        commit: "cda0c6ce43abc6a69f4a436026d482e95ed74a2c",
        tree: "9694a2d7e36215ee95336ade735f1a5426698187",
      },
      kitNew: {
        commit: "3a8901b9b9fe788a0be98f247c75f9715db24723",
        tree: "74740a41b227ec73561e4adf09dd53bf02c2eff7",
      },
      kitOld: {
        commit: "d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e",
        tree: "6aa999a59ad7bd3b77f6b85bc07fabd6575d9f95",
      },
    },
    scenarios: [
      {
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
      {
        assuranceVerdict: "inconclusive",
        flow: "rejected",
        humanApproval: false,
        id: "behavioral_rejected",
        profile: "behavioral",
        reviewStatus: "rejected",
        riskFactors: [],
        riskLevel: "medium",
        summaryState: "available",
        taskClass: "bounded_feature",
        taskId: "T001",
        testIndependence: "pre_approved",
      },
      {
        assuranceVerdict: "inconclusive",
        flow: "stale",
        humanApproval: true,
        id: "critical_stale",
        profile: "critical",
        reviewStatus: "stale",
        riskFactors: [{ code: "authorization", version: "1.0" }],
        riskLevel: "high",
        summaryState: "available",
        taskClass: "security",
        taskId: "T001",
        testIndependence: "pre_approved",
      },
      {
        assuranceVerdict: "inconclusive",
        flow: "inconclusive",
        humanApproval: true,
        id: "critical_inconclusive",
        profile: "critical",
        reviewStatus: "missing",
        riskFactors: [{ code: "authorization", version: "1.0" }],
        riskLevel: "high",
        summaryState: "available",
        taskClass: "security",
        taskId: "T001",
        testIndependence: "pre_approved",
      },
    ],
    schemaHash: SCHEMA_HASH,
    surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
  },
});

export const ADDITIVE_ENFORCEMENT_FIXES_DEFINITION = ADDITIVE_ENFORCEMENT_FIXES.definition;
export const ADDITIVE_ENFORCEMENT_FIXES_SHA256 = ADDITIVE_ENFORCEMENT_FIXES.sha256;

/**
 * Observed once against the pinned pair and frozen, so a later run that
 * silently changes Kit's verdict, next command, packed bytes or mandatory
 * hotspot set fails instead of quietly publishing new semantics.
 *
 * These differ from the previous suite's by design: the enforcement fixes change
 * policy defaults, so the canonical action content legitimately moved. What must
 * not move is the protocol, the schema hash, or agreement between Kit and every
 * Hyper surface.
 */
export const ADDITIVE_ENFORCEMENT_OBSERVATIONS = deepFreeze({
  /**
   * Deliberately does NOT freeze a compatibility-row `actionId`.
   *
   * The canonical action identity is project-instance specific: each row builds
   * a fresh repository, and two runs over byte-identical packages produce
   * different action IDs. Measured directly — same packed Kit and Hyper, two
   * consecutive journeys, `sha256:5d2c3fa0…` then `sha256:2fd047aa…`.
   *
   * The previous suite froze this field, which is why its compatibility rows
   * cannot be reproduced by a fresh run. Freezing an unreproducible value is not
   * evidence, so this suite pins the properties that are actually invariant —
   * the verdict and the exact next command — while within-run cross-surface
   * equality still binds every surface to one identical action, including its ID.
   */
  compatibility: {
    new_kit_old_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    old_kit_new_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    new_kit_new_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
  },
  packages: {
    // hyperOld and kitOld repack to the exact bytes the previous suite accepted
    // for the same commits, which is the determinism check for this harness.
    hyperNew: "0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55",
    hyperOld: "5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d",
    kitNew: "d8df0c8c468ac98375c78c8f12d4df35846cfcf3e6dabf505051c6a5d2df49f9",
    kitOld: "6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d",
  },
  // Every verdict, next command and mandatory hotspot below is byte-identical
  // to the previous suite's accepted observation. The enforcement fixes moved
  // the action identity because policy defaults changed; they did not move a
  // single assurance semantic.
  scenarios: {
    routine_accepted: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-10-8525b69745abc7c139ca0982104f8dea9c2f6ce55667d519cad30eed74412d9f", "validation_command_change"],
        ["HS-20-2dacd3d42d42d17dd80208beac8cda8e049122ac826bb5f01caaca39f071502b", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    behavioral_rejected: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-10-02736d27c87c19d131d2d80711ee1a1ee4edb6a1ea764863600f6313a0184e57", "validation_command_change"],
        ["HS-20-2d70548b253a512e581e57a27be48f9b09d2dde86f07b6af4744997a3bb2a36c", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    critical_stale: {
      actionVerdict: "inconclusive",
      hotspots: [
        ["HS-00-5fe04c2895e241871da2faaeeba28781e91c9a3eba4e11af340de45e37b77729", "permissions"],
        ["HS-10-0e4bfbb88987d6e8a0bd23c1a940e6ca54fba8d5f6be966c1efc53fac1de84d1", "validation_command_change"],
        ["HS-20-359ec31c990b193e9a991e268788e4326c475c4acd8c72bb4b044b05ef8320c1", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    critical_inconclusive: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-00-61493e67cf93703897e0888cd4eff13b362ab5874b6e70129da23f57f696099f", "permissions"],
        ["HS-10-9dda892742a0ca799735ece91a911594053df93a103bfa7996f7dc604daeb6fa", "validation_command_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
        ["HS-20-e4e34d3ac69c7420a8646d4d4e5d8a39c026eda59d98928ffd58d967acbcfc6d", "unmapped_change"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
  },
});
