# Publication cleanup — the exact sequence, and how to check it worked

**Status: PREPARED, NOT EXECUTED.** Everything below is written out so the owner
can run it.

**Historical record (2026-08-15).** Every `evidence/` path quoted below is a
transcript of what the scan measured at the time. The whole `evidence/`
directory has since been deleted from the working tree. **That changes nothing
about the problem this document describes**, because the problem was never the
working tree — it is the object database, and deleting a file does not remove
the blobs already in history. The prepared sequence below is still the fix, and
it is still unexecuted. The two commands that change where `main` points — `git reset` and
`git commit` — are deliberately not run by anyone but the owner, and no agent
has run them. The prepared commit message is already on disk at
`.git/CLEANUP_COMMIT_MSG` (untracked, so it never becomes part of the thing
being published).

## The problem this fixes, stated exactly

`.git/hooks/pre-push` refuses every push from this repository. Its reason is not
about the working tree:

> 29 reversible holdout task digests survive in this repository's object
> database across 24 evidence paths (D-160). The working tree is clean; the
> history is not.

That is still true, and it is measurable rather than remembered. As of the
preparation of this document:

```
$ pnpm holdout:publish-scan
publishable-object scan: 398 blob(s) in origin/main..main, 43 candidate id(s), every prefix length 8–64
    58  evidence/phase-21/navigation-lift-not-measured-linux-x64-node24-local.json
    29  evidence/phase-21/ablation-linux-x64-node24-local.json
    ... 18 more paths ...
LEAK: 609 reversible digest(s) across 20 path(s) in origin/main..main. Pushing this range publishes them.
```

609 findings, 29 distinct digests, 20 paths, all of them in blobs belonging to
the local commits `origin/main` has never seen. The blob count grows with every
commit; the finding count has not moved, because nothing new leaks — every one
of the 609 is in an evidence file written before the containment work.

`pnpm holdout:guard` passes on the same repository and always did — it reads
`git ls-files`, the index, and says so in its own NOT COVERED block: *"a report committed and then deleted is
absent here and present in every clone; this guard cannot see the object
database, and deletion is not containment."* This is that case, exactly.

Two facts bound the job:

- **`origin/main` is already clean.** `pnpm holdout:publish-scan origin/main` reports 308
  blobs and zero findings. Nothing already published has to be un-published, and
  no coordination with anyone who has already cloned is needed.
- **The current tree is clean.** `pnpm holdout:publish-scan 'main^{tree}' --not
  origin/main` reports 240 blobs and zero findings. Those are exactly the blobs
  a cleanup commit would add, so the cleanup does not need to change a single
  file — only which commits carry them.

## The shape of the fix, and why it is this shape

**One commit, containing the current tree, parented on `origin/main`.** The
leaking blobs stay in the object database, reachable only from a local branch
that is never pushed. Nothing is rewritten, nothing is deleted, no `gc` runs, no
force anything.

What this is NOT, and why:

- **Not `filter-branch` / `filter-repo` / an interactive rebase.** Those rewrite
  34 commits, change every sha, and — for a repository whose entire product
  claim is that its evidence is checkable — silently restate 34 commit messages'
  worth of history against trees that no longer match them. A rewrite that
  produces a *different* past is a worse artifact than a short one.
- **Not `gc --prune`.** Losing the objects is not the goal and is not reversible.
  The goal is that a push does not *send* them. Reachability, not deletion, is
  what governs what a push sends.
- **Not a force push.** There is nothing to force: the new commit's parent is
  `origin/main`, so the push is a fast-forward.

The cost is stated plainly: **the 34 commits' messages leave the published
history.** They are the most detailed record this project has of why each defect
was found. They are preserved in full on `main-full-history`, locally, and the
cleanup commit message names the branch and the tip so the record is findable by
anyone with the machine.

## Preconditions

`main-full-history` must hold every commit that `main` holds. It was 1 commit
behind when this was prepared and has been fast-forwarded; verify rather than
assume:

```bash
cd visp-dev
git rev-list --count main..main-full-history   # must be 0 — nothing on the full-history branch that main lacks
git rev-list --count main-full-history..main   # must be 0 — nothing on main that the full-history branch lacks
git rev-parse main main-full-history           # must print the same sha twice
```

If the second number is not 0, fast-forward it — and use `git fetch`, which
REFUSES a non-fast-forward, rather than `git branch -f`, which does not:

```bash
git fetch . main:main-full-history
```

