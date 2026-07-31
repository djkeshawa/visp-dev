# ADR 0001: Visp Dev Owns Machine-Scope Verbs Only

- **Status:** Proposed
- **Date:** 2026-08-01
- **Workspace decision:** D-106

## Context

Workspace decision D-106 adopts a single thirteen-verb vocabulary exposed as
`visp`. Two of those verbs are machine-level rather than project-level:

- `setup` — install a matched Kit and Hyper pair, register MCP for the host
- `doctor` — report whether anything is broken

Visp Dev is the natural owner. `planning/architecture-boundary.md` already
assigns it "one-command setup" and "compatibility matrix", and this repository's
own roadmap states the goal as "one understandable, installable public alpha
without creating another policy, workflow, evidence, Memory, or orchestration
engine."

That creates a tension the surface plan originally papered over. The dispatcher's
safety rule is that it routes and never decides, and the Control Plane conditions
say Visp Dev "never appears on a verb's runtime path." Owning two verbs is, on a
literal reading, appearing on the runtime path of two verbs.

Stating an absolute the design already violates is worse than stating a bounded
exception, because an absolute nobody can satisfy stops being checked.

There is a second, quieter reason to be careful here. This repository's value is
that it is an **independent witness** to what is installed — its evidence pins
commits and tarball hashes. A package cannot attest to bytes it ships itself. Any
growth of Visp Dev toward runtime work erodes the one thing it is uniquely good
at.

## Decision

**Visp Dev owns `setup` and `doctor`. It owns nothing else in the verb surface.**

The rule is qualified explicitly rather than left as an absolute:

> Visp Dev may own **machine-scope** verbs. It may never own a **project-scope**
> verb, never appear on the runtime path of one, and egress may never gate any
> verb.

Concretely:

1. **`visp setup` installs and configures. It never runs a workflow.** It resolves
   a compatible pair, installs it, writes MCP registration for the detected host,
   and reports what it did. It never invokes Kit's gates, never reads workflow
   state, and never reports a verdict.
2. **`visp doctor` aggregates diagnostics, not verdicts.** It may report that Kit
   is unhealthy, that versions are mismatched, or that a registration is missing.
   It may never report that work is allowed, blocked, verified, or ready — those
   are Kit's, and a diagnostic that shades into one of them has crossed the line.
3. **The project-scope forms belong to Hyper.** Where a per-project `setup` or
   `doctor` is needed, it is `visp setup` / `visp doctor` dispatched to Hyper,
   distinct from `visp-dev setup` / `visp-dev doctor` at machine scope.
4. **Visp Dev stays off the runtime path of the other eleven verbs.** No verb may
   call into this repository during work.

## Consequences

- All thirteen verbs survive; the exception is written down with its boundary
  rather than discovered later by someone reading the absolute.
- **`visp setup` is entirely net-new.** This repository has no installer and no
  `setup` command today — the CLI is `doctor`, `init` and `versions`, and `init`
  only prints steps. Nothing in Kit or Hyper writes MCP registration either: a
  repository-wide search for `mcpServers` and `.mcp.json` returns nothing. The
  only precedent anywhere is Memory's Codex hook installer, which the surface plan
  removes from the supported path. Budget a per-host registration writer as new
  work.
- The independent-witness property is preserved: Visp Dev still installs and
  attests to packages it does not contain.
- When the Control Plane arrives, this ADR is what makes Visp Dev a defensible
  candidate sender — sending is not deciding, and a sender that never sits on a
  project-scope verb's runtime path cannot gate work by failing.
- A completion gate asserts the boundary directly: no project-scope verb resolves
  to this repository.

## Alternatives considered

**Drop `setup` from the vocabulary, leaving twelve verbs plus a bootstrap
command.** Keeps the safety rule absolute at the cost of the first word a new user
needs. Rejected: the rule survives being qualified, and the vocabulary is worse
without the verb that starts it.

**Give Visp Dev the whole surface.** Rejected outright. It contradicts the
recorded non-engine role, makes the installer runtime-critical, and destroys the
independent-witness property.
