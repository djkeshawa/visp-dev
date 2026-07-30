# Visp Evaluation Protocol

- **Status:** Frozen 2026-07-27 under D-086; revised 2026-07-30 under D-101. **Not preregistered** — see below.
- **Version:** 1.1
- **Applies to:** any public claim about Visp's effect on AI-assisted development

## Revisions

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-27 | Frozen under D-086 (P6-01). |
| 1.1 | 2026-07-30 | Repeated trials, `pass^k`, and across-trial variance added under D-101 (P6-11). **No hypothesis, threshold, exclusion, failure category, or claim condition was changed.** |

A study reports the protocol version it ran under. Results produced under v1.0
remain valid as v1.0 results — they are single-trial, and a single-trial figure
cannot be compared against a v1.1 `pass^k` figure.

## Frozen, not preregistered

The D-069 publication freeze was lifted on 2026-07-29 (D-097), and the reason
this document previously gave — that the freeze forbade publishing a timestamped
copy — no longer holds. The status has not changed, because that reason was
never the binding one.

`visp-dev` has been a public repository since Phase 3, and build units were
always permitted to commit to it. If committing the protocol here counted as
preregistration, it would have been preregistered from the day it was written.
It was not, and the distinction is the whole point: **this project controls this
repository.** A timestamp we can rewrite is not a commitment, it is a claim about
one. Git history can be rebased and force-pushed; a reader auditing a later
result cannot tell the difference from the outside.

Preregistration therefore needs a record held by someone with no stake in the
outcome — an external registry entry, or an equivalent third-party timestamp over
this file's hash. That is a deliberate action for the product owner, not
something a build unit can perform, and it is the only remaining step for P6-05.

Until it exists, `preregistered` stays `false` and the claim ceiling below
applies in full.

## Why this exists before any study

A protocol written after seeing results is not a protocol; it is a rationalisation.
Freezing hypotheses, metrics, exclusions, and thresholds in advance is the only
thing that makes a later claim meaningful, and it is the same discipline Visp
demands of its own users: declare what would count as proof before you go
looking for it.

This document may be revised, but every revision is versioned and dated, and a
study reports the protocol version it ran under.

## Claim ceiling

**No claim about Visp's effect on correctness, defect rate, review time, or
developer productivity may be made until a study under this protocol reports a
result meeting its threshold.**

This includes marketing copy, README text, commit messages, and conversation
with prospects. The current honest position is: Visp enforces a workflow and
records evidence. Whether that produces better software is **unmeasured**.

## Hypotheses

Stated so they can fail.

| ID | Hypothesis | Primary metric |
|---|---|---|
| H1 | Visp reduces the number of AI-authored changes that reach human review with unmet declared scope | Rate of out-of-scope files per accepted change |
| H2 | Visp reduces the number of changes accepted on evidence that does not test the change | Rate of accepted changes whose tests were authored by the implementer and would pass without the change |
| H3 | Visp does not materially increase time-to-merge for routine changes | Median wall-clock from task start to review decision, routine class |
| H4 | Reviewers using an assurance case reach the same decision as reviewers reading the full diff, with less active review time | Decision agreement rate; active review minutes |

**H3 is a non-inferiority hypothesis.** It can fail, and failing it is a real
finding rather than a disappointing one: a correctness tool that triples routine
cycle time will not be adopted, and adoption is a precondition for any benefit.

## Exclusions, declared in advance

A run is excluded only for these reasons, recorded per run:

- the harness crashed or the environment was misconfigured, with the failure visible in logs;
- the model provider returned an infrastructure error unrelated to the task;
- the task specification was later found ambiguous by both arms;
- a participant withdrew.

**Not exclusions:** the model performed badly; Visp blocked something the
analyst thinks it should not have; the result was inconvenient. Excluding those
would convert the study into an advertisement.

Exclusion rate above 10% invalidates the run and requires re-running with a
corrected harness.

## Failure categories

Every blocked or rejected change is categorised, and the categories are
deliberately symmetric so the protocol can detect Visp being wrong:

| Category | Meaning |
|---|---|
| `true_block` | Blocked, and the change was genuinely defective or out of scope |
| `false_block` | Blocked, and the change was correct and in scope — Visp was wrong |
| `true_pass` | Accepted, and the change was correct |
| `false_pass` | Accepted, and the change was defective — Visp missed it |
| `inconclusive` | Evidence insufficient to categorise |

`false_block` is the category that decides adoption. A tool that never produces
one is either perfect or not actually checking anything, and the second is far
more likely.

## Repeated trials and reliability

Added in v1.1.

Every metric above is computed from a task run **once per arm**. That measures
capability. It cannot measure reliability, because one attempt cannot separate a
task the system handles consistently from one it happened to get right and would
fail on the next try.

The gap is not small. Published agent evaluations that report both figures find
single-attempt scores near 60% falling below 25% once the same task must succeed
on **all eight** attempts, and practitioner reports put the four-trial figure 15
to 25 points below the single-attempt one. A protocol that only ever runs once
cannot see any of that, and will report the higher number in good faith.

