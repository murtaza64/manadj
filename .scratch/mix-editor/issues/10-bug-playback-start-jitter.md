# 10 — BUG: visual jitter at playback start (Performance + Transition editor)

Status: ready-for-agent (claimed 2026-07-03, in progress)

## Symptom

Visual jitter (audio fine) at playback start: editor on play and on track-B
entry; Performance on either deck's play. Same feel as the previously fixed
library-mode bug (per-frame DOM/layout work throttling the render loops —
the fix then moved the time readout into the waveform canvas).

## Causes found

1. Editor subscribes the WHOLE tree (incl. the embedded library table) to
   player/engine emits — emits fire exactly at play and at deck-B entry.
2. Editor mix playhead writes `style.left` per frame — a layout property,
   invalidating layout each frame for a document containing the table.
3. PerformanceView subscribes to deck-lock booleans at view level — they
   flip exactly at play/pause → full-view re-render incl. the table.
4. `DeckEngine.setRateComponents` emits even when pitch/bend are unchanged —
   lane drags spam applyPitch → emit → editor full-tree re-render per event.

## Fix

- Editor: memoize the embedded Library element (stable props → React skips
  the subtree on editor re-renders); playhead moves via `transform`.
- Performance: `tryLoad` reads deck lock imperatively; the `.perf-library`
  lock-dim classes move into a small self-subscribing wrapper — the view no
  longer re-renders on play/pause.
- DeckEngine: `setRateComponents` no-ops (no emit) when components are
  unchanged.

## Acceptance criteria

- [ ] No visible jitter at play / B-entry in the editor, or at play in
      Performance
- [ ] Lock dimming + lock hints still work in Performance
- [ ] tsc, eslint on touched files, vitest green
