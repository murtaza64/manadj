# 38 — Editor: live Conductor playhead over the loaded transition

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (human feedback 2026-07-06, during sets 24 review)

## What to build

While a Conductor is playing and its sounding window executes the
transition loaded in the editor, render a live playhead marker across
the editor's lane timeline — so live-editing a set's sounding adjacency
(the sets 24 loop) shows WHERE in the window the set currently is.

- Match: `soundingWindowAt(getConductor().plan, mixTime)` (sets 24,
  `replan.ts`) against the editor's selected transition uuid —
  `SoundingWindow.pinUuid` (`PlannedAdjacency.pinUuid`, added by 24).
- Position: the marker lives on the AUTHORED window axis. Authored
  seconds = `sounding.transition.startSec + (mixTime − adj.mixStartSec) ·
  adj.rateOutgoing` (planner's `authoredLocalAt`); lane x =
  `(authored − startSec) / durationSec`, hidden outside [0, 1).
  Compute from the EXECUTED adjacency's geometry: during a deferred
  geometry edit (24's graft) the editor draws the NEW window while the
  Conductor executes the OLD — the executed mapping is the truthful one.
- The graft preserves `pinUuid` on the lanes-live path, so the marker
  survives mid-window edits; a re-pin mid-window grafts under
  `GRAFT_PIN_UUID` and the marker correctly disappears (the sounding
  window no longer executes the loaded transition).
- Refresh outside React (playheads move continuously): rAF or the
  pickup poll's 250 ms cadence; only the marker position enters state.
- Scope: one vertical marker over the lane stack; waveform-strip echoes
  can come later.

## Acceptance criteria

- [ ] Set playing into a pinned window + that transition loaded in the editor → marker tracks the conductor through the window, matching what is heard
- [ ] Different transition loaded (or conductor idle / outside the window) → no marker
- [ ] Dragging lanes while the marker is live: values change audibly (24) and the marker keeps tracking
- [ ] Mid-window geometry drag (deferred by 24): marker stays truthful to the EXECUTED window until it completes

## Blocked by

- 24-live-replan (parked ready-for-human — provides `pinUuid`, `soundingWindowAt`)
