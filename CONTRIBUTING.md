# Contributing to Visp Dev

Visp Dev is the thin public integration and compatibility layer for the Visp
toolchain. Contributions should preserve that boundary: Visp Kit owns workflow
authority, Visp Hyper Agent owns orchestration, and Visp Memory owns durable
memory lifecycle.

## Development

Requirements:

- Node.js 22 or newer;
- pnpm 11.3.0; and
- Git.

Run the complete local checks before submitting a change:

```bash
pnpm check
```

Packed compatibility runs additionally require exact local Kit and Hyper
repositories plus caller-supplied offline pnpm-store and npm-cache snapshots.
See the commands in [README.md](README.md).

## Change expectations

- Keep changes deterministic, local-first, and dependency-free unless a new
  dependency has been explicitly discussed.
- Do not move policy, workflow state, evidence authority, orchestration, model
  execution, or durable memory semantics into this repository.
- Add or update focused tests for behavioral changes.
- Document the exact producer commits and compatibility boundary for packed
  evidence changes.
- Do not commit generated reports, package tarballs, credentials, caches, or
  temporary compatibility-lab directories.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0.
