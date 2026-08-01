# WorkflowAction Compatibility

## Published evidence

This report publishes exact-pair evidence, not a package-version support
window.

- Harness implementation baseline:
  `4ac17a3c9300099e94f01df1d6c9299ca050f70c`
- Environment: Linux x64, Node `v24.15.0`, npm `11.12.1`, pnpm `11.3.0`,
  Git `2.34.1`
- Result: five of five supported exact pairs passed
- Negative corpus: seven of seven deliberately unsupported cases failed closed
- Evidence file SHA-256:
  `8c0f680d93f434d0432a57d0ec04e1cb5c163ae89e32c76f4254c49a6b2efa32`
- Frozen matrix SHA-256:
  `0d814c42c24ab434caca1f4ca14fe8de900856465d842daff79c6356cb2d6c15`
- Canonical report SHA-256:
  `0c3a7e7a29d4ac3ac9c935218f23d9fe22ff9f93699c840e85d49b7b38119583`

## Protocol behavior

Kit derives WorkflowAction 2.0 and 3.0 from one canonical action. Omitting
`--protocol` keeps 2.0 as the Kit CLI default. Explicit Kit selection accepts
only `--protocol 2.0` or `--protocol 3.0` with `--format json`; unsupported
requests fail and do not downgrade.

Negotiation belongs to Hyper. Hyper `auto` validates the integration-contract
advertisement and selected schema hash, then prefers 3.0 before 2.0. An
explicit unsupported request fails without downgrade. The bounded legacy
exception is an integration contract 2.0 without protocol advertisement:
selectorless Kit output remains WorkflowAction 2.0 and is labelled
`legacy_unadvertised`.

For the final pair, configured `run`, `next`, `resume`, checkpoint, `guard`,
and the MCP canonical-action resource consume the same negotiated canonical
action. Kit remains the only workflow authority.

## Exact supported pairs

| Row | Kit commit | Hyper commit | Proven behavior |
|---|---|---|---|
| A | `0a8026ca129cdb9ec8ba516a2e30aaf135d5d4a0` | `d4444da8f862dc229f6832c6bc89820df466d213` | Selectorless legacy/default WorkflowAction 2.0; no advertisement or negotiation. |
| B | `c03a2dd0838501f4c4e480a69171848d3f2c0499` | `d4444da8f862dc229f6832c6bc89820df466d213` | Kit supports explicit 3.0, while pre-negotiation Hyper continues to consume selectorless default 2.0. |
| C | `706c1ec348b9de8a51651d1c8e9587feb1962fd8` | `d4444da8f862dc229f6832c6bc89820df466d213` | Old Hyper tolerates the additive 2.0/3.0 advertisement and continues on selectorless 2.0. |
| D | `706c1ec348b9de8a51651d1c8e9587feb1962fd8` | `17f01e4295258ec55c4c74cb47dcfdbb66981dce` | Public doctor proves advertised, schema-verified 3.0 negotiation; historical strict `next` remains 2.0 at this commit. |
| E | `d85adbdac5dac85bea112c857967c067cb1708a9` | `2bf636f58517780256cd91089440fb3b2f501480` | Auto selects 3.0; explicit and legacy 2.0 remain supported; all six configured strict surfaces agree. |

The final duplicate normal npm packs were:

- Kit:
  `7227c8c02551597b3793c72d5a87414dd8e7619b2b0d1594e5772f64654f83cf`
- Hyper:
  `f5e11554e1e75dd4d51f457d87ec077797dcff2e623f27c83ff4d2dd702693cf`

## Deliberately unsupported cases

These are rejection tests, not supported compatibility rows.

| Category | Required result |
|---|---|
| `future_protocol` | `workflow_action_no_mutual_protocol` |
| `malformed_advertisement` | `workflow_action_advertisement_invalid` |
| `schema_hash_mismatch` | `workflow_action_schema_hash_mismatch` |
| `malformed_action` | `workflow_action_schema_invalid` |
| `wrong_returned_protocol` | `workflow_action_protocol_mismatch` |
| `semantic_contradiction` | `workflow_action_contradiction` |
| `explicit_unsupported_request` | `UNSUPPORTED_WORKFLOW_ACTION_PROTOCOL` |

The six Hyper cases require an authority-stop frame with the exact reason and
no canonical action frame. The direct Kit request requires the structured
unsupported-protocol error.

## Migration guidance

- Existing callers that omit `--protocol` continue receiving WorkflowAction
  2.0 from Kit.
- Hyper callers should use `auto` unless they need to test an exact supported
  wire version.
- Do not infer compatibility from `visp-kit` or `visp-hyper-agent` package
  versions. Use a row above or run the matrix for a new exact pair.
- WorkflowAction 2.0 is not deprecated by this report. Removal requires a later
  active phase, an ADR, migration documentation, and accepted compatibility
  evidence through the documented deprecation cycle.
