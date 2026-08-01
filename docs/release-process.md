# Release Process

## Current status: publication freeze active

Historical decisions D-097 and D-107 authorized the already-published
`visp-kit` and `visp-hyper-agent` artifacts recorded below. Both source
repositories are public.

The controlling D-110 publication freeze is active. C1 authorizes local
implementation, verification, and evidence reconciliation only. It authorizes
no push, tag, pull request, publish, dist-tag, deprecation, or visibility
change. Any future registry or repository action requires a separate explicit
recorded decision, and the preconditions below still apply to each release.

**A published version can never be replaced.** Every correction is a new
version. This document exists so the process is settled *before* it is needed,
not improvised at the moment of release.

## What is public

| Package | Version | State |
|---|---|---|
| `visp-kit` | `0.1.0` | **Deprecated** 2026-07-27 — predates the enforcement-hole fixes |
| `visp-kit` | `0.2.0` | Superseded; its registry page carries the untrimmed README |
| `visp-kit` | `0.2.1` | Superseded; `repository` and `homepage` still 404 |
| `visp-kit` | `0.2.2` | Superseded; first metadata-correct published Kit |
| `visp-kit` | **`0.2.3`** | **Supported**, exact D-107 artifact at `eb70bce` |
| `visp-hyper-agent` | `0.2.0`, `0.3.0` | **Both deprecated** 2026-07-27 |
| `visp-hyper-agent` | `0.4.0` | Superseded; same README timing miss |
| `visp-hyper-agent` | `0.4.1` | Superseded; metadata pointed at private repositories |
| `visp-hyper-agent` | `0.4.2` | Superseded; first metadata-correct published Hyper |
| `visp-hyper-agent` | **`0.4.3`** | **Supported**, exact D-107 artifact at `3538457` |

The first three were published in June 2026, before any security, licence, or
provenance gate existed. `0.2.0`/`0.4.0` went out on 2026-07-29 under D-097, and
the first metadata-correct pair on 2026-07-30 under D-098. The current D-107
pair is identified by the exact five-field identities recorded below.

Each correction is a new version because **a published version can never be
replaced.** `0.2.1`/`0.4.1` fixed a README that shipped minutes before it was
trimmed; `0.2.2`/`0.4.2` fixed `repository` and `homepage` fields that pointed at
repositories which were private and returned 404.

**`0.2.2` and `0.4.2` were the first published versions the earlier conformance
fixtures and compatibility pair described exactly.** The Kit version bump landed
at `5763c18`, but npm published from `ba27687` after the platform-independent LF
checkout pin; the registry records `ba27687` as `gitHead`. That final commit
adds only `.gitattributes`, absent from the `files` allowlist. Hyper `8de5e48`
is both the version-bump and published `gitHead`. Those anchors remain
historical evidence; they are not the current recommendation.

Superseded is not deprecated. `0.2.1` and `0.4.1` carry broken metadata links but
working code, and nothing has deprecated them on the registry. Whether to do so
is an open registry action needing its own recorded decision.

An npm install path may now be cited, and `compatibility.json.supportedRelease`
is the single place that records which versions it names. Do not restate the
versions in prose that has no test binding it to that file; that is how the
README came to claim nothing was installable for a day after it was.

`visp-dev` has never been published and its manifest is marked `private: true`.

## Rules that hold regardless of the freeze

1. **A published version number is immutable content.** Never reuse one. If a
   version exists on the registry, the next release goes above it even when the
   local content is unrelated. `visp-hyper-agent` must never republish `0.3.0`.
2. **A version bump is not a release.** Changing `version` in a manifest records
   identity and publishes nothing.
3. **Identity is a commit plus an artifact hash, never a version string alone.**
   The same version string can carry different content, and on this project it
   already does.
4. **Bump before publishing, never after.** A manifest that declares an
   already-published version is a trap for everyone reading it.

## Preconditions for any first release

All of these, evidenced, before a package is published:

