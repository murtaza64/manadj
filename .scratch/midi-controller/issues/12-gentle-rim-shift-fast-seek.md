# 12 — Paused rim = gentle nudges; fast seek moves to SHIFT+wheel

Status: ready-for-human (implemented, change uvywnzqo; checks green — hardware verify of shifted wheel channels pending)

## Parent

`.scratch/midi-controller/PRD.md` (follow-up to 03/11)

## What to change

Velocity-accelerated paused seeking on the bare rim causes surprise travel
(a casual spin jumps minutes). Instead:

- Paused rim (CC #9, unshifted): strictly linear gentle nudges
  (JOG_SEEK_SECONDS_PER_TICK per tick, no acceleration).
- New `jog-seek` relative target on the wheel's SHIFT layer: the
  velocity-accelerated fast seek, deliberate by construction. Seeks while
  playing too (an explicit gesture; Mixxx's shift+wheel behaves the same,
  scratchTick × 4).
- Touch fine seek + release continuation unchanged.

## Mapping

Shifted controls emit on channel+3 (learned: SHIFT+jump deck A = ch 4).
Mixxx's Inpulse 300 XML corroborates: shift-mode wheel messages are status
0x94/0x95 (map ch 4/5), same numbers. Bound: cc ch 4/5 #0x09 (shift+rim)
and #0x0A (shift+touch-spin) → jog-seek A/B, all TODO(hardware-verify).

## Acceptance criteria

- [ ] Bare rim spin on a paused deck never travels more than ticks × 0.05s
- [ ] SHIFT+spin seeks fast, velocity-sensitive, both directions
- [ ] SHIFT+spin while playing seeks (deliberate jump)
- [ ] Touch fine seek and release continuation unchanged
- [ ] Controller + dispatch under vitest
- [ ] make typecheck, eslint on touched files, vitest green
