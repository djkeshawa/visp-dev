# Platform support

## Where the evidence can be produced

| Platform | Test suite | Packed-install evidence |
|---|---|---|
| Linux | yes | yes |
| macOS | yes | yes |
| Windows | yes, minus platform-specific fixtures | **no** |

## Why Windows carries no packed-install evidence

The compatibility harness snapshots a commit by writing each blob at its
recorded Git mode and then verifying the mode was applied. A `100755` file is
executable in the snapshot exactly as it is in the commit, and the snapshot is
rejected if that cannot be guaranteed.

Windows has no POSIX mode bits. `chmod` is a no-op there, so the verification
cannot pass, and `snapshotCommit` fails closed with "Committed blob mode could
not be materialized faithfully".

**That refusal is correct.** The harness exists to produce byte-exact and
mode-exact reproduction evidence. Relaxing the check so Windows could proceed
would weaken every snapshot on every platform in order to make one platform
quiet — trading real evidence for the appearance of coverage.

## What this does and does not mean

- It does **not** mean Visp fails on Windows. The product's own test suites run
  there; only the reproduction harness cannot.
- It does mean **no packed-install evidence exists for Windows**, so no claim
  about installing on Windows is supported.
- The conformance report reflects this: the `operating_system` family covers the
  platforms where the evidence is reproducible, and this document states where
  it is not.

## What would change it

A Windows fixture that does not depend on mode-faithful snapshots — proving
something weaker but true, such as that a packed tarball installs and the
binaries run, without claiming byte-and-mode reproduction. That is a different
claim and would be recorded as one, not folded into the existing family.
