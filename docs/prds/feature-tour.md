# PRD: Feature tour

Feature slug: `feature-tour`. Decided 2026-10-06.

## Problem Statement

New users land in a dense, keyboard- and controller-driven UI with no
explanation and blank surfaces when the Library is empty.

## Solution

A Tour: per-section coach marks (spotlight + popover, a few steps each)
shown the first time a user enters each major area, replayable from a `?`
button in the TopBar. Empty states with guidance wherever an empty Library
leaves a blank surface.

## User Stories

1. First time I open each area (Library/EXPORT, PERFORM, EDIT, SYNC, Sets,
   Sessions/HISTORY, Settings) I get 3–6 steps pointing at its key controls.
2. I can skip a section's tour or all tours; Escape closes.
3. I can replay any section's tour from the TopBar `?`.
4. Tours don't fire during First run's welcome screen; they start after.
5. Steps whose anchor isn't rendered are skipped, not broken.
6. Empty track table, playlists, sets show what to do next (matching existing
   copy style, e.g. "No Takes yet — …").
7. Settings can reset tour progress (also used for demoing).

## Implementation Decisions

- In-house component; no new dependency. No animation (DESIGN.md D9).
  Tokens only; propose a `--z-tour` tier in DESIGN.md if `--z-modal` doesn't
  fit.
- Anchors: `data-tour="<section>.<step>"` attributes.
- Steps are data (one module per section), not JSX scattered across views.
- Progress in a persisted setting `manadj-tour-state` (per-section seen),
  added to `PERSISTED_SETTING_KEYS`.
- Keyboard: tour Escape/arrow handling in capture phase and claims the event;
  decide deliberately whether the tour uses `role="dialog"` (silences deck
  hotkeys via `hasKeyboardOverlay`). Respect the no-focus rule.
- Hardware MIDI input continues to work under the tour.

## Testing Decisions

Vitest (jsdom) for step sequencing, skip-missing-anchor, persistence. Visual
check in an empty-DB lane app and the real-DB clone.

## Out of Scope

Interactive "do this action" tutorials, video, localized copy.
