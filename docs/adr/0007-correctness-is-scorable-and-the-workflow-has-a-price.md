# 0007 — Correctness is scorable on the practice corpus, and the workflow finally has a price

> **Paths in this document predate the module restructure.** They are the
> names in use when the decision was taken; current homes are in `docs/refactor/`.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Unit:** Phase 25
- **Extends:** 0002 (what the ablation measures), 0006 (the scratch corpus); supersedes nothing
- **Design of record:** `planning/design/accuracy-and-end-to-end-cost.md`

## Context

The owner reset the goal: **accuracy is the product claim and token cost is a
constraint to hold near parity**, not the thing being optimised.

Measured against that, every number this project holds is aimed slightly to the
left. Bodied file recall, symbol recall, tokens per pack, the −49.49% A→F
ablation: all of them describe the SHAPE OF THE INPUT handed to a model. None
of them says whether the code that came out was right. The record has admitted
this in its own words — `navigation_lift` has been UNMEASURED across six
consecutive assessments — but the admission never became an instrument.

There is a second gap the reset exposes. The ablation prices the *context
pack*. The owner is comparing the *whole workflow* — clarify, spec, plan, tasks,
context, implement, verify, and the documents written along the way — against a
bare agent that writes only code. That end-to-end number has never been
computed once, and "close to bare" is a claim about a figure nobody here has.

## Decision

**1. "Error free" is `buildClean ∧ passToPass ∧ failToPass`, all from the
repository's own toolchain.** The three are also reported separately because
their failure modes are diagnostic: a red build is broken output, a broken
pass-to-pass is collateral damage, a missed fail-to-pass is not doing the job.
`patchFileF1` survives as a localisation proxy and **quoting it as accuracy is
declared a bug**. An LLM judging a patch is refused outright — it is a
self-report with extra steps, and this project scores from artifacts on disk.

**2. Fail-to-pass is derived mechanically, and the yield is measured.**
`scripts/derive-exec-specs.mjs` overlays the human's test files at their
post-change content onto a checkout of the parent, requires a failure there and
a pass at the human commit, and freezes a sidecar naming the exact command and
the tests' content hashes. **80 of 95 candidates survive across four
repositories — 84.2%.** The pilot was preregistered to refuse below 15, and the
refusal did not trigger; the corpus can carry the question. Per-repository
build, suite and targeted commands are frozen in
`evaluations/scratch/accuracy.config.json`, chosen before any result existed.

**3. The cell has no future in it.** Each cell is materialised at the parent
commit and its `.git` is then destroyed and re-initialised. The human's fix and
the human's tests are physically absent, not merely out of scope, and `git diff`
still yields the patch. At scoring time the human's tests are restored over the
agent's work — on a COPY, so scoring is idempotent — and the overwrite is
counted. No agent reaches green by weakening a test.

**4. The end-to-end price is the artifact surcharge, in the estimator series.**
A completed Visp feature leaves a code diff, which is everything a bare agent
would have produced, and an artifact corpus, which is everything else. Every
artifact token crossed the model boundary at least once and a bare agent's
artifact corpus is empty, so the ratio is a FLOOR on the surcharge.
`scripts/measure-end-to-end-cost.mjs` computes it over 26 real completed
features in this workspace. It is the estimator series and says so in its own
body: the API series **does not exist to be mixed with** — the workflow's own
`.visp/budget.json` ledgers carry 38 usage rows and zero token counts.

## Consequences

**Two numbers exist that did not exist this morning, and one of them is small.**
On 14 cells, 7 per arm, the pack arm beat the bare arm on every scorer — but the
fail-to-pass margin is +14.3 points, which at this n is EXACTLY ONE CELL, and
with one trial per cell there is no flip-rate and therefore no noise floor. The
preregistered signal clause is recorded `unevaluable` rather than judged without
its prerequisite. The honest reading is *directional, not established*.

**The pilot does not close Gate 8 and must never be recorded as closing it.**
The agent under test is substituted, there is no token accounting, and the
substrate is the practice corpus, which supports no level claim. Every artifact
it writes carries that sentence as a constant rather than as something a writer
remembers to add.

**Two confounds were caught by building the instrument rather than by running
it.** A flat arm alternation over a repository round-robin handed two whole
codebases to each arm; and Kit's `init` edits the repository's ignore file and writes an
agent instructions file, which would have appeared as two extra changed files
in the pack arm only. Both are fixed, both are pinned by tests, and both are the kind of
defect that would have produced a publishable-looking number.

**Controls are part of the result.** 13 of 14 parents build clean and the one
that does not is excluded from `buildClean` rather than charged to its arm; 14
of 14 human patches satisfy their own acceptance command, so the oracles are
real. One cell whose failing test output the operator saw while debugging the
derivation is named as contaminated and reported both ways — it is in the BARE
arm and it passed, so keeping it makes the pack's margin smaller.

**`passToPass` is still unscored.** The green-twice-at-parent gate costs two
full suite runs per task and one repository's suite takes three minutes, so the
sidecars were derived without it. That is a stated cost, not an oversight, and
the composite is reported knowing one of its three legs is missing.
