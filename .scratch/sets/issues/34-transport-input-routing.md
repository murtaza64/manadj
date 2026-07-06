# 34 — Transport input routing: controller = decks, spacebar = Conductor

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (discussed + decided 2026-07-05)

## Problem

The Controller's play button currently drives the Set toolbar's transport. That violates the gesture-class model: deck transport is a deck-class gesture (ADR 0013), and the Conductor is not an Audible surface (ADR 0024) — its transport is a view-level control. It also undermines takeover coherence: hands on the physical deck controls should always mean the decks.

## Decisions

1. **Controller transport always controls the Decks.** During conduction, controller play/pause is a takeover trigger, exactly like the on-screen deck buttons (the original 04 rule). The Controller gets NO Conductor access in v1 — no hijacked buttons; if ever added, it's an explicit Mapping entry (dedicated pad), never deck play. Transport LEDs mirror deck state (Feedback mirrors on-screen deck reality), not Conductor state.
2. **Spacebar drives the mix-level transport of the current context**:
   - Editor mounted → audition toggle (unchanged)
   - Otherwise, a Set selected (in the mounted browse view) → **Conductor**, including in the Performance view — the set wins over the focused deck; per-deck keys keep deck toggles
   - Otherwise → existing behavior (library deck)
3. **Space resolves statefully, in priority order**: conducting → pause; paused mid-set → resume; stopped with Pickup lit → **pick up**; else → play from start. Pickup outranks restart deliberately: mid-flow recovery is common, accidentally restarting a two-hour set is the worse failure. (Play-from-selected-row stays on the row ▶ buttons; space never targets a row.)

## Acceptance criteria

- [ ] Controller play/pause acts on decks in every mode; during conduction it takes over (Conductor stops, audio continues)
- [ ] No Mapping entry drives the Conductor; transport LEDs follow deck state during conduction
- [ ] Space in the editor: audition toggle, unchanged
- [ ] Space with a Set selected (library and Performance): pause / resume / pickup / play-from-start per the priority order
- [ ] Space with no Set selected: unchanged from today
- [ ] Keyboard focus rules unchanged (no space handling while an input/textarea/contenteditable is focused — the keyboard-focus conventions)

## Notes

- Touches: keyboard dispatch for the browse/Set surfaces, the MIDI dispatch's transport routing (undo whatever wired play→Conductor — find it via the 04/22 changes), conductorStore transport entry points (pickup-lit state already exposed for the toolbar button). No planner/model changes.
- Sequencing: keyboard/MIDI dispatch is app-wide — check `.lanes/` (editor-midi and perfui lanes have historical claims); coordinate if any input-layer lane is active at dispatch time.

## Blocked by

- Soft: 24-live-replan in flight on the Conductor-owning lane (transport entry points may shift under it) — dispatch after 24 parks
