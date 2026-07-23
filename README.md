# Visp Dev

Visp Dev is the thin public integration and product shell for compatible Visp
Kit, Visp Hyper Agent, and optional Visp Memory releases.

The current implementation is a dependency-free compatibility laboratory. It
packs exact Kit and Hyper commits twice, installs the tarballs into clean
offline fixtures with lifecycle scripts disabled, exercises the public
binaries, and emits deterministic machine evidence.

## Current responsibility

Visp Dev owns:

- tested package compatibility, clean fixtures, and version reports;
- the exact packed WorkflowAction compatibility matrix;
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
```

Use `--row A` through `--row E` only for bounded diagnosis. A selected-row
debug run is not a complete compatibility report.

## Workspace development references

These links point to the parent workspace's development controls. They are not
package or standalone public documentation:

- [current phase](../planning/current-phase.md)
- [canonical product boundary](../planning/architecture-boundary.md)
- [product and repository map](../planning/product-map.md)
- [product and engineering roadmap](../planning/visp-dev-roadmap.md)
- [repository plan](../planning/repository-plan.md)