- `visp-hyper doctor --json` reports the detected Kit version, integration
  contract version, selected protocol and selection mode, local schema hash and
  verification state, and authoritative action verdict.

## Limits

The report proves Linux x64 behavior only for the commits and tools named
above. Windows-style path data tested on Linux is not native Windows evidence.
No macOS result, native Windows result, generalized SemVer range, release,
deployment, or hosted compatibility claim is made.

## Phase 3 assurance-review extension

The dependency-free Phase 3 runner preserves all Phase 2 definitions and adds
a separate closed evidence report for WorkflowAction 3.2. Its frozen producers
are:

- Kit `d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e`, tree
  `6aa999a59ad7bd3b77f6b85bc07fabd6575d9f95`;
- Hyper `cda0c6ce43abc6a69f4a436026d482e95ed74a2c`, tree
  `9694a2d7e36215ee95336ade735f1a5426698187`;
- WorkflowAction 3.2 schema
  `sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9`.

The golden corpus covers routine accepted, behavioral rejected, critical stale,
and critical inconclusive cases. Each case records the authoritative Kit
assurance summary, case hash, verdict, review-decision state, mandatory
hotspots, action verdict, and exact next command. Installed Hyper must expose
the exact same normalized view through `run`, `next`, `resume`, checkpoint,
`guard`, and the MCP canonical-action resource.

The accepted Linux x64 run used Node `v24.15.0`, npm `11.12.1`, pnpm `11.3.0`,
and Git `2.34.1`. It passed all three additive compatibility rows, all four
golden scenarios, and all 24 golden Hyper surfaces. Its canonical report
SHA-256 is
`29f027f0ee1efdf0147a90fff4ed25ae763a6ccd65cba409f5afb3a4fd67dd83`;
the frozen Phase 3 definition SHA-256 is
`f32179c0e49657c841c3d2cc0bf91029b6fb6e1a9a1ac44b46f3326ba2efe577`.
The duplicate normal npm pack SHA-256 values were:

- new Kit:
  `6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d`;
- prior Kit:
  `5be534dad6fc6e76ca803bf3dcd7316bd6ebe3cd91053e4b3993c6bf2b0798a5`;
- new Hyper:
  `5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d`;
- prior Hyper:
  `95e91eac9b3bab510cf801d67815ddd961022d008176dd4780e490843349701a`.

All four authoritative assurance-case verdicts were `inconclusive` because
exact oracle-result mapping remained incomplete. Human acceptance or rejection
records accountable review state; it does not manufacture a `passed`
assurance verdict. The routine case reported `current` with a non-null decision
hash, the behavioral case `rejected` with a non-null hash, the drifted critical
case `stale` with its prior non-null hash, and the missing-candidate critical
case remained distinct as `missing` with a null decision hash.

The additive boundary is tested as three installed six-surface journeys:
new Kit with prior Hyper `98b65d05a10766cb66b1caa9cb7ae3c5c589137d`
negotiates 3.1; prior Kit
`3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8` with new Hyper negotiates
3.1; and the new pair negotiates 3.2. These are exact-pair observations, not a
SemVer support window. Visp Dev compares producer facts and never decides
acceptance, review requirements, currentness, or PR readiness.

## Phase 4 — corrected Kit enforcement against Hyper adoption

Kit advanced past the Phase 3 baseline with four enforcement-hole fixes and
local review-decision signature verification (Kit ADR 0003). Those commits
change gate, policy, validator, and diff behavior, so the Phase 3 evidence no
longer describes the shipped pair. Phase 4 pins the current pair and publishes
Kit `0.2.0`.

- New Kit: `3a8901b9b9fe788a0be98f247c75f9715db24723`
- Prior Kit: `d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e`
- New Hyper: `61858199d90bffafb062bde61453f5def6357efa`
- Prior Hyper: `cda0c6ce43abc6a69f4a436026d482e95ed74a2c`
- Canonical report SHA-256:
  `593f49385b22e3775a328cd83e87f159595cde6174c07006de9f43414ded3252`
- Frozen Phase 4 definition SHA-256:
  `baf25fc778628095d0baa91d18fbba723aa2c927a49923eda06d1e230b537a5e`

Result: three of three exact pairs passed across four golden scenarios and 24
surfaces. **All three rows negotiated 3.2 against the unchanged schema hash**
`sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9`,
which is the Phase 4 claim: the enforcement corrections are additive at the
wire contract and do not break a Hyper that predates them.

Every assurance semantic was preserved. All four scenario verdicts, next
commands, and mandatory hotspot sets are byte-identical to the Phase 3
observation; the drifted critical case remained `inconclusive` and was never
laundered into a pass. The canonical action identity did move, because policy
defaults changed — that is a content change, not a contract change.

The duplicate normal npm pack SHA-256 values were:

