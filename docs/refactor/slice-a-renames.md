# Slice A rename ledger

Everything Slice A moved, renamed or published, and everything another slice has
to change because of it. Slice C applies the npm-script and `exports` rows; Slice
B repoints its imports from the rows in "Symbols that moved".

Naming follows R0 as amended: kebab-case, noun-named, directory supplies context,
no verb prefixes in `scripts/`, barrels are `index.mjs`, tests mirror the source
path. The single exemption is `scripts/visp-dev.mjs`.

---

## 1. Files moved or created

### `src/platform/` — new

| old path | new path |
|---|---|
| `src/canonical-json.mjs` (`canonicalise`, `hashOf`, recipe strings) | `src/platform/canonical-json.mjs` |
| `src/compatibility-lab.mjs` (`canonicalStringify`, `sha256Hex`, `sortJson`) | `src/platform/canonical-json.mjs` |
| `deepFreeze`, copy-pasted into 6 files | `src/platform/freeze.mjs` |
| `plainObject`/`plain`, `exactKeys`, `exactValue`, `exactArray`, `HASH`, `PREFIXED_HASH`, `COMMIT`, `verifyHash`, `verifyCommit`, duplicated across 6 files | `src/platform/shape.mjs` |

Both canonical-JSON recipes live in ONE file with a header saying why they must
never converge (R1), and `tests/platform/canonical-json.test.mjs` asserts they
produce different strings and different digests for the same input.

### `src/toolchain/` — new, extracted from `src/compatibility-lab.mjs` (2081 lines, now a shim)

| new path | lines | what it owns |
|---|---|---|
| `src/toolchain/index.mjs` | 118 | the barrel B and C import — see §3 |
| `src/toolchain/process.mjs` | 375 | `runProcess`, output collector, command validation, `resolveSpawn`, `findExecutable`, `stableEnvironment`, `runChecked`, `runExact`, `requireZero`, `trimLine` |
| `src/toolchain/owned-root.mjs` | 76 | `createOwnedRoot`, `cleanupOwnedRoot`, `findOwnedRoot`, `requireOwnedPath`, `isWithin` |
| `src/toolchain/git-snapshot.mjs` | 189 | `runGit`, `resolveCommit`, `snapshotCommit`, `snapshotFidelityAvailable` |
| `src/toolchain/manifest.mjs` | 46 | `normalizeBins`, `packageIdentity` — **not in the original brief**, see §6 |
| `src/toolchain/npm-environment.mjs` | 118 | `npmEnvironment`, `cacheInventory`, `prepareOfflineCache`, `snapshotOfflineStore` — **not in the original brief**, see §6 |
| `src/toolchain/npm-pack.mjs` | 302 | `packPackageTwice`, `assertMatchingPacks`, `packageSnapshot`, `readPackedManifest`, `preparePackageSnapshot` |
| `src/toolchain/npm-install.mjs` | 163 | `installLocalTarball`, `inspectInstalledBins`, `runInstalledBin` |
| `src/toolchain/lockfile/semver.mjs` | 83 | version and spec parsing, `validatePackageName` |
| `src/toolchain/lockfile/npm.mjs` | 299 | `prepareOfflineInstallLock`, `normalizeDependencyTree`, `installedDependencyTree` |
| `src/toolchain/lockfile/pnpm.mjs` | 329 | `preparedDependencyTree` and the pnpm tree normaliser |
| `src/toolchain/lockfile/pnpm-edges.mjs` | 129 | manifest reading and edge classification — **split out because `pnpm.mjs` landed at 441 lines**, over the 400 ceiling |
| `src/toolchain/lockfile/graph.mjs` | 64 | `verifyInstalledLockGraph` |
| `src/toolchain/runtime-lock.mjs` | 89 | `materializeRuntimeInstallLock`, lifted from `src/compatibility-matrix.mjs` |
| `src/toolchain/pair-install.mjs` | 189 | `packAndInstall`, `defaultBinName`, `toolVersion`, `pathCommand`, `executionEnvironment`, lifted from `src/phase-2-compatibility.mjs` |
| `src/toolchain/project-fixture.mjs` | 338 | `createRealProject` (from phase-2), `createScenarioProject` (from the matrix), `readArtifactBinding` |
| `src/toolchain/cli-output.mjs` | 122 | `parseJson`, `parseJsonOutput`, `parseFrame`, `parseExactFrame`, `parseLegacyAction`, `parseHyperEnvelope`, `parseAuthorityStopReason`, `canonicalActionAbsent`, `requireCompleted` |
| `src/toolchain/lab.mjs` | 172 | `runCompatibilityLab` — **not named in the brief**, but the function had to land somewhere |

