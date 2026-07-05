# 08 — Take promotion re-points Set pins

Status: done (landed on main, change xkwwqkuv)

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

## Comments

**2026-07-05 — implemented (lane setpins, change xkwwqkuv), parked ready-for-human.**

- Server: `set_promoted` (`backend/routers/takes.py`) now bulk-rewrites
  every set_entries pin `("take", <uuid>)` → `("transition", <promoted
  uuid>)` at promotion time — one-time migration per ADR 0023. Clearing
  (PATCH null) rewrites nothing. Router tests:
  `tests/test_take_promotion_repoints_pins.py` (takes+sets mounted
  together): rewrite, every-Set fanout, other-pins-untouched, null-clear.
- Client: `repointTakePinsLocal` in `setStore.ts` (additive), called from
  the editor's `promoteTake` after the PATCH — entries are
  client-authoritative, so without the mirror a loaded Set's next
  wholesale PUT would clobber the server rewrite with the stale Take pin.
  Covered in `setStore.test.ts`.
- Dormant pins: no Dormant storage exists yet (issue 07 unstarted) — the
  "Dormant Take pins are rewritten too" criterion can't act on anything
  today. Obligation recorded on issue 07 (its storage must join this
  rewrite, the delete degradation, and the promotion hook).
- Gate: pytest 645, vitest 821, build, eslint clean on touched files,
  alembic single head (no migration).

Verification walkthrough: see the note on issue 12 (both issues reviewed
together at http://localhost:5293, lane app running).
