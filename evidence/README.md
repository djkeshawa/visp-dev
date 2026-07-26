# Compatibility Evidence

Canonical, self-hashed reports produced by the packed compatibility runners in
this repository. Each file records exactly what passed, against exactly which
Kit and Hyper commits, in one environment.

These are **evidence, not authorization**. A report proves what a run observed.
It does not grant permission to release, publish, or claim a support window.

## Files

| File | Produced by | Proves |
|---|---|---|
| `phase-2-packed-linux-x64-node24.json` | `pnpm compatibility:phase-2` | Evidence-validity behavior on the Phase 2 pair |
| `phase-3-packed-linux-x64-node24.json` | `pnpm compatibility:phase-3` | Assurance cases and review compression on the Phase 3 pair |
| `phase-4-host-examples-linux-x64-node24.json` | `pnpm examples:phase-4` | Packed Hyper renders honest host assets for every supported host |
| `phase-4-pair-linux-x64-node24.json` | `pnpm compatibility:phase-4` | Kit `3a8901b` and Hyper `6185819` agree across three cross-version rows and four golden scenarios on 24 surfaces |

## Re-verifying

Verification is offline and needs no packing:

```bash
pnpm compatibility:phase-2:verify evidence/phase-2-packed-linux-x64-node24.json
```

```bash
pnpm compatibility:phase-3:verify evidence/phase-3-packed-linux-x64-node24.json
```

```bash
pnpm compatibility:phase-4:verify evidence/phase-4-pair-linux-x64-node24.json
```

Each verifier recomputes the report's `reportSha256` over its canonical content,
re-checks the frozen pair identity and packed provenance, and rejects protocol,
schema, assurance, surface, and hash drift.

## Exact-pair only

Every claim here is bound to specific commit and tree hashes. None of it
establishes a package-version support window — see `../docs/compatibility.md`.

## Reproducibility limits

A full re-run reproduces the packed tarball hashes, every verdict, every next
command, and every mandatory hotspot. It does **not** reproduce a compatibility
row's `actionId`: the canonical action identity is specific to the throwaway
repository each run builds, so two runs over byte-identical packages yield
different action IDs. Phase 4 therefore freezes the verdict and next command
rather than the action ID, and binds the ID through within-run cross-surface
equality instead. Phase 3 froze the action ID, so its compatibility rows cannot
be reproduced by a fresh run; its stored report remains valid as a record of the
run that produced it.
