# 0005 — Arm E is a build, and the seam behind the seam is measured too

- **Status:** Accepted
- **Date:** 2026-08-12
- **Unit:** Phase 22, arm E
- **Supersedes:** nothing; extends 0002, 0003 and 0004

## Context

ADR 0004 made "did intel's graph reach Kit's `scan`" a per-run field instead of
an assumption, and the answer came back **29 of 29, zero warnings** while the
context pack stayed bit-identical to the no-graph arm. That located the problem
one layer further in: the graph arrived, it improved `module-map.json`, and
nothing downstream read `module-map.json`. `visp-kit` `0e55c57` closes that by
having the context selector read intel's consumer projection directly and
bounded-admit files one import or test hop from the task's seeds.

Measuring that raises two problems the harness could get wrong in exactly the
way 0004 was written to prevent.

**The arm is a build with no switch.** `0e55c57` consumes the projection
whenever `loadIntelGraph` returns one. There is no policy flag. So "arm E" and
"the binary" are the same fact, and an arm E pointed at arm D's binary is a D
column wearing an E label whose every delta is zero by construction — which is
the exact reading the arm exists to rule out.

**The old seam field cannot answer the new question.** `intelSeam.read` is taken
from what `scan` wrote. It says nothing about what the *selector* did at the
moment it chose files, and the last two rounds are the proof that those are
different facts: `scan` read the graph on every task and the selector never saw
it. Worse, the natural place to read the new fact — the pack's
`artifactProvenance` — only exists from `0e55c57`. Arm D's build records no
retrieval-input provenance at all, so "no projection entry" means "the selector
refused the graph" on one build and "this build cannot say" on the other.

## Decision

**1. `kitBinaryFor` refuses arm E against arm D's binary**, in the same shape
and for the same reason it already refuses D against C's. `verifyAblationReport`
refuses it a second time from `kitBuilds`, because a report can be merged,
re-emitted or hand-edited long after the runner had its say.

**2. A second seam field, `detail.structuralSeam`,** read from the pack's own
`artifactProvenance` — which Kit writes only when `loadIntelGraph` returned a
graph, so a projection on disk that Kit refused reports false. It carries
`provenanceSource`, and `projectionRead` is **`null`, not `false`,** when the
build records no retrieval inputs. This is 0004's `provenanceSource` rule
applied one seam further in: a missing record and an explicit no are never the
same answer.

**3. Structural admission is counted from Kit's literal reason string,** matched
exactly. A near-match is not a match: if Kit rewords it, the harness reports
zero admissions and is visibly wrong, rather than fuzzy-matching to a plausible
number.

**4. What the slots bought is scored against ground truth** —
`structuralAdmittedCount`, `structuralAdmittedBodied`,
`structuralAdmittedRelevant`, `structuralRecallContribution`. "The mechanism
fired" and "the mechanism helped" are different claims and the report must be
able to say the first while denying the second. It had to: the mechanism fired
39 times and helped zero times.

**5. A per-arm seam summary, re-derived by the verifier from the rows.** A
summary that can disagree with its own evidence is a self-report with a JSON
extension.

**6. `intelBuild` is recorded in the report.** Three reports were published
naming their intel commit only in prose. Read from the repository the binary was
built from, not from `--version`, which reports `0.1.0` across every commit in
this phase.

## Consequences

Arm E is measurable and its null is trustworthy: the selector read the
projection on 29 of 29 runs, so no row is a fallback wearing an arm's name, and
the null is about the mechanism rather than about a seam that never loaded.

The `null` distinction cost a real finding rather than hiding one. It surfaced
that `0e55c57` adds a flat +280 tokens to a pack with no graph at all, which the
arm-A build control then confirmed on 29 of 29 tasks — so **the reported
context-pack token figure is no longer build-invariant**, and roughly 378 of arm
E's 825-token cost is pack bookkeeping rather than retrieved content. A harness
that had collapsed "absent" into "false" would have attributed all 825 to the
graph.

Adding `E` to `VARIANTS` widens what a stored report may contain and narrows
nothing; the five Phase 21 reports still verify unchanged.

## What this does not do

It does not measure E2. `0e55c57` ships neither the policy flag nor a
displacement path, so the design's displacing variant is **not measured**, and
the report's `scope.limitations` says so rather than letting an unbuilt arm read
as a measured null. It does not measure whether the admitted files were
*correctly* adjacent — only that intel's contract says they are adjacent. And it
invokes no model, so it says nothing about what an agent would do with any of
these packs.
