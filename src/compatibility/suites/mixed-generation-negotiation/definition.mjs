/**
 * What this suite proves: when Kit and Hyper come from different generations,
 * the pair still negotiates one protocol and one schema hash, and every one of
 * Hyper's six surfaces reports the same canonical action Kit does.
 *
 * Three rows cover the three interesting pairings — new engine with old
 * coordinator, old engine with new coordinator, and both new — and four golden
 * scenarios cover the four review outcomes an assurance case can reach.
 */
import { deepFreeze } from "../../../platform/freeze.mjs";
import { defineSuite } from "../../engine/definition.mjs";

const SCHEMA_HASH_32 = "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";
const SCHEMA_HASH_31 = "sha256:41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d";

export const MIXED_GENERATION_NEGOTIATION = defineSuite({
  id: "mixed-generation-negotiation",
  reportKind: "visp.mixed-generation-negotiation.evidence.v1",
  definition: {
    compatibility: [
      {
        expectedProtocol: "3.1",
        expectedSchemaHash: SCHEMA_HASH_31,
        hyper: "hyperOld",
        id: "new_kit_old_hyper",
        kit: "kitNew",
      },
      {
        expectedProtocol: "3.1",
        expectedSchemaHash: SCHEMA_HASH_31,
        hyper: "hyperNew",
        id: "old_kit_new_hyper",
        kit: "kitOld",
      },
      {
        expectedProtocol: "3.2",
        expectedSchemaHash: SCHEMA_HASH_32,
        hyper: "hyperNew",
        id: "new_kit_new_hyper",
        kit: "kitNew",
      },
    ],
    packages: {
      hyperNew: {
        commit: "cda0c6ce43abc6a69f4a436026d482e95ed74a2c",
        tree: "9694a2d7e36215ee95336ade735f1a5426698187",
      },
      hyperOld: {
        commit: "98b65d05a10766cb66b1caa9cb7ae3c5c589137d",
        tree: "34bb04ed2454e389f7aca7bea76fd05ab81f264c",
      },
      kitNew: {
        commit: "d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e",
        tree: "6aa999a59ad7bd3b77f6b85bc07fabd6575d9f95",
      },
      kitOld: {
        commit: "3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8",
        tree: "6b5a45bed9f97007490f553c0d6d3af81be8ae2e",
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
    schemaHash: SCHEMA_HASH_32,
    surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
  },
});

export const MIXED_GENERATION_NEGOTIATION_DEFINITION = MIXED_GENERATION_NEGOTIATION.definition;
export const MIXED_GENERATION_NEGOTIATION_SHA256 = MIXED_GENERATION_NEGOTIATION.sha256;

/**
 * Observed once against the pinned pair and frozen, so a later run that quietly
 * changes a verdict, a next command, an action identity, the packed bytes, or
 * the mandatory hotspot set fails instead of publishing new semantics.
 *
 * This is NOT part of the definition digest: it records what was observed, and
 * the digest identifies what was pinned.
 *
 * The compatibility `actionId` values here are not reproducible by a fresh run
 * — the same packages produce a different id each time, which is why the next
 * suite stopped freezing this field. They are kept as the historical record of
 * what this pair emitted, not as something a new run can satisfy.
 */
export const MIXED_GENERATION_OBSERVATIONS = deepFreeze({
  compatibility: {
    new_kit_old_hyper: {
      actionId: "sha256:8423630645be62bb4fb6bedf7aa28b24bc4417dd5695c76d05ebb3e79dd1e891",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    old_kit_new_hyper: {
      actionId: "sha256:548298798ff3f719750ba93e0a18449a9b0ecffd677d20b9e1b2d8d30254be72",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    new_kit_new_hyper: {
      actionId: "sha256:9315dd8821ea5e2917afc5456d2e42bdb88c38a7abe8a10add368249707852ec",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
  },
  packages: {
    hyperNew: "5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d",
    hyperOld: "95e91eac9b3bab510cf801d67815ddd961022d008176dd4780e490843349701a",
    kitNew: "6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d",
    kitOld: "5be534dad6fc6e76ca803bf3dcd7316bd6ebe3cd91053e4b3993c6bf2b0798a5",
  },
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