Then, in order:

```bash
git status --porcelain          # must be empty: the tree being committed is the tree that was checked
pnpm holdout:guard              # must exit 0
pnpm check                      # the full gate
pnpm holdout:publish-scan 'main^{tree}' --not origin/main   # must print CLEAN
git rev-parse origin/main       # note this sha; it becomes the parent
```

Take the backup first if one is not current. There is a mirror at
`../visp-dev-backup.git` (see *Backup* below); refresh it with
`git --git-dir=../visp-dev-backup.git fetch origin 'refs/*:refs/*'` — the
additive form, explained under *Backup*.

## The sequence

Four commands. Two of them are the owner's alone.

```bash
cd visp-dev

# 1. Record where the full history is, so step 4 can prove nothing was lost.
#    Record the COUNT too, so the check does not depend on a number written in
#    this document, which goes stale one commit after it is written.
BEFORE=$(git rev-parse main)
BEFORE_COUNT=$(git rev-list --count main)
echo "$BEFORE  $BEFORE_COUNT"

# 2. Move the branch pointer back to the published tip, KEEPING the index and
#    the working tree exactly as they are. --soft touches neither. Every commit
#    between origin/main and $BEFORE stays in the object database, reachable
#    from main-full-history.
git reset --soft origin/main

# 3. Commit the staged tree. One commit, parent origin/main, message prepared.
git commit -F .git/CLEANUP_COMMIT_MSG

# 4. Verify (below) before doing anything else.
```

After that, and only after verification passes, publishing is:

```bash
# The pre-push lock is still in place and is still correct about the object
# database. Overriding it is the owner's judgement call, made after step 4:
VISP_ALLOW_PUSH=i-have-rewritten-history git push origin main
```

Push `main` **by name**. Never `git push --all`, never `git push --mirror`, and
never push `main-full-history` — those send the leaking objects and undo the
entire exercise in one command.

## Verification

Run all of it. Each line states what it must print.

```bash
# A. The tree did not change. This is the whole safety property of --soft.
git diff --quiet "$BEFORE" HEAD && echo "tree identical to the pre-cleanup tip"
git rev-parse "$BEFORE^{tree}" HEAD^{tree}      # the two shas must match

# B. Exactly one commit, parented on the published tip.
test "$(git rev-list --count origin/main..HEAD)" = 1 && echo "one commit"
test "$(git rev-parse HEAD^)" = "$(git rev-parse origin/main)" && echo "parent is origin/main"

# C. Nothing was lost. The full history is still there and still reachable.
git merge-base --is-ancestor "$BEFORE" main-full-history && echo "old tip reachable from main-full-history"
test "$(git rev-list --count main-full-history)" = "$BEFORE_COUNT" && echo "every commit still on main-full-history"
git cat-file -e "$BEFORE^{commit}" && echo "old tip object still present"
git fsck --no-progress --strict                 # no missing or corrupt objects

# D. The objects a push would now send carry no reversible digest. This is the
#    check the pre-push lock exists for, and the only one that answers it.
pnpm holdout:publish-scan                                # must print CLEAN over the tree's blobs
pnpm holdout:publish-scan origin/main..main              # same range, written out

# E. The working tree is still clean by the guard's own reading, and the suite
#    still passes over the committed tree.
pnpm holdout:guard
pnpm check

# F. What a fresh clone would actually get. The strongest check available,
#    because it makes no claim about reachability — it re-derives it.
git clone --no-local --branch main --single-branch . /tmp/visp-dev-clone-check
git -C /tmp/visp-dev-clone-check rev-list --count HEAD      # 80: the published 79 plus the cleanup commit
git -C /tmp/visp-dev-clone-check rev-list --objects --all | wc -l
git -C /tmp/visp-dev-clone-check grep -c . -- evidence/phase-21 >/dev/null 2>&1  # tree present, as expected
rm -rf /tmp/visp-dev-clone-check
```

`F` is worth the disk. `--no-local` forces a real pack negotiation instead of a
hardlink copy, so the clone contains precisely the objects a push would upload —
it is the closest thing to publishing without publishing.

## Backup

**Path: `../visp-dev-backup.git`** — a bare mirror at the workspace root, beside
`visp-dev`, `planning` and the rest, and beside the existing
`llm-memory-FULL-BACKUP-20260729.bundle`.

