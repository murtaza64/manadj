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

## Comments

**2026-07-06 (lane midigrid)**: The new tested seam is `frontend/src/midi/gridChord.ts` — pure reducer (`reduceGridChord`: pad-down/up + jog-ticks in; pass-jog / local-nudge / tap-step / commit out; 1ms/tick; any-tick-received = hold, zero-net hold commits nothing; second pad ignored mid-gesture; per-deck state) + `shiftBeatgrid` (the rigid optimistic cache translate). Dispatch folds it as its one piece of state (`_resetGridChordForTests`); rim and touch ticks flow through the fold BEFORE surface routing, so armed ticks reach no surface's jog meanings (editor included); jog-seek (SHIFT) stays surface-routed. `grid-nudge` down now arms, release decides tap vs commit. Registry gained `gridNudgeLocal` (queryClient.setQueryData shift — engine + waveform follow the cache live via useDeckBeatgridSync) and `gridNudgeCommit` (one POST with the net offset through the serialized nudge chain; refetch settles local vs server). ADR 0019 carries the carve-out amendment. Tests: gridChord.test.ts (17, modeled on transport.test.ts) + spin-to-nudge describe in dispatch.test.ts. `npx vitest run` 1192 green, tsc clean.

**2026-07-06 (lane midigrid, in-session follow-ups after review)**: Grid track 04-06 verified by the human and landed (merge `zokurwzq`). Two in-session-approved additions landed after: (1) BPM readouts show 2dp when non-integer (`formatBpm` at rest + in the `(var)` readout — a Grow/Shrink step is now visible without focusing); (2) hold-to-jog grow/shrink — holding pad 5/6 arms a BPM chord in the same reducer (0.01 BPM/tick, integer tick accumulation, sign = spin direction with clockwise up; tap still ±0.03; one serialized commit of the net delta on release via new `gridBpmAdjust`; no per-tick optimistic apply since re-tempo math is server-side). Halve/double stay plain taps. One chord per deck across kinds. ADR 0019 amendment wording widened to both chords.
