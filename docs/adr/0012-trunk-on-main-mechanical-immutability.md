# Trunk on `main` with mechanical immutability

Status: accepted (2026-07-04)

## Context

Multi-agent work (3-4 concurrent lanes) accumulated 4+ long-lived divergent heads
with a stale `main` bookmark far behind. Integration was a periodic, human-triggered
octopus merge whose expensive part was *discovering and coordinating* topology, not
resolving conflicts (the 2026-07-04 consolidation merged ~3.4k lines with zero
conflicts). The same day produced several rewrite accidents: an agent amending a
change another agent's stack descended from, a change going divergent under a
concurrent operation, and a working-copy change being split and reused by another
agent. Every one of these was a mutation of history that should have been settled.

## Decision

Adopt trunk-based flow with the existing `main` bookmark as trunk. Lanes branch off
`main`; short lanes land by rebasing onto the tip and moving `main` after a green
verification gate; long-lived lanes catch up by merging trunk in, and land via a
named merge commit. Detailed rules in `docs/agents/parallel-work.md`.

`main` was chosen over a new `trunk` bookmark deliberately: jj's `trunk()` revset
resolves to `main`, and jj treats `trunk()::` as immutable by default — so advancing
`main` makes integrated history mechanically unrewritable. One config nuance: the
default alias resolved `trunk()` to `main@origin` (the GitHub remote), which would
tie immutability to pushes; the repo config re-pins it to local `main`
(`revset-aliases."trunk()" = "present(main)"`) so immutability is instant and
offline. Pushing to origin remains backup hygiene, decoupled from the gate. The "never rewrite landed
changes" rule is enforced by the tool, not by convention; accidental amends/rebases
of landed work fail instead of silently rebasing other agents' stacks.

## Trade-offs

- Against the status quo (consolidation merges): trunk advances continuously, so
  lanes drift hours not days, and the integrator role shrinks to conflict
  arbitration. The consolidation-merge pattern remains valid for long-lived lanes.
- Against strict serialization: parallelism is the point; a single shared line
  would queue 3-4 agents behind each other.
- Cost accepted: rebase-then-gate retry loops when two lanes land simultaneously,
  and history behind `main` genuinely cannot be amended (fixes become new changes —
  which is already house style).
