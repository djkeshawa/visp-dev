# Slice B rename ledger

Everything Slice B moved, renamed or deleted in the compatibility domain, and
everything Slice C has to apply because of it. **Slice C works only from this
file.**

Naming follows R0: kebab-case, noun-named, directory supplies context, no verb
prefixes in `scripts/`, barrels are `index.mjs`, tests mirror the source path.
No `phase-N` survives in any path, directory or exported symbol.

`tests/maintenance/naming.test.mjs` rule 7 ("no phase number survives anywhere
in a path") now PASSES. The remaining rule-4 and rule-6 failures are all in
`src/holdout/`, `src/evaluation/` and `scripts/` — none of them Slice B's.

---

## 1. npm scripts Slice C must apply

| old key | old value | new key | new value |
|---|---|---|---|
| `compatibility:phase-2` | `node scripts/run-phase-2-compatibility.mjs` | `compatibility:risk-profiles` | `node scripts/compatibility/risk-profiles.mjs` |
| `compatibility:phase-2:verify` | `… --verify` | `compatibility:risk-profiles:verify` | `node scripts/compatibility/risk-profiles.mjs --verify` |
| `compatibility:phase-3` | `node scripts/run-phase-3-compatibility.mjs` | `compatibility:mixed-generation` | `node scripts/compatibility/mixed-generation.mjs` |
| `compatibility:phase-3:verify` | `… --verify` | `compatibility:mixed-generation:verify` | `node scripts/compatibility/mixed-generation.mjs --verify` |
| `compatibility:phase-4` | `node scripts/run-phase-4-compatibility.mjs` | `compatibility:additive-fixes` | `node scripts/compatibility/additive-fixes.mjs` |
| `compatibility:phase-4:verify` | `… --verify` | `compatibility:additive-fixes:verify` | `node scripts/compatibility/additive-fixes.mjs --verify` |
| `compatibility:phase-6` | `node scripts/run-phase-6-compatibility.mjs` | `compatibility:published-pair` | `node scripts/compatibility/published-pair.mjs` |
| `compatibility:phase-6:verify` | `… --verify` | `compatibility:published-pair:verify` | `node scripts/compatibility/published-pair.mjs --verify` |
| `examples:phase-4` | `node scripts/run-phase-4-host-examples.mjs` | `compatibility:host-assets` | `node scripts/compatibility/host-assets.mjs` |
| `compatibility-lab` | `node scripts/run-compatibility-lab.mjs` | `compatibility:lab` | `node scripts/compatibility/lab.mjs` |
| `compatibility-matrix` | `node scripts/run-compatibility-matrix.mjs` | `compatibility:matrix` | `node scripts/compatibility/matrix.mjs` |
| `compatibility-matrix:verify` | `… --verify` | `compatibility:matrix:verify` | `node scripts/compatibility/matrix.mjs --verify` |
| `conformance:fixtures` | `node scripts/run-conformance-fixtures.mjs` | `compatibility:fixtures` | `node scripts/compatibility/fixtures.mjs` |
| `conformance:fixtures:verify` | `… --verify` | `compatibility:fixtures:verify` | `node scripts/compatibility/fixtures.mjs --verify` |
| `golden-path` | `node scripts/run-golden-path.mjs` | `compatibility:golden-path` | `node scripts/compatibility/golden-path.mjs` |
| `golden-path:verify` | `… --verify` | `compatibility:golden-path:verify` | `node scripts/compatibility/golden-path.mjs --verify` |
| `divergence` | `node scripts/run-registry-divergence.mjs` | `compatibility:divergence` | `node scripts/compatibility/divergence.mjs` |
| `divergence:verify` | `… --verify` | `compatibility:divergence:verify` | `node scripts/compatibility/divergence.mjs --verify` |
| `evidence:currency` | `node scripts/run-evidence-currency.mjs` | `compatibility:currency` | `node scripts/compatibility/currency.mjs` |
| `release-candidate` | `node scripts/assemble-release-candidate.mjs` | `compatibility:release-candidate` | `node scripts/compatibility/release-candidate.mjs` |
| — (had no npm entry) | — | `compatibility:cross-generation` | `node scripts/compatibility/cross-generation-probe.mjs` |
| — (had no npm entry) | — | `compatibility:renamed-pair` | `node scripts/compatibility/renamed-pair-proof.mjs` |

**`compatibility:cross-generation` is new and matters.** The probe had zero npm
entries and zero importers, but it is the only harness for the 0.6.0-bridge
claim the release train made. It was one `rm` away from being deleted as dead
code.

### `--verify` no longer has a default path

`scripts/run-phase-6-compatibility.mjs:33` defaulted `--verify` to
`evidence/phase-6-pair-linux-x64-node24.json`. A bare `--verify` therefore
printed `PASS` about a file the caller never named, and kept printing it after
the pair it described had been superseded. Every `*:verify` npm entry above must
be invoked with an explicit path. The `verify*Report` FUNCTIONS all survive
(R4) — produce-then-verify is still real.

---

## 2. Files moved

### `src/compatibility/engine/` — new; nothing here existed before

| new path | lines | what it owns |
|---|---|---|
| `engine/definition.mjs` | 36 | `defineSuite` — the ONE `sha256Hex(canonicalStringify(definition))`, replacing five hand-written copies |
| `engine/report-envelope.mjs` | 62 | `sealReport`, `openReport`, `assertStableContent` |
| `engine/shape.mjs` | 158 | re-exports `platform/shape.mjs`; adds `verifyArtifactBinding`, `verifyEnvironment`, `verifyReviewDecision`, `verifyAssuranceActionView` |
| `engine/package-record.mjs` | 129 | `verifyPackedPackageRecord` (all four `validatePackage` variants) plus the four orphaned `evidence-identity` exports |
| `engine/surface-journey.mjs` | 389 | `collectSurfaceActions`, `projectActionView`, `compatibilityActionView`, `mcpAction`, `prepareEvidence`, `validateHotspots`, `runAssuranceScenario`, `runPairCompatibilityJourney` |
| `engine/packed-run.mjs` | 107 | `runPackedSuite`, `verifyRunnerInput`, `packedEnvironment` |
| `engine/isolation.mjs` | 108 | R5 as executable code — see §7 |

### `src/compatibility/suites/` — the four renamed suites

| old path | new directory |
|---|---|
| `src/phase-2-compatibility.mjs` (1084) | `src/compatibility/suites/risk-profile-evidence-validity/` |
| `src/phase-3-compatibility.mjs` (920) | `src/compatibility/suites/mixed-generation-negotiation/` |
| `src/phase-4-compatibility.mjs` (728) | `src/compatibility/suites/additive-enforcement-fixes/` |
| `src/phase-6-compatibility.mjs` (529) | `src/compatibility/suites/published-artifact-differential/` |

Each holds `definition.mjs`, `validation.mjs`, `journey.mjs`, `index.mjs`.

### The rest of the domain

| old path | new path |
|---|---|
| `src/phase-4-host-examples.mjs` (890) | `src/compatibility/host-assets/{manifest,rendering,report,runtime,package-graph}.mjs` |
| `src/compatibility-matrix.mjs` (1204) | `src/compatibility/matrix/{rows,evidence,report,execution,published-data}.mjs` |
| `src/conformance-fixtures.mjs` (700) | `src/compatibility/fixtures/{families,report,execution}.mjs` |
| `src/evidence-currency.mjs` | `src/compatibility/registry/currency.mjs` |
| `src/registry-divergence.mjs` | `src/compatibility/registry/divergence.mjs` |
| `src/golden-path.mjs` | `src/compatibility/registry/golden-path.mjs` |
| `scripts/assemble-release-candidate.mjs` (report body) | `src/compatibility/registry/release-candidate.mjs` |

### Scripts

| old path | new path |
|---|---|
| `scripts/run-compatibility-lab.mjs` | `scripts/compatibility/lab.mjs` |
| `scripts/run-compatibility-matrix.mjs` | `scripts/compatibility/matrix.mjs` |
| `scripts/run-phase-2-compatibility.mjs` | `scripts/compatibility/risk-profiles.mjs` |
| `scripts/run-phase-3-compatibility.mjs` | `scripts/compatibility/mixed-generation.mjs` |
| `scripts/run-phase-4-compatibility.mjs` | `scripts/compatibility/additive-fixes.mjs` |
| `scripts/run-phase-6-compatibility.mjs` | `scripts/compatibility/published-pair.mjs` |
| `scripts/run-phase-4-host-examples.mjs` | `scripts/compatibility/host-assets.mjs` |
| `scripts/run-conformance-fixtures.mjs` | `scripts/compatibility/fixtures.mjs` |
| `scripts/run-golden-path.mjs` | `scripts/compatibility/golden-path.mjs` |
| `scripts/run-registry-divergence.mjs` | `scripts/compatibility/divergence.mjs` |
| `scripts/run-evidence-currency.mjs` | `scripts/compatibility/currency.mjs` |
| `scripts/run-cross-generation-probe.mjs` | `scripts/compatibility/cross-generation-probe.mjs` |
| `scripts/run-renamed-pair-proof.mjs` | `scripts/compatibility/renamed-pair-proof.mjs` |
| `scripts/assemble-release-candidate.mjs` | `scripts/compatibility/release-candidate.mjs` |
| — | `scripts/compatibility/arguments.mjs` (new: the shared parser, see §6) |

### Tests

| old path | new path |
|---|---|
| `tests/phase-2-compatibility.test.mjs` | `tests/compatibility/suites/risk-profile-evidence-validity/index.test.mjs` |
| `tests/phase-3-compatibility.test.mjs` | `tests/compatibility/suites/mixed-generation-negotiation/index.test.mjs` |
| `tests/phase-4-compatibility.test.mjs` | `tests/compatibility/suites/additive-enforcement-fixes/index.test.mjs` |
| `tests/phase-6-compatibility.test.mjs` | `tests/compatibility/suites/published-artifact-differential/index.test.mjs` |
| `tests/phase-4-host-examples.test.mjs` | `tests/compatibility/host-assets/report.test.mjs` |
| `tests/compatibility-matrix.test.mjs` | `tests/compatibility/matrix/{rows,report,evidence}.test.mjs` |
| `tests/conformance-fixtures.test.mjs` | `tests/compatibility/fixtures/report.test.mjs` |
| `tests/compatibility-data.test.mjs` | `tests/compatibility/matrix/published-data.test.mjs` |
| `tests/evidence-currency.test.mjs` | `tests/compatibility/registry/currency.test.mjs` |
| — | `tests/compatibility/engine/isolation.test.mjs` (new: R5 enforcement) |

---

## 3. Exported symbols renamed

No `PHASE_N` symbol survives anywhere.

| old symbol | new symbol |
|---|---|
| `PHASE_2_COMPATIBILITY_DEFINITION` / `_SHA256` | `RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION` / `_SHA256` |
| `createPhase2CompatibilityReport` | `createRiskProfileEvidenceValidityReport` |
| `verifyPhase2CompatibilityReport` | `verifyRiskProfileEvidenceValidityReport` |
| `runPackedPhase2Compatibility` | `runPackedRiskProfileEvidenceValidity` |
| `PHASE_3_COMPATIBILITY_DEFINITION` / `_SHA256` | `MIXED_GENERATION_NEGOTIATION_DEFINITION` / `_SHA256` |
| `PHASE_3_EXPECTED_SEMANTICS` (private) | `MIXED_GENERATION_OBSERVATIONS` (exported) |
| `createPhase3CompatibilityReport` | `createMixedGenerationNegotiationReport` |
| `verifyPhase3CompatibilityReport` | `verifyMixedGenerationNegotiationReport` |
| `runPackedPhase3Compatibility` | `runPackedMixedGenerationNegotiation` |
| `PHASE_4_COMPATIBILITY_DEFINITION` / `_SHA256` | `ADDITIVE_ENFORCEMENT_FIXES_DEFINITION` / `_SHA256` |
| `PHASE_4_EXPECTED_SEMANTICS` (private) | `ADDITIVE_ENFORCEMENT_OBSERVATIONS` (exported) |
| `createPhase4CompatibilityReport` | `createAdditiveEnforcementFixesReport` |
| `verifyPhase4CompatibilityReport` | `verifyAdditiveEnforcementFixesReport` |
| `runPackedPhase4Compatibility` | `runPackedAdditiveEnforcementFixes` |
| `observedPhase4Semantics` | `observedAdditiveEnforcementSemantics` |
| `PHASE_6_COMPATIBILITY_DEFINITION` / `_SHA256` | `PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION` / `_SHA256` |
| `createPhase6CompatibilityReport` | `createPublishedArtifactDifferentialReport` |
| `verifyPhase6CompatibilityReport` | `verifyPublishedArtifactDifferentialReport` |
| `runPackedPhase6Compatibility` | `runPackedPublishedArtifactDifferential` |
| `createPhase4HostExamplesReport` | `createHostAssetsReport` |
| `verifyPhase4HostExamplesReport` | `verifyHostAssetsReport` |
| `runPackedPhase4HostExamples` | `runPackedHostAssets` |

Unchanged: `COMPATIBILITY_MATRIX_ROWS`, `COMPATIBILITY_MATRIX_SHA256`,
`DELIBERATELY_UNSUPPORTED_CASES`, `selectCompatibilityMatrixRows`,
`stableExecutionEvidence`, `createCompatibilityMatrixReport`,
`verifyCompatibilityMatrixReport`, `runPackedCompatibilityMatrix`,
`REQUIRED_FIXTURES`, `createConformanceFixtureReport`,
`verifyConformanceFixtureReport`, `runConformanceFixtures`, `CRITICAL_PATHS`,
`measureEvidenceCurrency`, `createEvidenceCurrencyReport`,
`verifyEvidenceCurrencyReport`, `measureDivergence`, `createDivergenceReport`,
`verifyDivergenceReport`, `GOLDEN_PATH_STEPS`, `runGoldenPath`,
`createGoldenPathReport`, `verifyGoldenPathReport`.

---

## 4. Definition hashes — R2 held

All four measured after the move, byte-identical to before:

| suite | definition sha256 |
|---|---|
| risk-profile-evidence-validity | unchanged from `PHASE_2_COMPATIBILITY_SHA256` |
| mixed-generation-negotiation | unchanged from `PHASE_3_COMPATIBILITY_SHA256` |
| additive-enforcement-fixes | unchanged from `PHASE_4_COMPATIBILITY_SHA256` |
| published-artifact-differential | `155bdf2cc0930acd507c1f64103ed980119180465e231f3aa03795b4d3d08daa` |
| compatibility matrix | unchanged from `COMPATIBILITY_MATRIX_SHA256` |

**`docs/compatibility.md:240` needs NO change.** The phase-6 hash it pins is
identical, and `tests/documentation.test.mjs:84` still passes. A new test,
`tests/compatibility/suites/published-artifact-differential/index.test.mjs`,
asserts that literal too, so the document and the code now fail together rather
than drifting apart.

---

## 5. Report `schemaVersion` strings changed

These identify a document FORMAT, not a file or a symbol, so R2 does not govern
them — but R0 says no `phase-N` survives anywhere, and no committed report
depends on them any more (the `evidence/` directory is gone). Nothing outside
Slice B referenced any of these; verified by grep before changing.

| old | new |
|---|---|
| `visp.phase-2-compatibility.evidence.v1` | `visp.risk-profile-evidence-validity.evidence.v1` |
| `visp.phase-3-compatibility.evidence.v1` | `visp.mixed-generation-negotiation.evidence.v1` |
| `visp.phase-4-compatibility.evidence.v1` | `visp.additive-enforcement-fixes.evidence.v1` |
| `visp.phase-6-compatibility.v2` | `visp.published-artifact-differential.v2` |
| `visp.phase-4-host-examples.v2` | `visp.host-asset-rendering.v2` |
| `visp.phase-2-compatibility.error.v1` | `visp.risk-profile-evidence-validity.error.v1` |
| `visp.phase-3-compatibility.error.v1` | `visp.mixed-generation-negotiation.error.v1` |
| `visp.phase-4-host-examples.error.v1` | `visp.host-asset-rendering.error.v1` |
| package name `visp-phase-4-runtime-install` | `visp-host-assets-runtime-install` |

`visp.compatibility-matrix.evidence.v1`, `visp.compatibility-matrix.debug.v1`,
`visp.conformance-fixtures.v1`/`.v2`, `visp.golden-path.v1`,
`visp.registry-divergence.v1`, `visp.evidence-currency.v1` and
`visp.release-candidate.v1`/`.v2` carry no phase number and are unchanged.

`compatibility.json` still uses `phase-2` … `phase-6` as PAIR IDS and still
names `evidence/*.json` paths. That file is Slice C's; the ids are data about
which historical pin proved which pair, and
`tests/compatibility/matrix/published-data.test.mjs` reads them as such. **If C
renames those ids, that test must be updated in the same commit.**

---

## 6. Behaviour changes, all deliberate

1. **`--verify` requires an explicit path** in every compatibility entrypoint.
   See §1.
2. **Argument parsing is uniform and strict.** Three different parsers existed;
   `scripts/compatibility/arguments.mjs` replaces them. Unknown flags are now
   rejected everywhere — the published-pair and fixtures scripts used to ignore
   them silently, so a typo'd `--offline-stor` produced a run with a missing
   input rather than an error.
3. **`--keep` now reports the retained root on the FAILURE path too.** One suite
   attached it only on success, which deleted the scratch tree in exactly the
   case a human wanted it.
4. **`published-artifact-differential` validates `keepOwnedRoot`'s type** and
   rejects a non-plain-object runner input, which its predecessor did not.
5. **`conformance-fixtures` and `published-pair` no longer print a trailing
   blank line** after the report; `canonicalStringify` already ends in `\n`.
6. **The MCP `availability` check is now explicit.** The oldest pinned pair's
   Hyper predates the field, so `risk-profile-evidence-validity` passes
   `requireAvailability: false`. Every later suite requires it, as before. If
   this had been unified silently, the oldest suite would have started failing
   at runtime for a reason unrelated to what it proves.
7. **Reviewer names in the prepared evidence changed**
   (`phase-3-compatibility-reviewer` -> `mixed-generation-compatibility-reviewer`,
   and equivalents). These feed `reviewDecision.decisionHash`, which no suite
   pins. Run-goal and step-label strings changed the same way.
8. **`src/compatibility/registry/release-candidate.mjs` is new**: the report body
   moved out of the script so the entrypoint is 53 lines instead of 232. The
   report content is unchanged except one string — "the Phase 6 evaluation gates
   have not run" is now "the evaluation gates have not run".

---

## 7. Deviations from the brief, and why

1. **The isolation test needed a source module.** The brief asked for
   `tests/compatibility/suite-isolation.test.mjs`, which R0 rule 6 forbids —
   `tests/maintenance/naming.test.mjs` requires every test to mirror a source
   module or be listed in `SUITES_WITHOUT_A_MODULE` (Slice A's file). So the
   check lives in `src/compatibility/engine/isolation.mjs` and the test is
   `tests/compatibility/engine/isolation.test.mjs`. The test includes a case
   that builds a synthetic cross-suite import and asserts it IS caught, so a
   green result means something.
2. **Two extra engine modules.** `isolation.mjs` (above) and the row validators
   `verifyReviewDecision` / `verifyAssuranceActionView`, which are shared by two
   suites and therefore cannot live in either (R5). They are in `engine/shape.mjs`,
   which the target tree calls "row validators".
3. **`host-assets/package-graph.mjs` is a fifth file** in a domain the brief gave
   four. `runtime.mjs` landed at 575 lines; the ceiling is 400.
4. **`matrix/published-data.mjs` is a fifth file** in that domain. It exists so
   the hand-maintained `compatibility.json` has a guard rather than only a test
   — its generator is deleted, and the test that used to prove it was generated
   is deleted with it.
5. **`scripts/compatibility/arguments.mjs` is not an entrypoint.** It is the
   shared parser the fourteen entrypoints use. Without it each script carried a
   ~35-line copy of the same loop.
6. **Three scripts remain over ~150 lines**: `renamed-pair-proof.mjs` (212),
   `cross-generation-probe.mjs` (174), `release-candidate.mjs` (53 after the
   split, listed for completeness). The first two are linear probes whose body IS
   the measurement — splitting them into module plus script would add indirection
   without reducing what a reader must read. Flagged rather than forced.

---

## 8. Assertions that changed or moved, and what each is traceable to

| assertion | file | what happened |
|---|---|---|
| `compatibility.json is derived from the committed evidence` | was `tests/compatibility-data.test.mjs:10` | DELETED. It called `buildCompatibility()` from `scripts/generate-compatibility.mjs`, deleted by the evidence removal. The file is now hand-maintained on purpose, so the assertion would be false. |
| `each pair names the evidence file that proves it` | was `tests/compatibility-data.test.mjs:103` | REDUCED. It opened each `evidence/*.json` and compared hashes; that directory is gone. The path-shape and digest-shape checks survive. |
| `legacy generated platform evidence still verifies` | was `tests/conformance-fixtures.test.mjs:150` | REBUILT. It read `evidence/conformance-fixtures-linux-x64-node24.json`. The v1 reader survives (R4) and is now exercised against a legacy-shaped report built in memory, plus a new case proving a v1 report cannot smuggle in a run identity. |
| `Phase 4 accepted evidence verifies` and 3 other `accepted()` cases | was `tests/phase-4-compatibility.test.mjs` | REBUILT on a synthetic input, as the brief directed. The SHA256 shape test and the create→verify round trip are kept; the `EVIDENCE` constant is gone. |
| `the committed report is genuine packed D-107 evidence` | was `tests/phase-6-compatibility.test.mjs:47` | DELETED with `evidence/phase-6-pair-linux-x64-node24.json`. Replaced by a case asserting a synthetic report can NEVER claim `producer: "packed-runner"`. |
| `one closed runtime lock template materializes…` | was `tests/compatibility-matrix.test.mjs:72` | MOVED, temporarily, to `tests/compatibility/matrix/evidence.test.mjs`. `materializeRuntimeInstallLock` now lives in `src/toolchain/runtime-lock.mjs` and Slice A added no test for it. **Slice C: move this case to `tests/toolchain/runtime-lock.test.mjs`.** |

Net new assertions: the R5 isolation suite (5 cases), the
`compatibility.json` shape guard and its self-check, the observation-derivation
round trip for `additive-enforcement-fixes`, a run-identity rejection case for
two suites, the Copilot-frontmatter case, and the `stableExecutionEvidence`
input-validation case.

---

## 9. Cross-slice edits Slice B made

Both were flagged by Slice A's ledger §5 as "B must update them".

| file | change |
|---|---|
| `.github/workflows/renamed-pair-proof.yml:106` | `scripts/run-renamed-pair-proof.mjs` -> `scripts/compatibility/renamed-pair-proof.mjs` |
| `tests/toolchain/lab.test.mjs:140,177` | `../../scripts/run-compatibility-lab.mjs` -> `../../scripts/compatibility/lab.mjs` |

---

## 10. `tests/documentation.test.mjs` — Slice C must repoint it

That file is Slice C's and it currently imports four modules Slice B deleted.
It is 1 of the 11 remaining suite failures. The exact edits:

| line | current | replacement |
|---|---|---|
| 6–8 | `COMPATIBILITY_MATRIX_ROWS`, … from `../src/compatibility-matrix.mjs` | same names from `../src/compatibility/matrix/rows.mjs` |
| 9 | `PHASE_3_COMPATIBILITY_DEFINITION` from `../src/phase-3-compatibility.mjs` | `MIXED_GENERATION_NEGOTIATION_DEFINITION` from `../src/compatibility/suites/mixed-generation-negotiation/index.mjs` |
| 10 | `PHASE_4_COMPATIBILITY_DEFINITION` from `../src/phase-4-compatibility.mjs` | `ADDITIVE_ENFORCEMENT_FIXES_DEFINITION` from `../src/compatibility/suites/additive-enforcement-fixes/index.mjs` |
| 11–14 | `PHASE_6_COMPATIBILITY_DEFINITION`, `PHASE_6_COMPATIBILITY_SHA256` from `../src/phase-6-compatibility.mjs` | `PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION`, `PUBLISHED_ARTIFACT_DIFFERENTIAL_SHA256` from `../src/compatibility/suites/published-artifact-differential/index.mjs` |
| 39 | asserts README names `run-phase-3-compatibility.mjs` | `scripts/compatibility/mixed-generation.mjs` |
| 42 | asserts README names `run-phase-6-compatibility.mjs` … `--output <new-phase-6-report-path>` | `scripts/compatibility/published-pair.mjs` … `--output <new-published-pair-report-path>` |

The values those assertions compare (commits, trees, schema hashes, and the
`155bdf2c…` definition digest at line 84) are all UNCHANGED, so `docs/compatibility.md`
needs no edit. Only the import paths, the symbol names and the two README
command names move. README itself must be updated to match, since lines 39 and
42 read it.

---

## 10b. `.github/workflows/test.yml` — Slice C must repoint two steps

Slice B owns `renamed-pair-proof.yml` only. `test.yml` invokes two scripts that
moved:

| line | current | replacement |
|---|---|---|
| 229 | `node scripts/run-conformance-fixtures.mjs \` | `node scripts/compatibility/fixtures.mjs \` |
| 292 | `node scripts/run-evidence-currency.mjs \` | `node scripts/compatibility/currency.mjs \` |

Both keep every flag they already pass. Line 292's job is the one
`tests/compatibility/registry/currency.test.mjs` asserts has `fetch-depth: 0` on
its two engine checkouts — do not renumber those steps without re-running that
test.

---

## 11. Shims: Slice B has repointed

Nothing under `src/compatibility/**`, `scripts/compatibility/**` or
`tests/compatibility/**` imports either transition shim. Both can be deleted as
far as Slice B is concerned:

- `src/compatibility-lab.mjs` — repointed onto `src/toolchain/index.mjs` and
  `src/platform/canonical-json.mjs`.
- `src/canonical-json.mjs` — Slice B never imported it.

### One gap in Slice A's barrel

`src/compatibility/matrix/evidence.mjs` imports `scenarioRunExact` from
`src/toolchain/project-fixture.mjs` DIRECTLY, because the barrel does not export
it. It must not use the barrel's `runExact`: the matrix's runner is 30 s and the
barrel's is 120 s, and every pinned matrix row was produced under the 30 s one.
The same file uses `parseExactFrame`, never `parseFrame`, for the same reason.
Slice A should either add `scenarioRunExact` to the barrel or bless the direct
import.