It used to live in a session scratchpad under `/tmp`, which is not a backup: a
reboot or a scratchpad sweep takes it, and every brief that cited it was citing
something with a lifetime measured in days. Two mirrors were there
(`visp-dev-backup-f9a991c.git` at 109 commits and `visp-dev-backup-b8c04da.git`
at 107). The newer one was copied out with `cp -a` and verified by object count
against its source (1,269 each), then refreshed from the live repository and
verified against that: HEAD `c6a2d50`, refs `main`, `main-full-history` and
`origin/main`, **114 commits**, **1,340 objects**, `git fsck --strict` exit 0
with only the normal dangling entries — every figure identical to the live
repository at that commit. A clone of it was taken and its HEAD tree sha
compared against the live one; they match.

Refresh it **before** the reset with a fetch that is strictly additive:

```bash
git --git-dir=../visp-dev-backup.git fetch origin 'refs/*:refs/*'
```

No `+`, so a non-fast-forward is REFUSED rather than forced, and no `--prune`,
so the mirror can never lose a ref the live repository has dropped. A backup
that can shrink when its source shrinks is a copy, not a backup. Before the
reset, a refusal from this command means something rewrote history, which this
plan says nothing does — stop and find out what.

**After** the reset, use a different refspec, because the new `main` is
deliberately NOT a descendant of the old one and the command above will
correctly refuse to move the mirror's `main` backwards:

```bash
git --git-dir=../visp-dev-backup.git fetch origin 'refs/heads/main:refs/heads/main-published'
```

The mirror then holds `main` (the full history as it stood before the cleanup),
`main-full-history` (the same thing, under the name the live repository uses)
and `main-published` (the one commit that was published). Nothing overwrote
anything.

Verify it, every time, on its own terms:

```bash
git --git-dir=../visp-dev-backup.git fsck --no-progress --strict   # exit 0; "dangling" lines are normal
git --git-dir=../visp-dev-backup.git show-ref                      # main, main-full-history, origin/main
git --git-dir=../visp-dev-backup.git rev-parse main main-full-history
git --git-dir=../visp-dev-backup.git rev-list --objects --all | wc -l

# and against the live repository, which is the only comparison that means anything
git rev-parse main main-full-history
git rev-list --objects --all | wc -l
```

The two object counts should agree, and the two pairs of shas should be
identical. A count that differs by a handful is usually the live repository's
loose objects from an aborted command; a count that differs by hundreds is the
mirror being stale, and the fetch above fixes it.

**Restoring from it** needs no special ceremony — it is a git repository:

```bash
git clone ../visp-dev-backup.git /tmp/visp-dev-restored
git -C /tmp/visp-dev-restored log --oneline -1
git -C /tmp/visp-dev-restored rev-parse HEAD^{tree}    # compare against the live repository's
```

This was done once at preparation rather than left as an assertion — the clone
came back at `c6a2d50` with 114 commits and a HEAD tree sha identical to the
live repository's. A backup nobody has ever restored from is a hypothesis.

## If it goes wrong

Nothing here destroys anything, so recovery is a pointer move:

```bash
git reset --hard main-full-history    # main back to the full history, tree unchanged
```

The reflog (`git reflog main`) holds every intermediate position for 90 days,
and `../visp-dev-backup.git` holds an independent mirror. There is no step in
this runbook after which the old history exists in only one place.

## What this does not fix

Written down because a green run of the above is the output most likely to be
over-read:

- **The old objects are still in this clone.** They are unreachable from `main`
  and reachable from `main-full-history`. Any command that pushes all refs, or
  anyone who is handed a copy of `.git`, still publishes them. The containment
  is a property of *which ref is pushed*, not of the repository.
- **`publish-scan` checks reversal only.** It looks for prefixes of
  `sha256/sha1/md5(taskId)`. It does not do the guard's content scan over
  historical blobs, so a raw task id or a ground-truth path in an old commit
  would not appear in its output. The reason this is judged sufficient here is
  that the *tree* being published is guard-clean and the range being published
  contains only that tree — not that history was scanned for everything.
- **Deleting the pre-push hook is not part of this.** The hook's text describes
  a history rewrite that is deliberately not happening. It stays until the owner
  decides what it should say about a repository whose fix was reachability
  rather than rewriting.
- **The npm package is unaffected either way.** `files` ships `LICENSE`,
  `NOTICE`, `README.md`, `compatibility.json`, `docs/adr`, `registry-state.json`,
  `scripts` and `src`; no `evidence/` path has ever been in a tarball. This is
  about the git remote and nothing else.