Renamed per R0: `verify-graph.mjs` -> `graph.mjs`, `npm-lock.mjs` -> `npm.mjs`,
`pnpm-tree.mjs` -> `pnpm.mjs`.

### `src/cli/` — split from `src/cli.mjs` (471 lines, now deleted)

| old | new |
|---|---|
| `src/cli.mjs` `detectTool`, `collectEnvironment`, `nodeSatisfies` | `src/cli/environment.mjs` |
| `src/cli.mjs` `readCompatibility`, `supportedPair`, `installability`, `supportedNodeRanges`, `releaseInstallRecovery`, `deprecatedInstallRecovery` | `src/cli/installability.mjs` |
| `src/cli.mjs` `doctor` | `src/cli/doctor.mjs` |
| `src/cli.mjs` `versions` | `src/cli/versions.mjs` |
| `src/cli.mjs` `init` | `src/cli/init.mjs` |
| `src/cli.mjs` `formatDoctor`, `formatInit`, `formatVersions`, `noReleaseReason` | `src/cli/format.mjs` |
| `scripts/visp-dev.mjs` `USAGE`, `parse` | `src/cli/argv.mjs` |
| `src/machine-scope.mjs` | `src/cli/machine-scope.mjs` |

`scripts/visp-dev.mjs` stays at its path (published `bin`) and is now a 51-line
entrypoint.

### `scripts/maintenance/`

| old | new |
|---|---|
| `scripts/check-workspace-layout.mjs` | `scripts/maintenance/workspace-layout.mjs` |
| `scripts/generate-sbom.mjs` | `scripts/maintenance/sbom.mjs` |
| `scripts/maintenance/check-syntax.mjs` | `scripts/maintenance/syntax.mjs` |

### Tests

| old | new |
|---|---|
| `tests/canonical-json.test.mjs` | `tests/platform/canonical-json.test.mjs` |
| — | `tests/platform/freeze.test.mjs` (new) |
| — | `tests/platform/shape.test.mjs` (new) |
| `tests/compatibility-lab.test.mjs` (2008 lines) | split into the eight files below |
| " | `tests/toolchain/git-snapshot.test.mjs` |
| " | `tests/toolchain/process.test.mjs` |
| " | `tests/toolchain/npm-pack.test.mjs` |
| " | `tests/toolchain/npm-install.test.mjs` |
| " | `tests/toolchain/owned-root.test.mjs` |
| " | `tests/toolchain/lab.test.mjs` |
| " | `tests/toolchain/lockfile/npm.test.mjs` |
| " | `tests/toolchain/lockfile/pnpm.test.mjs` |
| " (fixture builders, lines 31–726) | `tests/helpers/toy-package.mjs`, `tests/helpers/prepared-graph.mjs`, `tests/helpers/pnpm-scenario.mjs` |
| `tests/cli.test.mjs` | split across `tests/cli/installability.test.mjs`, `versions.test.mjs`, `format.test.mjs`, `doctor.test.mjs` |
| `tests/actionable-guidance.test.mjs` | split across `tests/cli/installability.test.mjs` and `tests/cli/argv.test.mjs` |
| `tests/doctor-identity.test.mjs` | `tests/cli/environment.test.mjs` |
| `tests/machine-scope.test.mjs` | `tests/cli/machine-scope.test.mjs` |
| `tests/hostile-paths.test.mjs` | `tests/cli/hostile-paths.test.mjs` |
| `tests/seams.test.mjs` | `tests/maintenance/seams.test.mjs` |
| `tests/workspace-layout.test.mjs` | `tests/maintenance/workspace-layout.test.mjs` |
| — | `tests/cli/argv.test.mjs` (new: argv parsing had no test) |
| — | `tests/maintenance/naming.test.mjs` (new: R0 enforcement) |

---

## 2. Symbols that moved — what Slice B repoints

Everything below is re-exported from `src/toolchain/index.mjs`, so the usual
repoint is one import line. `src/compatibility-lab.mjs` re-exports the whole
barrel today, so B's files keep working until they move.

