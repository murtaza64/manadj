# 37 — Edit click-through must not silence a conducting set (extend 21's lazy claim)

Status: needs-triage

## Parent

.scratch/sets/PRD.md (human feedback 2026-07-06, during sets 24 review)

## Problem

Set row → edit (the sets 09 adjacency click-through) silences a playing
Conductor. `TransitionEditor.openPair` (and `openTake`) call
`ensureEditorAudible()` BEFORE loading — the arbiter's `silence()` pauses
the Conductor's decks. This is deliberate, documented residue of sets 21
(its Done comment: "openPair/openTake claim eagerly before loading:
opening an artifact loads the shared Decks (ADR 0022), so whatever
sounds stands down first — sets 09 behavior kept"). 21 made only *plain
mode entry* lazy.

Sets 24 (live re-plan) makes that boundary wrong: the headline loop is
"set playing → click edit on an adjacency → drag lanes → hear the
ongoing set change". Today the click kills the music; the loop only
works by entering the editor plain (mode switch) and having it adopt
whatever the decks hold.

## Direction (grill at triage)

- While another surface holds audibility, `openPair` should load the
  SESSION only (pairKey, transition selection, editor model — a mounted
  editor is already a pure model under 21's MixPlayer gate) and claim
  NOTHING; defer the shared-deck loads to the first audition gesture
  (`ensureEditorAudible` → holder stands down → THEN load both decks →
  play when ready; `auditionTogglePlay`'s `ready()` gate needs the
  deferred-load plumbing).
- Editor waveform strips read the shared decks, which mid-set hold the
  Conductor's tracks, not the opened pair — decide what the deferred
  state shows (wrong-track waveforms are confusing; empty strips or
  track-facts rendering may be better).
- Free case: editing the SOUNDING adjacency — the decks already hold the
  right pair (adopt-on-entry no-op rule), nothing to defer.
- Sequencing: same territory as 28 (foreign load = takeover, triaged,
  held until 24 lands) — the deferred loads must compose with 28's rule,
  and both touch the same editor/conductor seams. Dispatch together to
  the Conductor-owning lane after 24 lands.

## Blocked by

- 24-live-replan (parked ready-for-human)
- Coordinate with 28-foreign-loads-during-conduction (held for the same reason)
