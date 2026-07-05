# 01 — Stretcher bake-off: Signalsmith vs Rubber Band, by ear

Status: done — verdict recorded (Signalsmith), prototype abandoned

Type: prototype

## Parent

`.scratch/key-lock/PRD.md`

## What to build

A throwaway dev page (the /midi-inspect pattern: standalone route, no engine
integration, never lands on main — prototype rules) that answers ONE
question: does Rubber Band WASM (GPL) beat Signalsmith Stretch (MIT) clearly
enough by ear at DJ ratios to justify its license?

- Load a Track's audio, play it through a minimal worklet harness with
  prime-and-drop (ADR 0018), A/B toggle between the two stretchers and a
  plain-resample reference.
- Pitch slider ±8%; key-lock on/off; a "cue stab" button to judge onset
  cleanliness after prime-and-drop.
- Show CPU per process() (rolling average) for each engine; sanity-check two
  simultaneous instances.

## Verdict procedure (human)

Listen with sustained pads/vocals (phasiness) and dense percussion
(transient smear) at ±2/±5/±8%. Decision rule from the PRD: Rubber Band must
win CLEARLY; ties go to Signalsmith. Capture the verdict as a comment here,
then abandon the prototype change.

## Acceptance criteria

- [x] Both stretchers audible through the same harness, level-matched
- [x] Resample reference for honesty
- [x] CPU numbers for 1 and 2 instances
- [x] Verdict comment recorded; prototype abandoned

## Blocked by

None.

## Comments

- **VERDICT (human listening session, 2026-07-05): Signalsmith Stretch.**
  Rubber Band R3 (`EngineFiner | PitchHighConsistency`, rubberband-wasm
  3.3.0) showed audible artifacts at DJ ratios where Signalsmith sounded
  better — the "clearly wins" bar for accepting GPL was not met; it lost
  outright. CPU agreed: RB ≈ 3.4% of quantum budget per playing instance,
  Signalsmith barely registered (<0.2%). Issue 03 uses
  **signalsmith-stretch (MIT, 1.3.2, first-party WASM)**.
- Harness (throwaway change `pskvwvon`, abandoned after this verdict):
  `/stretch-bakeoff` route, two decks on one context, per-deck Key Lock
  toggle (off = production deck-source resample reference), stretcher
  radio, ±8% pitch, cue stab, live per-processor CPU meters via a
  registerProcessor-wrapping timing shim.
- Integration notes for issue 03, learned building the RB harness (apply
  to any WASM inside the deck-source worklet):
  - A `WebAssembly.Module` does not survive the structured clone into an
    AudioWorklet (silently dropped as a `messageerror`); transfer the raw
    bytes instead. (CORRECTION while building issue 03: this clone drop
    was the real bug behind the "async WASM hangs on the audio thread"
    claim first recorded here — Signalsmith's own factory async-
    instantiates on the worklet thread and works. Sync instantiation
    remains the safe default, but it is not mandatory.)
  - signalsmith-stretch's npm API is a main-thread node factory that
    registers its own processor from a self-contained Blob module; using
    it INSIDE our dual-mode worklet means driving its emscripten module
    directly (`_seek`/`_process` + heap buffers) — its .mjs runs in both
    scopes by design, so this is feasible but is issue 03 design work.
