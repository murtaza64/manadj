# 01 — Stretcher bake-off: Signalsmith vs Rubber Band, by ear

Status: ready-for-agent (harness); verdict is ready-for-human by nature

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

- [ ] Both stretchers audible through the same harness, level-matched
- [ ] Resample reference for honesty
- [ ] CPU numbers for 1 and 2 instances
- [ ] Verdict comment recorded; prototype abandoned

## Blocked by

None.
