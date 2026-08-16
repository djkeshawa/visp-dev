# 0006 — Ideas die on the scratch corpus; the holdout is spent by one confirmatory run

> **Paths in this document predate the module restructure.** They are the
> names in use when the decision was taken; current homes are in `docs/refactor/`.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Unit:** Phase 24
- **Extends:** 0002 (what the ablation measures); does not supersede anything
- **Design of record:** `planning/design/scratch-corpus-and-temporal-freeze.md`
- **Partly withdrawn (2026-08-15):** every claim in this ADR that rested on a
  committed anchor file in `visp-dev` is withdrawn. The `evidence/` directory —
  including `freeze-anchor.json`, `holdout-manifest-anchor.json` and
  `scratch-only-freeze.json` — was deleted, and **nothing replaced it**. The
  affected passages are marked WITHDRAWN inline. Do not cite this ADR for a
  freeze, anchoring or dating guarantee.

## Context

The holdout is a final exam that can be given once. It was given several times,
to choose between mechanisms: arm E, the seeding variants and the slot budgets
were each tried against it. That converts the exam into the practice test, and
it is a worse injury than the one leaked record, because no cleanup reverses it
— every mechanism now standing was selected partly by looking at the answers.

Two more facts constrain the fix. First, "capture tasks before the work" has
been policy since D-144 and has been followed zero times, so a rule that relies
on remembering is not a rule. Second, a corpus of new exam questions cannot be
manufactured on demand: external commits accrue at upstream speed, months not
days.

## Decision

**1. A disposable practice corpus, structurally incapable of carrying a claim.**
`scripts/generate-scratch-corpus.mjs` derives task records from commits already
on this machine, in the holdout's exact schema, with three fields changed:
`claimCeiling: "scratch_disposable"`, a `SCRATCH` contamination prefix, and
`corpus: "scratch"`. `eligibilityOf` returns a fourth cohort, `"scratch"`,
keyed on those fields and checked **before** the author check — so a scratch
record written by an external author cannot read as capability-eligible.
`aggregate` stamps and refuses to mix corpora; `verifyAblationReport` throws on
a scratch row filed under `capability` or `regression`. Tuning against this
corpus is the intended use. It is a build artifact: gitignored, regenerable,
floored at 320 records, resampled by bumping one committed line.

**1a. Breadth, because concentration is where the last injury came from.** The
answer-disjointness fix in §2 cost the corpus exactly where the exam lives:
`rlm` fell to **2** practice tasks against 22 holdout records in that same
repository, and `mongo-exporter` to **0**. An idea then has nowhere cheap to die
in the two places it most needs to. The corpus was widened from 11 repositories
and 151 tasks to **16 repositories and 390 tasks** — five new repositories
(`my_notes`, `visp-notes-vscode-design-package`, `vispnote-mobile`, `visp-labs`,
`travel-time-window-calculator`) and `perRepoCap` from 25 to 60.

The five new repositories were not in the planning freeze manifest and could not
be: several of its ref values are holdout ground truth. They rested instead on a
**self-issued** scratch-only freeze, committed in this repository, honest about
proving no ordering.

**WITHDRAWN. That file was deleted and nothing replaced it.** The generator now
reads the planning freeze manifest alone, so those five repositories are no
longer frozen by anything and the widening this section describes is not
reproducible from what is committed here. The `scratch-only` tier check, the
merge-conflict refusal and the post-generation cleanliness assertion went with
it.

**Widening cannot reach `rlm` or `mongo-exporter`, and that is a coverage
finding, not a gap in effort.** Both are already enumerated to their last commit:
`rlm` has 79 commits in total and the frozen refs reach all 79, `mongo-exporter`
13 and all 13. There is no further history to go back to. Of `rlm`'s 79, 22 are
holdout ground truth (S8), 42 more fail the hygiene filters, 15 are eligible, and
13 of those 15 share a changed file or symbol with a holdout answer. Two survive,
and the only ways to make it three are to loosen the filters or to accept answer
overlap — the second destroys the holdout, so the ceiling is real. What it costs
is stated plainly: **for the 22 holdout records in `rlm` and the 7 in
`mongo-exporter`, the practice corpus cannot rehearse an idea in the repository
that will grade it.** Breadth elsewhere buys generality, not local cover.

**1b. Whether the answer can be checked at all.** Every metric this project has
produced measures the shape of the input; none measures whether the code that
comes out is correct. `--probe-tests` executes each repository's own cheapest
test-invoking command and records the exit status, so the corpus can say which
tasks a pilot could actually check a patch against. It is a **sidecar**
(`.scratch/epoch-N/testability.json`), never a record field — a scratch record
stays byte-for-byte the holdout's schema with three fields changed.

**2. Disjointness is computed over ANSWERS, never asserted, and never only over
identity.** Two independent layers — the graph partition (scratch is what is
reachable from the frozen refs; temporal is proper descendants reachable from
none) and an explicit exclusion index for the 43 pre-freeze records — plus a
post-generation recomputation. The generator fails **closed** when the exclusion
index is unreadable, because a corpus generated without it looks exactly like a
correct one. The independent V6 check that `pnpm freeze:verify` ran is
**withdrawn** — that verifier was deleted, so the recomputation is no longer
cross-checked by anything.

