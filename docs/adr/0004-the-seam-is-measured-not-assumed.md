# 0004 — Whether intel's graph reached Kit is measured per run, not assumed

> **Paths in this document predate the module restructure.** They are the
> names in use when the decision was taken; current homes are in `docs/refactor/`.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Unit:** P21-DEV-01 (third run)
- **Supersedes:** nothing; extends 0002 and 0003

## Context

Arm B is "arm A plus intel's graph behind Kit's `scan`". Two runs reported it as
a null result. Neither checked that the graph had arrived.

Kit does not fail when the graph is unreadable. It warns and falls back to its
own file analysis. A run in that state produces a row labelled `B` that is arm A
by construction — same inputs, same pack, same numbers — and there is nothing in
the report to tell the two apart. **A null result and an inert seam are
indistinguishable in the artifact as it was written**, which means two phases of
conclusion rested on an assumption with no measurement behind it.

Intel then measured its archival `repo export` at 128.1 MiB on `visp-kit`
against Kit's 64 MiB read limit and shipped a consumer projection at 1.4–1.8% of
those bytes; `visp-kit` `197e329` reads the projection. That made the assumption
look actively wrong and forced the question.

## Decision

Three things, all in the harness rather than in the write-up.

**1. An intel arm writes both intel artifacts.** The archival `repo export` and
the consumer `repo projection`. The Kit builds under comparison read different
ones; emitting only the artifact the newer build reads would decide "did the
graph reach Kit" by choosing which build could possibly read it, and emitting
only the older one would guarantee the newer build fell back. Both are written
and the consumer's behaviour is measured.

**2. `read` comes from the consumer, never from the producer.**
`readIntelSeam` derives the field from Kit's own provenance record — the store
identity it wrote after collapsing the graph, at
`.visp/cache/intel-scan.json` from `9d59cc2` and at `scan-meta.json`'s `intel`
key before it. The presence of a file in `.visp-intel/` is what the *producer*
did and is recorded separately, as bytes. Kit's intel warnings travel verbatim,
because the text names which artifact and why.

**3. "Arrived" and "mattered" are separate measurements.**
`scripts/run-intel-seam-probe.mjs` builds two checkouts per task at the same
parent commit against the same Kit build — one with no store, one with the
projection — and hashes `module-map.json` with `generatedAt` removed. Without
it, "the pack is unchanged" and "nothing happened" are the same sentence.

## Consequences

**The premise that motivated the third run does not hold on the measured
cohort, and the harness is what showed that.** The control arm puts arm B on the
baseline Kit build and finds the graph was read on 29 of 29 tasks with zero
warnings: the archival exports for `rlm` and `mongo-exporter` are 8 KB to 9.3 MB,
far under the 64 MiB limit. The degradation is real on `visp-kit`,
`visp-hyper-agent` and `llm-memory`; it never applied here. **Arm B was already
a fair test.** A harness that could only confirm the premise would not have been
able to report that.

**The null result survives and hardens.** With the graph proved to have arrived
on 29 of 29, and Kit's module map proved to differ from the no-store scan on 22
of 29 (`internalImports` 305 → 1,775 entries, 0 → 1,775 of them naming an
openable file), the context pack is **bit-identical to arm A on all 29 tasks and
every metric, tokens included**. The baseline's −0.4% token gap was intel's own
export being indexed as project source and disappears once Kit ignores
`.visp-intel`.

**What it costs.** Two intel artifacts per intel arm instead of one, and a
second scan per task in the probe. The projection is cheap; the archival export
is not, and on a repository the size of `visp-kit` this harness would pay both.
That is accepted here because the cohort is small, and it is the wrong default
for a larger one.

## What this does not license

- It does not say the graph is worthless. It says the graph does not reach the
  prompt through `scan`, which is one seam, measured.
- It does not score the module map. Whether the 1,775 resolved entries are
  *correct* is `visp-kit/docs/benchmarks.md`'s question, not this probe's, and
  the probe's report says so in its own `notMeasured`.
- It still involves no model. `navigation_lift` remains not measured.
