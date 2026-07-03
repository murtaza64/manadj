# 07 — Loaded tracks persist across refreshes and mode switches

Status: ready-for-agent (claimed 2026-07-03, in progress)

## Parent

`.scratch/mix-editor/PRD.md`. User-requested iteration 2026-07-03.

## What to build

One canonical "what's loaded on A/B", shared by all modes and persisted:

- DeckProvider persists the shared decks' loaded track ids to localStorage
  and restores them on boot (fetch + Load, paused — Load allocates audio
  memory but nothing plays).
- Transition-editor loads also Load the corresponding shared deck (guarded
  by id), so switching to Performance/Library shows the same tracks.
- Editor adoption on entry prefers the shared decks' loaded tracks per slot,
  falling back to its saved last-pair, then the prototyping default pair.

## Acceptance criteria

- [ ] Load Weeble Wobble → Last Time in the editor, refresh: Library mode
      shows Weeble Wobble on deck A; Performance shows both
- [ ] Loads made in Library/Performance appear in the editor on next entry
- [ ] Refresh directly into the editor restores the pair
- [ ] No autoplay on restore; StrictMode dev double-mount does not
      double-load
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None - can start immediately.