Identity was not enough. `disjointnessViolations` compared `id` and
`groundTruth.commit`; nothing compared answers, and the answer is what the
metric scores. Twenty-five of the first 176 generated tasks shared a changed
file or a changed symbol with a holdout record **in the same repository**, at
different commits and therefore invisible to an identity check. A scratch task
whose answer overlaps a holdout answer is now **quarantined**: removed from the
corpus, counted by kind, named by id in the generator's output, and written with
its collision to `.scratch/epoch-N/quarantine.json`. Never silently dropped —
the first epoch-1 corpus was 151 survivors of 176, and the 25 are on the record.
After the widening in §1a the same rule quarantines 29 of 419 (13 `rlm`, 10
`llm-memory`, 5 `visp-kit`, 1 `mongo-exporter`), leaving 390.

**2a. One hash, and it covers the whole record.** Every **record** digest used
`JSON.stringify(record, Object.keys(record).sort())`, whose second argument is an
**array replacer** — an allow-list applied at every depth. Every nested object
serialised as `{}`, so `task`, `groundTruth` and `provenance` contributed
nothing. A record's entire answer key could be rewritten, or `provenance.author`
flipped to move seven records into the capability cohort, with zero mismatches
reported. `src/canonical-json.mjs` is now the one recipe and all 43 holdout
records were rehashed under it. **A record hash computed before 2026-08-14 proved
nothing about any nested field.** The freeze manifest's own hash was never
affected — `manifestHashOf` already serialised recursively — and saying otherwise
would be the same kind of overstatement this ADR exists to stop.

**3. Ordering is proved by ancestry, not by dates.** A commit id cannot be
created before its ancestor exists, so "captured before the work" becomes "the
work is a proper descendant of a frozen ref". For planned work the proof is a
hash chain: a pre-record naming the current HEAD, a work commit carrying that
pre-record's hash in a `Holdout-Record:` trailer. Neither step runs backwards.
A commit that postdates the freeze but cannot show it (a pre-freeze side branch)
fails T2 and is **honestly lost** rather than claimed.

**3a. WITHDRAWN — the freeze is no longer anchored anywhere, and nothing
replaced the anchor.** This section claimed the manifest digest was embedded in a
tracked file in this repository, so that the anchor commit gave the freeze a
timestamp this workspace could not choose. The anchor file, its verifier
(`freeze-verify`) and the `freeze:verify` entry point have all been deleted. V8
and V9 are gone with them, and no check was written to take their place.

What survives is only the weaker half this section already stated: the manifest
hash proves the manifest has not been edited since it was hashed, and proves
**nothing** about when the cutoff happened. `cutoffDate` is a field inside the
manifest, and recomputing the hash after changing it yields a manifest that
verifies perfectly. Backdating it is now a one-line edit in `planning` that
nothing in this repository can see.

**4. There is one door, and every runner goes through it.** The gate used to be
a call site: `run-ablation` had it and the other three runners each had a
private `loadHoldout` and no gate at all, so two live capability records could be
scored through `run-structural-headroom` with no preregistration and exit 0.
`src/holdout-access.mjs` is now the **only** exported way to obtain holdout
records. With any real holdout or temporal record selected, no runner starts
without `--preregistration`: a falsifier of machine-checkable triples, binaries
matching the commits actually passed, an attached scratch report that hashes as
declared and scored the same arms, no prior ledger entry for this
preregistration or mechanism, and a clean harness tree. A `started` ledger entry
naming the **runner** is appended before the first task, so a run whose result is
discarded still leaves a half-entry, and the ledger describes the holdout rather
than one script. A fifth runner gets the gate for free because there is nowhere
else to get records from — enforced by a test that fails the build if any file
outside that module grows a private record loader. The ledger is tracked.

## Consequences

- A scratch number cannot become a capability number without editing
  `src/ablation.mjs` — a tracked diff in a repository with a remote.
- `pnpm check` fails if the ledger chain is broken. The ancestry, interlock and
  receipt checks that `pnpm freeze:verify` ran are **withdrawn**: the verifier
  was deleted and nothing runs them now.
- Reports written before the gate stay at protocol 1.1 and are verified under
  the rules they were written under. Marking them gated retroactively would be a
  provenance claim nobody holds.
- The capability cohort does not grow tonight. Temporal capability records
  accrue at upstream speed, and until they do the claim base is the 21-record
  rump plus scratch-relative comparisons that state no level.

## What this does not do

The gate lives in a module this workspace can edit, on a machine this workspace
owns. It no longer gives the freeze a date at all: the cross-repository anchor
was deleted, so the freeze rests entirely on files in the one repository whose
history this workspace controls. The answer-overlap
check is deliberately conservative — one shared path in one repository is enough
— so it will quarantine practice tasks that were not really contaminated; that
is the cheap direction. What is guaranteed is narrower than any of it: the
honest path is the default path, and every other path leaves an artifact
somebody can find.
