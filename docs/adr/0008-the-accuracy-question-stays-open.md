# 0008 — The accuracy question stays open, and the design that would close it is restated exactly

> **Paths in this document predate the module restructure.** They are the
> names in use when the decision was taken; current homes are in `docs/refactor/`.

- **Status:** Accepted
- **Date:** 2026-08-15
- **Unit:** Phase 26
- **Extends:** 0007 (correctness is scorable); supersedes nothing
- **Design of record:** `planning/design/accuracy-and-end-to-end-cost.md`

## Context

ADR 0007 built the instrument. This is what happened when it was pointed at the
question, and what had to be corrected before it can be pointed there again.

The paired trial ran and produced **no accuracy result**. Partway through, the
substituted model surface returned HTTP 403 and then reported the account's
usage limit exhausted until 2026-09-14. Of 152 planned cells, 23 reached a
model. Nine pairs came back with both arms scored, and those nine agreed
perfectly.

Separately, QE reproduced the preregistered power table exactly and then found
a method error behind it: the preregistration sized an **exact** McNemar test
using the **asymptotic** sample-size formula.

The owner intends to publish after this work, and his goal — "make sure that
with the help of packages what we build is error free" — has no measured answer
and will not have one this week.

## Decision

**1. The power statement is restated exactly, and the bar does not move.** The
exact test's rejection region moves in integer steps, so it spends less than
its nominal alpha at every discordant count and needs more pairs than a
continuous approximation prices. Sizing one test and running another was not a
rounding difference. Recomputed exactly at 56 pairs for a 20 point effect,
power is **97.9 / 86.2 / 76.2 / 67.7 / 54.0 percent** at discordance 0.20 /
0.25 / 0.30 / 0.35 / 0.45. So the headline held only while the arms disagreed
on **at most about a quarter** of tasks — the ceiling is 0.28, not the "about
30%" the preregistration claimed — and it collapsed to a coin flip when they
disagreed often. `pairsRequiredAsymptotic` survives in the source under a name
that warns, used only to print the correction beside the number it corrects.
**The 20 point bar is unchanged**, and a test asserts that it is.

**2. Ten points is unreachable on this corpus and that is the finding, not a
footnote.** A 10 point effect needs **168 to 369 pairs** exactly — the
asymptotic formula had said 155 to 351, so the correction makes an already
unreachable target further away. This is a fact about how many of these
repositories have suites a harness can execute. The owner's decision is to
accept a 20 point bar or to fund more configured repositories, and it is
written in those words in `evidence/phase-26/README.md`.

**3. The corpus is widened, and the widening does not reach ten points
either.** Two repositories excluded as un-runnable were excluded by a probe
that used the system Python instead of their own virtualenvs; their suites run
fine. Configuring them takes the executable corpus from four repositories to
six and the pair pool from **56 to 81**, which moves the discordance the 20
point bar survives from 0.28 to **0.39** and the smallest detectable effect at
ψ=0.30 from 20.72 to **17.52 points**. It is still less than half the cheapest
10 point design. Every repository still excluded is listed with the tasks it
costs; the largest is `my_notes` at 23, which has no test runner at all.

**4. A Python cell must prove the code under test came from the cell.** An
editable virtualenv install registers an import hook that redirects the package
name to the live working tree. It beats `PYTHONPATH`, it beats the current
directory, and it is silent — a harness under it would score the owner's
current code in both arms of every cell, and the arms would agree perfectly on
every task. So the interpreter runs with `-S` and an explicit path, and a new
gate **G0** refuses any task whose module under test does not resolve inside
the checkout. How a checkout got its dependency tree is now part of the spec
hash, in a way that leaves the four pre-existing repositories' hashes
unchanged.

**5. The two guards are pure functions with tests.** A cell whose agent
completed no turn is UNSCORED and leaves every denominator; a run refuses to
report a null manufactured from cells that never ran, and refuses perfect
concordance separately. Both were inline comments in a runner script when the
outage hit.

**6. The trial runs on one command, and refuses before it spends anything.**
`pnpm accuracy:trial` is preflight, prepare, agent, score. The preflight spends
one throwaway cell and refuses on the same signal the scorer refuses on — a
completed turn with usage attached, never an exit code, because during the
outage the binary exited 0 every time. Its refusal is written to
`evidence/phase-26/agent-surface-preflight.json`.

## Consequences

**Nine perfectly concordant pairs are reported as resolving nothing.** McNemar
tests the pairs where the arms disagree; there are none, so there is no
p-value. That is the most dangerous artifact this phase could have produced —
it has the shape of a strong null and none of the content — and the refusal
that names it is now pinned by a test rather than by a comment.

**Every claim on the packages is stated against the evidence that exists.** The
README says in the reader's own words that whether the packages make code more
correct is unmeasured, and a test fails if a phrase like "more accurate" or
"error-free" appears while the trial has no result. The publication decision is
the owner's; what this ADR fixes is that nothing published overstates.

**The preregistration cannot drift from the arithmetic again.** Trial 1 stays
on disk unedited — a preregistration corrected in place is not a
preregistration — and `scratch-accuracy-trial-2.json` supersedes it. A test
recomputes every power figure in the committed document from
`src/paired-accuracy.mjs`, and a run whose selection differs from the document
reports the drift as a refusal. The failure this corrects was a table typed
into a document; a table that is only prose is the thing that went wrong.

**One repository joined the corpus with almost nothing.** `llm-memory` supplies
one pair of the 25 new ones: 22 of its 25 candidates fail at their own human
commit because its history straddles a dependency migration and every checkout
runs against the repository's current dependency tree. That is the harness's
stated dependency-drift bias arriving at full strength, and it is reported as a
property of the harness rather than of that repository.

**The pilot still does not close Gate 8.** The model tiers the design names
remain unrunnable, `navigation_lift` remains UNMEASURED, and the substituted
surface now has no budget either.
