# 08 — Take promotion re-points Set pins

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Backend behavior at the Take-promotion boundary: when a Take is promoted to a Transition, every Set pin (active or Dormant) referencing that Take is rewritten to the resulting Transition's uuid, at promotion time — a one-time migration, not query-time indirection. The Take model already records its promoted Transition uuid.

## Acceptance criteria

- [ ] Promoting a pinned Take leaves the Set playing the identical (now-promoted) Transition, pin now Transition-kind
- [ ] Dormant Take pins are rewritten too
- [ ] Router tests at the promotion endpoint cover both
- [ ] Pins referencing other Takes are untouched

## Blocked by

- 02-adjacency-pins-evidence
