# 04 — Playback cluster: transport/cue, pads, beatjump + size unification

Status: ready-for-human — implemented in `oxqlwkpv` (deck-controls: 04-playback-cluster)

By-eye checklist for the human:
- [ ] Library: beatjump row shows curved jump arrows + `1/2`/[size]/`x2`; size sticks and A/S jump by it
- [ ] PERF: set beatjump size on a deck, flip to library — same N on the buttons and A/S keys
- [ ] PERF PLAY pressable mid-load (latches, starts when decoded); CUE still disabled until ready
- [ ] PERF CUE now flashes when paused away from the cue point (at-cue poll came along) — intended
- [ ] PERF nudge buttons read ◀◀/▶▶; grid/BPM controls untouched
- [ ] Library controls overlay widened 140→170px to fit the size stepper — check it doesn't crowd the waveform
- [ ] Kbd hints still render on PERF pads 1-4, jump, cue, play

## Parent

`.scratch/deck-controls/PRD.md` (playback class).

## What to build

Shared components for the library view + Performance view (the editor's
gesture variants are slice 05):

- `TransportPair` (PLAY + hold-CUE): one pointer-capture cue
  implementation; PERF's PLAY adopts latch-while-loading (library
  behavior, keyboard parity); library's at-cue styling poll comes along.
- `HotCuePads`: the existing `HotCue` + `useHotCueActions` pair,
  formalized as the only pad surface (kbd-hint slots for PERF).
- `BeatjumpRow` (◀◀ − size + ▶▶): ONE per-deck size in DeckContext,
  default 32, adjustable in-session — the library's hardcoded
  `BEATJUMP_BEATS` constant and its constant-twin in `beatjump.ts`
  collapse to one; the library gains the stepper.
- Merge the duplicated `ScrubTransport` literals (keep PERF's ready-guard
  on seek).
- Icons (PRD icon language): beatjump buttons use the curved jump-arrow
  SVGs; bend/nudge hold-buttons use ◀◀/▶▶; beatjump size halve/double
  reads `1/2` / `x2` (replacing −/+).

## Acceptance criteria

- [x] Library Player and PERF DeckPanel render the shared components;
      duplicated JSX/pointer logic deleted
- [x] One beatjump size per deck across modes (set in PERF, jump in
      library — same N; editor reads it in slice 05, via the
      `PERFORMANCE_BEATJUMP_DEFAULT` alias until then)
- [x] PERF PLAY latches during load (button no longer disabled)
- [x] Keyboard behavior unchanged in both modes (A/S, F, Space rules,
      per-deck PERF keys; library A/S now use the per-deck size)
- [x] tsc, eslint, vitest green

## Blocked by

None (independent of 01–03).
