# Visp Dev

## The problem

An AI coding agent will happily tell you it is done. It writes the code, runs
the tests it just wrote, and reports success. What it cannot tell you is whether
the change was in scope, whether the evidence proves anything, or whether the
tests were strong enough to have failed.

Visp makes that reviewable. Kit decides what is allowed and what counts as
proof; Hyper renders it for your coding host; Visp Dev is the thin shell that
gets you a compatible setup and tells you the exact next command.

Visp Dev decides nothing. It holds no workflow state and computes no evidence.
If it ever starts to, it has become a second engine and the boundary has failed.

## Five-minute start

```bash
npm install -g visp-kit visp-hyper-agent
```

That installs what npm currently serves: `visp-kit@0.4.0` and
`visp-hyper-agent@0.7.0`, the unified-surface pair. **Do not pin the older
`visp-kit@0.2.3`** — it declares the `visp` command that
`visp-hyper-agent@0.7.0` now provides, and whichever installs last silently
wins the name. Remove an older global pair first with
`npm uninstall -g visp-kit visp-hyper-agent`.

This matrix has not re-run against the 0.4.0 / 0.7.0 pair, so it makes **no
support claim** about it and `doctor` will not recommend a release. What it will
do is refuse to point you at the superseded pair.

```bash
node scripts/visp-dev.mjs doctor     # what you have, what is missing, what to run
node scripts/visp-dev.mjs versions   # the supported pairs, pinned by commit
node scripts/visp-dev.mjs init       # the exact steps for this project
```

`doctor` also tells you if a **deprecated** Visp is on your PATH, which matters
more than it sounds: `visp-kit@0.1.0` predates the fixes that close four
policy-bypass holes.

