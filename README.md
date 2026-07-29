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

That installs `visp-kit@0.2.1` and `visp-hyper-agent@0.4.1`, the supported
release. Check what you actually have:

```bash
node scripts/visp-dev.mjs doctor     # what you have, what is missing, what to run
node scripts/visp-dev.mjs versions   # the supported pairs, pinned by commit
node scripts/visp-dev.mjs init       # the exact steps for this project
```

`doctor` will tell you if you already have a **deprecated** Visp on your PATH,
which matters more than it sounds: `visp-kit@0.1.0` predates the fixes that
close four policy-bypass holes.

A version number is how you obtain Visp; it is not what carries the proof. The
evidence in this repository pins **commits and tarball hashes**, and the
published versions sit a few documentation commits away from the pinned pair.
See [Limitations](#limitations).

Once Kit and Hyper are on your PATH, the workflow is Kit's, not ours:

```bash
visp init .
visp scan .
visp next .
```

## Supported hosts

Hyper renders for Codex, Claude Code, Copilot, OpenCode, and a generic MCP
target, driven by versioned capability manifests rather than assumptions. A host
that lacks a capability gets honest sequential or Git/CI fallback guidance
instead of a broken integration.

## Assurance levels

| Level | Meaning |
|---|---|
| `kit_strict` | Kit is present and authoritative. Permission, scope, evidence sufficiency, and readiness are its verdicts. |
| `local_checked` | Kit-less fallback. Local checks ran, but nothing here is an authoritative verdict. |
| `advisory` | Guidance only. No claim about correctness. |

A `passed` verdict means the declared evidence satisfied the declared
requirement. It does not mean the change is correct, and Visp does not claim it
does. `inconclusive` never becomes a pass.

## Limitations

Stated plainly, because a compatibility product that oversells is worse than
none.

- **The supported release is an alpha, and it is not the pinned pair.**
  `visp-kit@0.2.1` and `visp-hyper-agent@0.4.1` are the versions to install.
  They differ from the commits the packed evidence pins by documentation
  commits only, so the proof describes near-identical content — not the exact
  bytes you get from npm.
- **Older published versions are deprecated.** `visp-kit@0.1.0` and
  `visp-hyper-agent@0.2.0`/`0.3.0` predate the current compatibility matrix. Do
  not install them; `doctor` fails if it finds one.
- **`visp-dev` itself is not published.** Run it from a checkout.
- **Compatibility is exact-pair only.** Every claim is pinned to a commit and an
  artifact hash. No version range is supported, because a version string is not
  an identity — `visp-hyper-agent@0.3.0` on npm and `0.3.0` in this workspace
  share 21 files of which 20 differ.
- **Packed-install evidence is Linux and macOS; Windows has none.** The fixture
  reports cover both, at the same Kit and Hyper commits. Windows cannot produce
  them — the fixtures verify Git file modes a snapshot restored, and Windows has
  no POSIX mode bits — so no claim about installing on Windows is supported. The
  test suite itself does run there. See [docs/platform-support.md](docs/platform-support.md).
- **The phase compatibility evidence is Linux x64, Node 24.** Those reports pin
  historical pairs and were produced on one platform.
- **Assurance verdicts are currently `inconclusive`.** Oracle-result mapping is
  incomplete, so the honest verdict is not `passed`.
- **No performance or review-efficiency claim is made.** Those need the Phase 6
  evaluation gates, which have not run.

## How it works

## Current responsibility

Visp Dev owns:

- tested package compatibility, clean fixtures, and version reports;
- the exact packed WorkflowAction compatibility matrix;
- packed golden review examples that record Kit-authored assurance facts across
  Hyper CLI and MCP surfaces;
- factual compatibility and migration documentation; and
- later setup, examples, golden paths, and public evaluations when activated.

It never owns policy, task or workflow state, file scope, evidence authority,
workflow verification, review, assurance, PR readiness, host orchestration,
model routing, or Memory storage and lifecycle. Kit, Hyper, and Memory remain
usable without Visp Dev. Public operation remains local-first, and Visp Dev must
never require the private Control Plane.

## Compatibility status

The accepted Linux x64 matrix covers five exact historical Kit/Hyper pairs,
WorkflowAction 2.0 and 3.0 selection boundaries, the final six strict Hyper
surfaces, and seven deliberately unsupported fail-closed cases. It does not
claim a package SemVer support window or native Windows/macOS compatibility.

The Phase 3 extension pins WorkflowAction 3.2 and four deterministic golden
flows: routine accepted, behavioral rejected, critical stale, and critical
inconclusive. It also exercises the additive 3.1 boundary with the prior Kit
and Hyper producers. Visp Dev records and compares Kit-authored facts; it does
not calculate acceptance, decision freshness, or PR readiness.

The Phase 4 host example runner clean-installs a packed Hyper CLI with lifecycle
scripts disabled, then runs `init`, Git/CI fallback installation, and `doctor`
for Claude Code, Codex, Copilot, generic, and OpenCode fixtures. Repository mode
packs installed runtime dependencies into the owned temporary fixture and
stays offline. Tarball mode requires an explicit offline npm cache snapshot.
The host fixtures deliberately omit named host binaries so `doctor` must report
the documented sequential and Git/CI fallback; the generic fixture verifies
the manual-host path.

See [the exact compatibility and migration report](docs/compatibility.md).

## Run the laboratory

Requirements are Node, Git, npm `11.12.1`, pnpm `11.3.0`, caller-supplied
offline pnpm store and npm cache snapshots, and local Kit/Hyper repositories.

```bash
npm test
npm run syntax

node scripts/run-compatibility-matrix.mjs \
  --kit-repository ../visp-kit \
  --hyper-repository ../visp-hyper-agent \
  --offline-store <pnpm-store-snapshot> \
  --offline-cache <npm-cache-snapshot> \
  --output <new-report-path>

node scripts/run-compatibility-matrix.mjs --verify <report-path>

node scripts/run-phase-3-compatibility.mjs \
  --kit-repository ../visp-kit \
  --hyper-repository ../visp-hyper-agent \
  --offline-store <pnpm-store-snapshot> \
  --offline-cache <npm-cache-snapshot> \
  --package-manager "$(command -v pnpm)" \
  --npm "$(command -v npm)" \
  --output <new-phase-3-report-path>

node scripts/run-phase-3-compatibility.mjs --verify <phase-3-report-path>

node scripts/run-phase-4-host-examples.mjs \
  --repository ../visp-hyper-agent \
  --output <new-phase-4-host-report-path>

node scripts/run-phase-4-host-examples.mjs \
  --tarball <visp-hyper-agent.tgz> \
  --offline-cache <npm-cache-snapshot> \
  --output <new-phase-4-host-report-path>

node scripts/run-phase-4-host-examples.mjs --verify <phase-4-host-report-path>
```

Use `--row A` through `--row E` only for bounded diagnosis. A selected-row
debug run is not a complete compatibility report.

The repository-mode Phase 4 command packages the existing `dist/` directory
without running repository lifecycle scripts. Build Hyper before running it so
the packed CLI matches the source candidate under review.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow. Report
security vulnerabilities through the private process in
[SECURITY.md](SECURITY.md), not through a public issue.

## License

Licensed under the [Apache License 2.0](LICENSE).

## Phase 4 exact-pair compatibility

`scripts/run-phase-4-compatibility.mjs` produces the exact compatibility and
migration report for the corrected-Kit pair. Committed evidence lives under
`evidence/` and re-verifies offline:

```bash
pnpm compatibility:phase-4:verify evidence/phase-4-pair-linux-x64-node24.json
```
