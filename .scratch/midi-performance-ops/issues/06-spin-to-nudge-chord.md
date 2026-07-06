# Spin-to-nudge: hold a grid-nudge pad and turn the jog for fine grid nudging

Status: ready-for-human
Review: parked on lane midigrid (grid track stack, review lands the prefix); walkthrough in .lanes/midigrid.md and the requesting session; lane app http://localhost:5423

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The chorded fine-nudge gesture, built on one new tested seam — a pure grid-edit chord reducer (action stream in: nudge-pad down/up, jog ticks; commands out: arm, per-tick local nudge, tap step, commit with net offset, disarm):

- Holding either grid-nudge pad arms grid-nudge on that deck. While armed, jog ticks (rim and touch streams) mean fine grid nudge, ~1ms per tick, sign from spin direction — and never reach their normal meanings (Nudge, seek). Release restores plain jog.
- Ticks apply optimistically to the local grid (audibly/visibly live); the accumulated net offset persists in one backend call on pad release.
- Tap = release with zero ticks received → the discrete ±10ms step (issue 05's behavior). No timers or thresholds.
- Document the jog interception as an amendment note on the gesture-class routing ADR (a deliberate carve-out from "jog routes to the audible surface").

## Acceptance criteria

- [ ] Hold-and-spin walks the grid ~1ms per tick with the spin's sign, live against playing audio
- [ ] While armed, the jog produces no tempo Nudge and no seek; release restores both instantly
- [ ] Exactly one persistence call per gesture, carrying the accumulated offset; the persisted grid matches what was heard
- [ ] A tap (zero ticks) still fires the ±10ms step
- [ ] Chord reducer covered at its own seam (tap-vs-hold discriminator, sign, suppression, per-deck isolation), modeled on the transport-reducer tests
- [ ] Gesture-class ADR carries the carve-out note

## Blocked by

- `04-nudge-offset-param.md` (the commit needs arbitrary offsets)
- `05-grid-edit-pad-mode.md` (the pads and targets it chords onto)
