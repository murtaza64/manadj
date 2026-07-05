# Phase-preserving Hot Cue triggers under Quantize

Status: done (implemented, change vrwtykmm)

## Parent

`.scratch/looping/PRD.md`

## What to build

Quantized *triggering*: with Quantize on and the Deck playing, a Hot Cue trigger is a **phase-preserving jump** — it executes immediately, landing at the cue position plus the playhead's current intra-beat phase. The invariant (glossary): every quantized jump is a whole-beat displacement of the playhead. Pad work therefore never knocks the groove off the grid against the other Deck. Never deferred — no waiting for the next gridline.

Deliberate consequences to preserve, not fix:

- A quantized Hot Cue jump does not land exactly on the cue unless the playhead was on a gridline (CDJ convention).
- Hot Cue trigger while **paused** is a seek — lands exactly on the cue regardless of the toggle.
- Beat jump (already an exact whole-beat displacement) and cue return (stops/previews) are outside Quantize's authority and must not change behavior with the toggle.
- Quantize off, or a gridless Track: triggers land exactly on the cue.

## Acceptance criteria

- [ ] Quantize on + playing: Hot Cue trigger lands at cue + intra-beat phase, immediately (whole-beat displacement)
- [ ] Quantize off, or gridless Track: trigger lands exactly on the cue
- [ ] Paused trigger lands exactly on the cue regardless of the toggle
- [ ] Beat jump and cue return behavior is identical with the toggle on and off
- [ ] Transport-reducer tests cover all four: phase-preserved landing, exact-off, paused-exact, ungoverned gestures

## Blocked by

- `01-quantize-toggle-placement-snapping.md`

## Comments

**2026-07-05 — Done** (jj change `vrwtykmm`, workspace looping). `phasePreservingJumpTarget(cue, playhead, beatTimes)` in `playback/quantize.ts`: landing = nearest gridline to the cue + the playhead's intra-beat phase (whole-beat displacement; degrades to exact without a grid or with the playhead before the first beat). Reducer applies it only on the `hot-cue-down` playing branch — paused triggers, seek/beat-jump, and cue return untouched. Also moved DeckEngine's `hotCue` capture tap after the reducer so recorded evidence is the actual landing, not the raw cue time (Take vectorization measures jump deltas from it). Tests: quantize.test.ts phase-target block; transport.test.ts phase-preserving describe (on/off/gridless/paused/seek-exact).