- [ ] The publication freeze is lifted by an explicit recorded decision.
- [ ] Secret tree and history scans pass for every repository being published.
- [ ] Dependency vulnerability and licence review pass, and `NOTICE` carries the
      attribution the licences require.
- [ ] The governance set is present: `LICENSE`, `NOTICE`, `TRADEMARKS.md`,
      `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- [ ] Dogfooding on a real repository is recorded, with outcomes.
- [ ] The disposition of the already-published artifacts is decided and executed.
- [x] A machine-readable SBOM exists for the artifact. `npm run sbom` in
      visp-dev writes `sbom.json` beside each package. Regenerate it as part of
      cutting a release and commit the result — `npm run sbom:check` verifies it,
      but only on the machine doing the release, because `npm pack` is not
      byte-deterministic across machines. It inventories the packed
      tarball, not the pnpm dev tree, so it lists what ships — three components,
      not several hundred build-time ones. `npm sbom` cannot be run in these
      repositories directly; pnpm's layout makes it exit `ESBOMPROBLEMS`.
- [ ] Packed compatibility evidence exists for the exact pair being released,
      pinned by commit and tarball SHA-256.

## Release-candidate assembly

Assembly produces artifacts and publishes nothing.

1. Set the candidate version, above every version already on the registry.
2. Pack from an exact local commit — never from a dirty tree.
3. Record the commit SHA and the tarball SHA-256 for every artifact.
4. Install the packed tarballs into clean fixtures and run the compatibility
   matrix. Workspace links do not count: they hide packaging defects.
5. Write the changelog, the compatibility report, and the known limitations,
   including the disposition of the deprecated versions.

## Publication

Only after the gate passes.

1. Re-verify each artifact's SHA-256 immediately before upload. The hash proven
   at assembly is only meaningful if the bytes uploaded are the same bytes.
2. Publish with provenance attestation enabled where the registry supports it.
3. Record the published version, its commit, and its hash in the compatibility
   evidence.
4. Confirm the published artifact installs from the registry into a clean
   fixture and reports the expected version.

## Rollback

Deprecate; do not unpublish. Unpublishing breaks everyone who pinned the
version, and mirrors mean the content does not actually disappear. A deprecation
notice should say what is wrong and what to use instead — and if there is no
fixed version yet, it should say that plainly rather than implying one exists.

## Rebuilding the offline compatibility environment

The packed-pair runs need an offline pnpm store and npm cache. Both live in a
scratch directory and do not survive a reboot, so they get rebuilt. Three
things go wrong every time, so they are written down:

1. **The real pnpm store cannot be used directly.** It contains symlinks that
   escape its own root and the harness refuses them, by design — an escaping
   link means the snapshot is not self-contained.
2. **`pnpm fetch` wants to purge `node_modules`.** Run it against a throwaway
   directory holding only `package.json` and `pnpm-lock.yaml`, never against a
   working repository.
3. **`pnpm fetch` leaves its own escaping symlink** under `v11/projects/`,
   pointing at the directory you fetched from. Delete every symlink in the
   store afterwards; they are link-tracking bookkeeping, not package content.

```bash
STORE=/tmp/visp-store CACHE=/tmp/visp-cache

for repo in visp-kit visp-hyper-agent; do
  mkdir -p "/tmp/fetch-$repo"
  cp "../$repo/package.json" "../$repo/pnpm-lock.yaml" "/tmp/fetch-$repo/"
  (cd "/tmp/fetch-$repo" && pnpm fetch --store-dir "$STORE")
done
find "$STORE" -type l -delete
```

The npm cache must be populated by a **real install**, not a lockfile-only run,
or the packed tarball install fails with `ENOTCACHED` on the runtime
dependencies:

```bash
mkdir -p /tmp/cache-build && cd /tmp/cache-build
echo '{"name":"c","version":"1.0.0","private":true}' > package.json
npm install commander@^12.1.0 zod@^3.25.76 --cache "$CACHE"
```