A version number is how you obtain Visp; it is not what carries the proof. Every
claim here pins **commits and tarball hashes**. See [Limitations](#limitations).

Once Kit and Hyper are on your PATH, the workflow is Kit's, not ours:

```bash
visp init .
visp scan .
visp next .
```

Hyper renders for Codex, Claude Code, Copilot, OpenCode, and a generic MCP
target, driven by versioned capability manifests rather than assumptions. A host
that lacks a capability gets honest sequential or Git/CI fallback guidance
instead of a broken integration.

## Limitations

Stated plainly, because a compatibility product that oversells is worse than
none.

- **No release is currently recommended.** The evidenced pair
  (`visp-kit@0.2.3` / `visp-hyper-agent@0.4.3`) was superseded on the registry
  by the unified-surface train, and this matrix will not recommend a pair it has
  not re-proven. Evidence-eligible is not the same as recommended; recommending
  a superseded pair would hand you a binary collision.
- **Older published versions are deprecated.** `visp-kit@0.1.0` and
  `visp-hyper-agent@0.2.0`/`0.3.0` predate the current matrix. `doctor` fails if
  it finds one.
- **Compatibility is exact-pair only.** No version range is supported, because a
  version string is not an identity — `visp-hyper-agent@0.3.0` on npm and
  `0.3.0` in this workspace share 21 files of which 20 differ.
- **Packed-install coverage is Linux and macOS; Windows has none.** The fixtures
  verify Git file modes a snapshot restored and Windows has no POSIX mode bits,
  so no claim about installing on Windows is supported. The test suite itself
  does run there. See [docs/platform-support.md](docs/platform-support.md).
- **The pair-compatibility results are Linux x64, Node 24.** They cover the
  current published pair and historical additive boundaries, on one platform.
- **Assurance verdicts are currently `inconclusive`.** Oracle-result mapping is
  incomplete, so the honest verdict is not `passed`.
- **No performance or review-efficiency claim is made.** The evaluation gates
  for it have not run.
- **Whether the packages make your code more correct is UNMEASURED.** This is
  the question the project most wants to answer and it does not have an answer.
  A paired trial is designed, preregistered and built — same task attempted with
  and without the context pack, scored by whether a test that failed before
  passes after, McNemar exact on the discordant pairs. It has not produced a
  result: the model surface returned HTTP 403 with the account's usage limit
  exhausted, so 23 of 152 cells reached a model and 9 pairs came back usable.
  Those 9 agreed perfectly, which resolves nothing in either direction and is
  reported as resolving nothing.
- **Even when it runs, the trial can only resolve a 20 point difference.** A 10
  point improvement needs 168–369 pairs depending on how often the two arms
  disagree. Configuring two more repositories took the pool from 56 pairs to 81
  — enough to hold the 20 point bar up to 39% discordance instead of 28% — and
  it is still less than half the cheapest 10 point design. That is a fact about
  how many of these repositories have suites the harness can execute, not about
  the packages. Reaching 10 points needs more configured repositories, not more
  compute.
- **Nothing in this repository re-verifies a committed result.** Reports used to
  be committed under `evidence/` and re-checked offline by a gate. That
  directory was deleted and **nothing replaced it**. Every report is now a local
  build artifact under a gitignored `reports/`, with no second reader.

## How it works

Two things share this repository.

**The published CLI.** `visp-dev` with `doctor`, `versions` and `init`, plus the
`./machine-scope` export. It reads `compatibility.json` and reports; it decides
nothing and holds no state.

**The laboratory.** Everything under `src/` that measures the sibling packages
against each other: pair compatibility, ablation, navigation lift, paired
accuracy, and holdout containment. It produces reports. It is not shipped.

Visp Dev owns tested package compatibility and clean fixtures; the exact packed
WorkflowAction matrix; packed golden review examples recording Kit-authored
assurance facts across Hyper CLI and MCP surfaces; and factual compatibility and
migration documentation.

It never owns policy, task or workflow state, file scope, evidence authority,
workflow verification, review, assurance, PR readiness, host orchestration,
model routing, or Memory storage and lifecycle. Kit, Hyper and Memory remain
usable without Visp Dev, and public operation stays local-first: Visp Dev must
never require the private Control Plane.

## Compatibility status

The accepted Linux x64 matrix covers five exact historical Kit/Hyper pairs,
WorkflowAction 2.0 and 3.0 selection boundaries, the final six strict Hyper
surfaces, and seven deliberately unsupported fail-closed cases. It claims no
package SemVer support window and no native Windows compatibility.

The mixed-generation extension pins WorkflowAction 3.2 and four deterministic
golden flows — routine accepted, behavioral rejected, critical stale, critical
inconclusive — and exercises the additive 3.1 boundary with the prior Kit and
Hyper producers. Visp Dev records and compares Kit-authored facts; it does not
calculate acceptance, decision freshness, or PR readiness.

The published-pair row pins the exact `visp-kit@0.2.3` /
`visp-hyper-agent@0.4.3` bytes it proved — a historical record, not an install
recommendation. All three exact pairs negotiate WorkflowAction 3.2 across `run`,
`next`, `resume`, checkpoint, `guard` and MCP. The corrected and previous Kit
views stay identical on one routine accepted fixture, so the fail-closed
corrections remain confined to input that was already broken.

The host-asset runner clean-installs a packed Hyper CLI with lifecycle scripts
disabled, then runs `init`, Git/CI fallback installation and `doctor` for Claude
Code, Codex, Copilot, generic and OpenCode fixtures. The host fixtures
deliberately omit named host binaries so `doctor` must report the documented
sequential and Git/CI fallback; the generic fixture verifies the manual-host
path.

See [the exact compatibility and migration report](docs/compatibility.md).

## Workspace layout the suite requires

A clone of this repository on its own **cannot reach a full pass**, and that is
a real dependency rather than a bug. The seam tests in `tests/maintenance/seams.test.mjs`
are the only tests here that compare one package against another — the place the
last four escaped defects lived — so they read Kit's, Hyper's and Memory's
sources directly and **fail rather than skip** when those are absent. A seam
test that passed because it could not find the thing it was comparing would
reinstate the blind spot it exists to close.

```
<workspace>/
  visp-dev/            <- this repository
  visp-kit/
  visp-hyper-agent/
  llm-memory/          <- visp-memory; the Hyper<->Memory contract seam reads it
```

Siblings vendored at `visp-dev/engines/visp-kit`,
`visp-dev/engines/visp-hyper-agent` and `visp-dev/engines/llm-memory` are
accepted too, and that is what CI does: every leg of the test matrix checks the
three out at their default branches before running `check`, so the seams are
compared against the tips rather than against a pin that could not drift. A
sibling is recognised by its manifest — `package.json` for the Node products,
`pyproject.toml` for llm-memory.

All three are named in one place, `REQUIRED_SIBLINGS` in the workspace-layout
preflight, which is also the only thing that turns a sibling's name into a path.
llm-memory was missing from that list for a while because one seam resolved it
with its own lookup: the preflight reported the layout satisfied and a correctly
set up clone still failed a seam test. `tests/maintenance/workspace-layout.test.mjs` now
fails the build if a seam resolves a sibling any other way.

`pnpm test` runs the preflight first, so a checkout missing a sibling is told
which one, where the search looked, and how many tests will fail for that reason
**before** the failures scroll past. It does not stop the run: everything except
the seam tests passes in a lone clone.

The holdout containment guard has a separate layout note. `pnpm holdout:guard`
scans this repository only; `pnpm holdout:guard:workspace` also scans
`../visp-intel`, `../planning`, `../visp-kit` and `../visp-hyper-agent`, and
needs the private holdout at `../planning/private/holdout/tasks` to run anything
but its shape rules. Without the holdout it says so, and does not report a pass
as containment.

## Run the laboratory

Requirements are Node, Git, npm `11.12.1`, pnpm `11.3.0`, caller-supplied
offline pnpm store and npm cache snapshots, and local Kit/Hyper repositories.

```bash
npm test
npm run maintenance:syntax
```

Each pair-compatibility runner produces a report and verifies one it is given.
Reports land in the gitignored `reports/`; nothing is committed and nothing is
re-verified for you.

```bash
node scripts/compatibility/matrix.mjs \
  --kit-repository ../visp-kit \
  --hyper-repository ../visp-hyper-agent \
  --offline-store <pnpm-store-snapshot> \
  --offline-cache <npm-cache-snapshot> \
  --output <new-report-path>

node scripts/compatibility/matrix.mjs --verify <report-path>

node scripts/compatibility/mixed-generation.mjs \
  --kit-repository ../visp-kit \
  --hyper-repository ../visp-hyper-agent \
  --offline-store <pnpm-store-snapshot> \
  --offline-cache <npm-cache-snapshot> \
  --package-manager "$(command -v pnpm)" \
  --npm "$(command -v npm)" \
  --output <new-mixed-generation-report-path>

node scripts/compatibility/published-pair.mjs \
  --kit-repository ../visp-kit \
  --hyper-repository ../visp-hyper-agent \
  --offline-store <pnpm-store-snapshot> \
  --offline-cache <npm-cache-snapshot> \
  --package-manager "$(command -v pnpm)" \
  --npm "$(command -v npm)" \
  --run-provider local \
  --run-id <stable-local-run-id> \
  --run-attempt 1 \
  --output <new-published-pair-report-path>

node scripts/compatibility/host-assets.mjs \
  --repository ../visp-hyper-agent \
  --output <new-host-asset-report-path>
```

Use `--row A` through `--row E` only for bounded diagnosis. A selected-row debug
run is not a complete compatibility report. The repository-mode host-asset
command packages the existing `dist/` without running lifecycle scripts, so
build Hyper first if you want the packed CLI to match the source under review.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow. Report
security vulnerabilities through the private process in
[SECURITY.md](SECURITY.md), not through a public issue.

## License

Licensed under the [Apache License 2.0](LICENSE).
