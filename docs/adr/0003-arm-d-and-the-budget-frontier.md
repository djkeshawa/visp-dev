# 0003 — Arm D isolates one binary, and the budget is swept rather than fixed

- **Status:** Accepted
- **Date:** 2026-08-11
- **Unit:** P21-DEV-01 (re-measurement)
- **Supersedes:** nothing; extends 0002

## Context

The first A/B/C run recorded the split result Phase 21 now carries: the pack got
66.1% cheaper and lost 78.3% of its bodied file recall. Kit then changed
`src/context/context-selector.ts` so that membership of intel's cited path ranks
the pack instead of filtering it, and reported a recovery.

Two things had to happen before that report could become a measurement.

**One arm, one variable.** A recovery claim is only readable if the thing that
changed is the thing being credited. Arm C and the fixed build differ in exactly
one artifact: the `visp-kit` binary. Everything else — holdout, parent commits,
intel store, scout policy, budget, scoring code — must be the same code on the
same data.

**One point is not a curve.** The failure that produced arm C was reading a
token number without the recall number beside it. A single new pair of numbers
answers "did this attempt work" and cannot answer "where is the knee", which is
the decision the project actually faces. The objective was never minimum tokens;
it is the best localisation per token.

## Decision

**Arm D is arm C run against a second `visp-kit` build.** `VARIANTS` gains `D`,
`INTEL_VARIANTS` and `SCOUT_VARIANTS` name which arms build a store and run the
scout, and `--kit-bin-for D=<path>` supplies the build. `kitBinaryFor` **throws**
when arm D would resolve to the same binary as arm C: defaulting would produce a
D column identical to C by construction, and a reader would have no way to tell
that apart from a fix that changed nothing.

**The harness sweeps `--max-tokens` in one pass.** A comma-separated list
compiles the pack once per ceiling inside the same checkout. Everything before
`visp context` — the clone, the intel index, the scout, the export, Kit's scan —
is identical across ceilings and is done once; re-running it per point would
cost about thirty seconds a point on arms C and D and would re-measure the same
setup. Each row records the ceiling it was compiled at.

**One report per budget point, never one report averaging several.**
`aggregate` refuses a mixed budget point exactly as it already refuses a mixed
cohort. A mean over a 3,000-token ceiling and a 30,000-token ceiling describes
no configuration anybody can run.

**The frontier table prints recall beside tokens on every row**, plus recall per
thousand tokens. A table with a tokens column and no recall column is the
artifact that produced the arm-C mistake.

## Why the policy default is also a swept point

`balanced` sets `maxInputTokens` to 15,000, and `contextBudgetPolicy` changes
nothing else when the override equals the default. So `--max-tokens 15000` and
the policy default are the same policy compiled twice — once as the first
context call in a fresh checkout, once as the last call in a reused one. They
are run as separate points on purpose. If they agree row for row, repeated
compilation in a shared checkout carries no state, which is what licenses every
other point in the sweep. If they disagree, the sweep is contaminated and must
not be read as independent points. That check is reported, not assumed.

## What this still cannot support

Everything 0002 excludes. No model is invoked, so no claim about correctness,
patch success, or `navigation_lift(model)`. A bodied-recall figure remains a
statement about retrieval and remains a lower bound wherever the pack lists a
file without a body.

The sweep's low end is bounded by something the harness does not control:
Kit's trimmer removes snippets and never summaries, so below the summary floor a
lower ceiling stops buying anything and the pack simply reports itself over
budget. That is a property of Kit's trimmer, it is visible in the table, and it
is not evidence about the selector.

## Consequences

- `--kit-bin-for`, `--max-tokens` and `--frontier` are new flags on the
  ablation runner; `pnpm evaluation:ablation` is unchanged. The `ablation:verify`
  shortcuts have since been deleted with the committed reports they re-read.
- `runVariant` returns one row per budget point instead of one row.
- Stored A/B/C reports still verify: adding `D` to `VARIANTS` widens what is
  accepted and invalidates nothing.