### What is measured

- **`pass^k`** — the proportion of tasks that succeed on **all** *k* trials. Not
  "succeeded at least once". A task passing 7 of 8 does not count toward it.
- **Across-trial variance** — the spread of outcomes per task, so a mean can be
  read against its own stability.

Both are reported per arm and per condition, alongside every existing metric.
Neither replaces an existing metric.

### How many trials

*k* is declared before the first run of a study and reported with its results.

| Study | k |
|---|---|
| Pilot | 8 |
| Main automated study | Declared from pilot variance; **minimum 3, maximum 8** |

The pilot carries the higher *k* because its task set is smaller and therefore
cheaper to repeat, and because measuring variance is already its job. If pilot
variance shows `pass^k` has stabilised below 8, the main study uses the smaller
value and records why. If the pilot is inconclusive on this point, the main
study uses **k = 5**.

This mirrors the rule this protocol already uses for reviewer count: declare a
range in advance, choose from pilot variance, report which was used.

### Rules that keep the number honest

- **Every trial counts.** Running eight and reporting the best five is optional
  stopping wearing a different hat, and is forbidden for the same reason.
- **Trials are independent.** Fresh environment per trial, no state carried
  between them, seed recorded per trial.
- **A failed trial is not an exclusion.** The exclusion list above governs
  unchanged. "The model did badly on run 6" is not on it and does not join it
  because there are now more runs.
- **Narrowing is allowed; hiding it is not.** Repeats may be applied to a defined
  subset when cost requires it. The subset, and what was left out, are recorded
  with the results. Silently sampling is a protocol violation.

### Cost

*k* trials cost *k* times as much. That is precisely why the number is a declared
decision rather than a default, and why narrowing to a stated subset is permitted
while quietly shrinking the task set is not.

### `pass^k` is descriptive in this version, not a hypothesis

It is reported, not tested. No threshold is attached to it, and **no public claim
may be made from it** — the claim ceiling admits only a preregistered primary
metric that met a declared threshold.

Two deliberate reasons:

- **No prior exists.** Nobody knows what `pass^k` looks like on Visp. A threshold
  set today would be a number picked to be beaten rather than one that means
  something, which is the failure this protocol exists to prevent.
- **It would move the existing goalposts.** H1–H4 are corrected for multiplicity
  as one family. Adding a fifth hypothesis raises the bar for the other four, so
  a new measurement would silently change the test of four already-frozen
  hypotheses.

Whether consistency becomes a tested hypothesis is a **v1.2 decision taken after
the pilot reports** — and never after seeing a main-study result.

## Statistical analysis

- **Design:** paired, same task under both arms, order counterbalanced.
- **Repeated trials:** each task runs *k* times per arm; see above. Every trial
  counts toward the reported figure.
- **Primary test:** paired comparison on the primary metric per hypothesis;
  exact test where counts are small rather than a normal approximation.
- **Multiplicity:** four hypotheses, so the significance threshold is corrected;
  Holm–Bonferroni across the primary family.
- **Effect size reported with every result**, and a confidence interval. A
  significant but trivial effect is reported as trivial.
- **No optional stopping.** The sample size is fixed before the first run. If it
  proves inadequate, that is reported and the study is re-run — not extended
  until it crosses a threshold.
- **Analysis code is written and tested against synthetic data before the real
  data exists**, so the analysis cannot be tuned to the outcome.

## Claim thresholds

A claim may be published only if **all** hold:

1. the preregistered primary metric met its threshold;
2. the effect size is practically meaningful, not merely significant;
3. `false_block` rate is at or below 5% of blocked changes;
4. the raw artifacts are published alongside the claim;
5. negative and null results from the same study are published with equal prominence.

| Hypothesis | Threshold |
|---|---|
| H1 | ≥30% relative reduction, CI excluding zero |
| H2 | ≥30% relative reduction, CI excluding zero |
| H3 | Median increase ≤20%, non-inferiority margin declared in advance |
| H4 | Agreement ≥90% with ≥20% reduction in active review minutes |

## What this protocol cannot establish

Stated so nobody has to discover it later:

- **Generalisation.** A study on a bounded task set says nothing about codebases
  unlike those tasks.
- **Long-run effects.** Nothing here measures maintenance burden or whether
  teams keep using it after novelty passes.
- **Causal attribution to any single mechanism.** Visp is a bundle. A result
  cannot be credited to the assurance case specifically without an ablation.
- **Anything about model quality.** Visp makes no LLM call. A better model may
  swamp any effect this measures.

## Current evidence, and what it is not

The only real-use data today is three dogfooding runs on one repository
(`planning/records/dogfooding-2026-07-27.md`), which measured workflow cost
falling from 61 commands at 39% retry to 18 at 0% after fixes.

**That is not evidence for any hypothesis here.** It measures the tool's own
friction, on one repository, with the author as operator, with no control arm.
It is legitimate engineering feedback and illegitimate as a product claim.
