# 0002 — The P21 ablation measures context construction, not agent runs

> **Paths in this document predate the module restructure.** They are the
> names in use when the decision was taken; current homes are in `docs/refactor/`.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Unit:** P21-DEV-01
- **Supersedes:** nothing

## Context

Phase 21 asks whether intel's understanding case makes Visp cheaper and better
at localisation. The authorized shape is three arms at identical model, tasks,
token budget and tool-call limit:

- **A** — current tools
- **B** — A plus intel's graph behind Kit's `scan`
- **C** — B plus the understanding gate and the bounded scout

The phase also names exploration-first metrics — relevant file and symbol
recall, irrelevant content retrieved, path coverage, impacted-test recall, tool
calls, tokens, time to first edit, edits before adequate exploration — and asks
for `navigation_lift(model)` across a small and a frontier model.

Running that literally means driving a language model through 29 capability
tasks times three arms times *k* trials times two model tiers. That was not
available in this unit's budget.

## Decision

The harness measures **what the agent is given**, deterministically, and does
not invoke a model.

For each task and arm it prepares an independent checkout at the holdout's
parent commit, runs the real `visp-intel` and `visp-kit` binaries, and scores
the context pack Kit actually wrote against the human patch frozen in the
holdout record. Arm C's scout is a **fixed deterministic policy** over intel's
six permitted actions, capped at twelve, with every row citing the receipt of
the query that produced it.

Everything that requires a model is declared **not measured**, in the report
itself, in `MEASUREMENT_SCOPE`:

- patch success or any correctness outcome
- tool calls, time to first edit, edits before adequate exploration
- `navigation_lift(model)`
- `pass^k` and across-trial variance

## Why this is worth running anyway

The phase's central hypothesis is about the pack, not about the model: *if
intel's path replaces the pack's bulk, Visp's token cost should fall while
accuracy rises.* Token cost per pack and localisation of the pack are both
properties of construction. A model run would add outcome data on top; it would
not make these two numbers more true.

It also removes model variance from the seam. A deterministic scout is neither a
good scout nor a bad one, and the report says so — but it is the same scout in
every arm and on every task, so a difference between arms is a difference in the
seam rather than in the sampling.

## What this cannot support

No claim about correctness, defect rate, review time, or productivity. The
evaluation protocol's claim ceiling stands untouched, `preregistered` is still
`false`, and `verifyAblationReport` refuses a report that says otherwise.

A localisation number from this harness is a statement about **retrieval**: did
the file the human changed arrive in the prompt with a body. An agent that reads
a withheld filename and then queries `repo.entity` for it may recover what the
pack withheld. This harness cannot see that, because seeing it requires a model.
The number is therefore a lower bound on arm C, and the report says that too.

## Consequences

- `pnpm evaluation:ablation` runs it, and `--verify <path>` re-checks a report you hand
  it. The `ablation:verify` shortcuts are **gone**: each one re-read a report
  committed under `evidence/`, and that directory was deleted.
- The scoring is unit-tested against synthetic fixtures, as the protocol
  requires analysis code to be, before any real datum existed.
- The two cohorts never mix: `aggregate` throws rather than average a
  workspace-authored task into a capability figure.
- When a model budget exists, the same harness gains an arm-level runner and the
  not-measured list shrinks. Nothing here has to be rebuilt for that.
