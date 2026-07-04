# 04 — Playback cluster: transport/cue, pads, beatjump + size unification

Status: ready-for-agent

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

- [ ] Library Player and PERF DeckPanel render the shared components;
      duplicated JSX/pointer logic deleted
- [ ] One beatjump size per deck across modes (set in PERF, jump in
      library — same N; editor reads it in slice 05)
- [ ] PERF PLAY latches during load (button no longer disabled)
- [ ] Keyboard behavior unchanged in both modes (A/S, F, Space rules,
      per-deck PERF keys)
- [ ] tsc, eslint, vitest green

## Blocked by

None (independent of 01–03).