| symbol | was | now import from |
|---|---|---|
| `canonicalStringify`, `sha256Hex` | `src/compatibility-lab.mjs` | `src/platform/canonical-json.mjs` or the barrel |
| `canonicalise`, `hashOf`, `CANONICAL_HASH_RECIPE`, `BROKEN_ARRAY_REPLACER_RECIPE` | `src/canonical-json.mjs` | `src/platform/canonical-json.mjs` |
| `deepFreeze` (6 private copies) | inline | `src/platform/freeze.mjs` |
| `plain`/`plainObject`, `exactKeys`, `exactValue`, `exactArray` (6 private copies) | inline | `src/platform/shape.mjs` |
| `HASH`, `PREFIXED_HASH`, `COMMIT` (4 private copies) | inline | `src/platform/shape.mjs` |
| `verifyHash`, `verifyCommit` | `src/evidence-identity.mjs` (already deleted) | `src/platform/shape.mjs` |
| `runProcess`, `createOwnedRoot`, `cleanupOwnedRoot`, `resolveCommit`, `snapshotCommit`, `snapshotFidelityAvailable`, `packPackageTwice`, `assertMatchingPacks`, `installLocalTarball`, `inspectInstalledBins`, `runInstalledBin`, `runCompatibilityLab` | `src/compatibility-lab.mjs` | `src/toolchain/index.mjs` |
| `materializeRuntimeInstallLock` | `src/compatibility-matrix.mjs` | `src/toolchain/runtime-lock.mjs` |
| `packAndInstall`, `defaultBinName`, `toolVersion`, `pathCommand`, `executionEnvironment`, `runExact`, `requireZero`, `parseJson`, `parseFrame`, `requireCompleted`, `createRealProject`, `readArtifactBinding` | `src/phase-2-compatibility.mjs` | `src/toolchain/index.mjs` |
| `createScenarioProject`, `parseJsonOutput`, `parseLegacyAction`, `parseHyperEnvelope`, `parseAuthorityStopReason`, `canonicalActionAbsent` | private in `src/compatibility-matrix.mjs` | `src/toolchain/index.mjs` |

### Two name changes B must apply deliberately

1. **`parseFrame` is the phase-2 regex parser.** The matrix's private
   `parseFrame` used `indexOf` and different acceptance, and is exported as
   **`parseExactFrame`**. `parseLegacyAction` / `parseHyperEnvelope` already use
   the exact variant, so they are unchanged. If B repoints the matrix's
   `parseFrame` calls to the barrel's `parseFrame`, behaviour changes.
2. **`exactValue` / `exactArray` take a 4th `drift` argument.** Defaults are
   `"drifted from its frozen definition"` and `"does not match the frozen matrix"`.
   To preserve today's messages, the pinned-suite callers must pass their own:
   phase-2 passed `"drifted from the Phase 2 definition"` and phase-6 passed
   `"drifted from the frozen Phase 6 definition"` — both of which need renaming
   for R0 anyway, so pick the new suite name.

### Deliberately NOT unified — do not "finish the job"

The matrix's `runExact` (30 s), `pathCommand` (no PATHEXT), `requireZero`
(async, no observation) and `executionEnvironment` differ from the phase-2
versions of the same names. Every pinned matrix row was produced under one exact
pairing. They are kept as module-private helpers inside
`src/toolchain/project-fixture.mjs` (`scenarioRunExact`, `scenarioPathCommand`,
`scenarioRequireZero`, `scenarioEnvironment`) and are **not** merged with the
barrel's versions. Merging them changes timeouts and failure payloads under
pins that cannot be recomputed.

---

## 3. The barrel's export list — frozen contract

`src/toolchain/index.mjs`, 67 names. The brief pointed at an "ARCHITECTURE.md
section: Slice A exported interface" that does not exist in the document, so
this list was derived from the union of what `src/compatibility-lab.mjs` and
`src/phase-2-compatibility.mjs` exported plus the matrix privates the brief
named. Flagged to the coordinator.

```
DEFAULT_MAX_OUTPUT_BYTES DEFAULT_TIMEOUT_MS assertMatchingPacks assertPlainRecord
cacheInventory canonicalActionAbsent canonicalStringify cleanupOwnedRoot compareText
compareVersions createOwnedRoot createRealProject createScenarioProject defaultBinName
executionEnvironment findExecutable findOwnedRoot inspectInstalledBins installLocalTarball
installedDependencyTree isWithin materializeRuntimeInstallLock normalizeBins
normalizeDependencyTree npmEnvironment packAndInstall packPackageTwice packageIdentity
packageSnapshot parseAuthoredDependencySpec parseAuthorityStopReason parseExactFrame
parseFrame parseHyperEnvelope parseJson parseJsonOutput parseLegacyAction
parseStableExactVersion pathCommand prepareOfflineCache prepareOfflineInstallLock
preparedDependencyTree readArtifactBinding readPackedManifest rejectUnknownKeys
requireCompleted requireOwnedPath requireZero resolveCommit resolveSpawn runChecked
runCompatibilityLab runExact runGit runInstalledBin runProcess sha256Hex snapshotCommit
snapshotFidelityAvailable snapshotOfflineStore stableEnvironment toolVersion trimLine
validateExactVersion validatePackageName verifyInstalledLockGraph versionSatisfiesSpec
```

