/**
 * What this suite proves: Kit's assurance profile and its fresh, passed
 * candidate evidence survive the trip to every one of Hyper's six surfaces,
 * unchanged, for three risk profiles that differ in test independence and in
 * whether a human had to approve.
 *
 * The pin is a pair of exact commits, so the claim is about two packed
 * artifacts rather than about two version numbers.
 */
import { defineSuite } from "../../engine/definition.mjs";

export const RISK_PROFILE_EVIDENCE_VALIDITY = defineSuite({
  id: "risk-profile-evidence-validity",
  reportKind: "visp.risk-profile-evidence-validity.evidence.v1",
  definition: {
    pair: {
      hyper: {
        commit: "98b65d05a10766cb66b1caa9cb7ae3c5c589137d",
        tree: "34bb04ed2454e389f7aca7bea76fd05ab81f264c",
      },
      kit: {
        commit: "3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8",
        tree: "6b5a45bed9f97007490f553c0d6d3af81be8ae2e",
      },
    },
    profiles: [
      {
        humanApproval: false,
        id: "routine_candidate_evidence",
        profile: "routine",
        riskFactors: [],
        riskLevel: "low",
        taskClass: "documentation",
        taskId: "T001",
        testIndependence: "pre_existing",
      },
      {
        humanApproval: false,
        id: "behavioral_candidate_evidence",
        profile: "behavioral",
        riskFactors: [],
        riskLevel: "medium",
        taskClass: "bounded_feature",
        taskId: "T001",
        testIndependence: "pre_approved",
      },
      {
        humanApproval: true,
        id: "critical_candidate_evidence",
        profile: "critical",
        riskFactors: [{ code: "authorization", version: "1.0" }],
        riskLevel: "high",
        taskClass: "security",
        taskId: "T001",
        testIndependence: "pre_approved",
      },
    ],
    schemaHash: "41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d",
    surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
  },
});

export const RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION = RISK_PROFILE_EVIDENCE_VALIDITY.definition;
export const RISK_PROFILE_EVIDENCE_VALIDITY_SHA256 = RISK_PROFILE_EVIDENCE_VALIDITY.sha256;

/** WorkflowAction 3.1, as this pair advertises it. */
export const PROTOCOL_VERSION = "3.1";
/** The schema hash as a report records it: algorithm-prefixed. */
export const PREFIXED_SCHEMA_HASH = `sha256:${RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION.schemaHash}`;