- new Kit:
  `d8df0c8c468ac98375c78c8f12d4df35846cfcf3e6dabf505051c6a5d2df49f9`;
- prior Kit:
  `6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d`;
- new Hyper:
  `0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55`;
- prior Hyper:
  `5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d`.

The prior Kit and prior Hyper hashes are byte-identical to the values Phase 3
published for the same commits, which is this harness's determinism check.

Reports are committed under `evidence/` and re-verify offline with
`pnpm compatibility:phase-4:verify`. A full re-run reproduces the packed
hashes, verdicts, next commands, and hotspots, but not a compatibility row's
`actionId`: that identity is specific to the throwaway repository each run
builds. Phase 4 therefore freezes the verdict and next command and binds the
action ID through within-run cross-surface equality. This remains exact-pair
evidence and does not establish a package-version support window.

## Phase 6 — exact published pair

Phase 6 re-establishes the additive compatibility claim at the exact artifacts
npm serves:

- Kit `visp-kit@0.2.3`: commit
  `eb70bce84568e9237690be1eea61355bbff23157`, tree
  `c1cef391194a20a57704bfaa6ed36c7f1b163756`, tarball SHA-256
  `1261d18eee28f7f196ab94d5099b54a3f66c36c74dfd1fab83bbba86f1f7e538`;
- Hyper `visp-hyper-agent@0.4.3`: commit
  `3538457ae51f79245358321668c1f3566c5eac74`, tree
  `55ca7ea10865630119f792eb227c9634e0fee8f9`, tarball SHA-256
  `27ce00657b98b8303119122fe5851300059a21581ff5a4ab7f0cc4c3a08a89e2`.

The additive and differential boundaries also pin prior Kit
`19d5ffb3276e52462a945c66043f48e31cd6b38f`, tree
`44a5e805f53c48ad64422c1ebb9261487392bb58`, tarball SHA-256
`7118b04daf8ec5adaf0a7a67ddac6d4dc4782a5b59a442f5e458442558b3dc5c`;
and prior Hyper `61858199d90bffafb062bde61453f5def6357efa`, tree
`a7be744b06510443fe97a06b6aa5c214b1bad0f1`, tarball SHA-256
`0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55`.

The Linux x64, Node `v24.15.0` packed run passed all three exact pairs and all
six surfaces per pair for one routine accepted fixture. Every surface negotiated
WorkflowAction 3.2 against schema
`sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9`.
The corrected and previous Kit views were identical on the healthy project
after excluding the per-run `actionId`, so the fail-closed corrections remain
confined to damaged, incomplete, or unusual input.

The canonical inner report SHA-256 is
`ac37ea8bfc205628f9c01e819637c4ecf57f72c1457eafcc18ef43ff25e1f4e7`;
the raw report-file SHA-256 is
`df7b4a5a6f01d34f09810d47d720dc4deb587e01293d0df392e9084e184fad7c`;
the frozen definition SHA-256 is
`155bdf2cc0930acd507c1f64103ed980119180465e231f3aa03795b4d3d08daa`.
Re-verify it offline with `pnpm compatibility:phase-6:verify`.

Linux x64 and macOS arm64 platform fixtures came from GitHub Actions run
`30686678616`, attempt `1`. The provenance sidecar binds the reviewed artifact
IDs, API digests, exact archive members, raw file hashes, and inner report
hashes. Its self-hash protects the captured attestation from unnoticed edits;
it does not independently authenticate GitHub.

The strict C1 aggregate uses `visp.conformance.v2`. The verifier retains an
integrity-only path for historical `visp.conformance.v1` reports, which predate
full tree identity and the release-evidence gate. A valid v1 report records its
historical coverage verdict; it cannot establish C1 release eligibility.

Version 2 also carries a closed `evidenceFiles` source manifest. Each required
family is bound to its exact declared path set and each present source is bound
to both its canonical inner report hash and its reviewed raw-file SHA-256. The
C1 review derives and freezes the committed release-candidate file identity as
raw SHA-256
`c4313e2d790a44a759afca8da5d1442bd1f669cbd91793894bcfae492e34751a`
and inner SHA-256
`074f01f848d72543ca951766f92abe7e52295135e543b7915da975b85128717e`.
The platform provenance sidecar is independently bound as raw SHA-256
`da0bddebf24ea289219b4d601e8ce97a9db6ab8001aafff7fecc50659cac8f12`
and inner SHA-256
`321ab76fc5b9e14b96dab4d28ae1fcd8763ad8535c16b2fb113c7b447a8fe52e`.
These source identities complement the Phase 6 and platform raw hashes above;
relabeling and rehashing an aggregate cannot substitute another evidence file.

The version numbers identify how to obtain these bytes; they do not establish
a SemVer compatibility range. The claim remains bound to the commits, trees,
and tarball hashes above. The routine-fixture differential does not prove
equivalence for damaged, incomplete, or unusual input.