---

## 4. npm scripts and package.json — Slice C applies

| key | current value | new value |
|---|---|---|
| `scripts.pretest` | `node scripts/check-workspace-layout.mjs` | `node scripts/maintenance/workspace-layout.mjs` |
| `scripts.syntax` | `node scripts/maintenance/check-syntax.mjs` | `node scripts/maintenance/syntax.mjs` |
| `scripts.sbom` | `node scripts/generate-sbom.mjs` | `node scripts/maintenance/sbom.mjs` |
| `scripts.sbom:check` | `node scripts/generate-sbom.mjs --check` | `node scripts/maintenance/sbom.mjs --check` |
| `exports` | `{"./machine-scope": "./src/machine-scope.mjs"}` | `{"./machine-scope": "./src/cli/machine-scope.mjs"}` |

`files` needs no change: `src` and `scripts` are listed as directories.

`scripts.test` and `scripts.test:coverage` are already directory globs
(`tests/**/*.test.mjs`) and pick up the new subdirectories with no edit.

### README / docs references Slice C owns

- `README.md` line ~205 and ~212 name `scripts/check-workspace-layout.mjs`.
- `tests/maintenance/workspace-layout.test.mjs` still asserts the README names
  `visp-dev/engines/<name>` for each sibling. The current README rewrite dropped
  those three literal paths and that test now fails. Slice C: either restore the
  three paths or change the assertion deliberately, not both by accident.

---

## 5. Cross-slice references left pointing at Slice B paths

These are correct today and will break when B renames. B must update them, or
tell the coordinator to.

| file | reference |
|---|---|
| `tests/toolchain/lab.test.mjs:140,177` | `../../scripts/run-compatibility-lab.mjs` |

---

## 6. Deviations from the brief, and why

1. **Two modules the brief did not name.** `manifest.mjs` (`normalizeBins`,
   `packageIdentity`) and `npm-environment.mjs` (`npmEnvironment`,
   `cacheInventory`, `prepareOfflineCache`, `snapshotOfflineStore`). Putting
   them where the brief said produced two import cycles:
   `npm-pack -> npm-install -> npm-pack` and
   `lockfile/npm -> npm-pack -> lockfile/pnpm -> lockfile/npm`. Both are leaf
   modules; both are re-exported from the barrel under the names the brief gave.
2. **`lab.mjs`.** `runCompatibilityLab` was exported by `compatibility-lab.mjs`
   and the brief listed no home for it.
3. **`lockfile/pnpm-edges.mjs`.** `pnpm.mjs` landed at 441 lines; the brief says
   split again over 400.
4. **`tests/maintenance/naming.test.mjs` carries an exemption list.** R0 rule 6
   as written ("nothing in tests/ except mirrors and tests/helpers/") has no
   home for `seams.test.mjs` (compares sibling repositories, no local module),
   `hostile-paths.test.mjs` (drives the published binary end to end),
   `documentation.test.mjs` (checks prose), or the naming test itself. Rather
   than weaken the rule, the test requires each such file to be named
   individually in `SUITES_WITHOUT_A_MODULE`, and a further test asserts every
   exempted path still exists so the list cannot rot. Flagged to the
   coordinator as a gap in R0 rule 6.

## 7. Strings changed while de-phasing lifted code

None of these is asserted by any test (checked by grep before changing).

| where | was | now |
|---|---|---|
| `pair-install.mjs` | `Phase 2 ${kind} source identity drifted during packing` | `Pair ${kind} source identity drifted during packing` |
| `pair-install.mjs` | temp prefix `visp-phase-2-cli-output-` | `visp-pair-cli-output-` |
| `pair-install.mjs` | `Required Phase 2 executable unavailable` | `Required pair executable unavailable` |
| `project-fixture.mjs` | step labels `Phase 2 Kit initialization` etc. | `Fixture Kit initialization` etc. |
| `project-fixture.mjs` | fixture package name `phase-2-${profile}-fixture` | `${profile}-profile-fixture` |
| `cli/installability.mjs` | `...candidate, Phase 6, and same-run platform evidence yet.` | `...candidate, published-pair, and same-run platform evidence yet.` |

The fixture package name feeds only produced-then-verified artifact hashes that
are recomputed each run — no committed pin. If B finds a suite that pins it,
revert that one row.

## 8. Dropped assertions, and the deletion each is traceable to

| test | file | why |
|---|---|---|
| `the freeze manifest hash covers nested fields too` | was `tests/canonical-json.test.mjs` | imported `manifestHashOf` from `src/temporal-capture.mjs`, deleted outright by the contract's evidence removal. The module is already gone from the branch. |

No other assertion was removed. Everything else was reorganised only.
