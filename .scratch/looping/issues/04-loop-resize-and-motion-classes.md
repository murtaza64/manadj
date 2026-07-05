# Loop resize (halve/double) and playhead-motion classes

Status: done (implemented, change psuxxuys)

## Parent

`.scratch/looping/PRD.md`

## What to build

Complete the Active loop's live semantics (grilled 2026-07-05).

**Resize**: the LoopRow becomes `[½] [LOOP N] [×2]`, mirroring the beatjump row idiom, in both Deck surfaces. When idle, ½/×2 adjust the per-Deck pending size; when looping, they resize the active region live. Lengths clamp to powers of two, 1/8–32 beats (sub-beat lengths are legal — start snapping and length are independent). Halve keeps the start edge; double extends the end edge; both derive from the region start, never the playhead. If a shrink strands the playhead outside the region, it re-enters at start + (old offset mod new length) — phase-mod re-entry, so rapid halve-halve-halve build-ups stay in the groove. No keyboard size keys.

**Motion classes**: relative displacement (beat jump) translates the active region by the same displacement — position-in-loop is preserved, and you cannot beat-jump out of a loop. Absolute relocation (Hot Cue trigger, cue return, waveform seek — even to a point inside the region) cancels the loop. There is no "armed but playhead elsewhere" state.

## Acceptance criteria

- [ ] ½/×2 adjust pending size when idle and resize the region live when looping; sizes clamp 1/8–32; the LOOP button label tracks the size
- [ ] Halve with the playhead in the back half relocates it by phase-mod re-entry; audible roll never stumbles
- [ ] Beat jump while looping translates the region with the playhead (audibly seamless roll at the new position)
- [ ] Hot Cue trigger, cue return, and seek cancel the loop and relocate plainly
- [ ] Reducer tests: clamps, pending-vs-active resize, start-edge anchoring, phase-mod re-entry, translate-on-beat-jump, cancel-on-each-absolute-gesture

## Blocked by

- `03-minimal-audible-loop.md`

## Comments

**2026-07-05 — Done** (jj change `psuxxuys`, workspace looping). Reducer gains `loop-resize` (idle: pending-size adjust; looping: live resize anchored at the start edge, end reprojected via `addBeats`, pending size tracks the active size; clamp via `clampLoopBeats` 1/8–32; shrink stranding the playhead relocates to start + offset mod new length with a restart splice while audible) and `jump` (relative displacement: region translates with the playhead, start clamped ≥ 0 length-preserving). Absolute relocations cancel the loop: `seek` (even inside the region), `hot-cue-down` (both branches), cue return while playing, and cue preview return; cue SET while paused deliberately keeps it (placement, not relocation); pause/play keep it. Engine: `jumpBeats` now dispatches `jump`; new `resizeLoop(change)` that also works with no Track loaded (pending size is a Deck preference). LoopRow is now `[½] [LOOP N] [×2]` in both surfaces (no keyboard size keys, per spec). Tests: reducer loop-resize block (clamps, start-edge anchoring, phase-mod re-entry incl. paused, ahead-of-region no-op) + motion-classes block (translate, clamp-at-0, cancel per gesture, pause/play keep); engine tests for no-track resize and translate/cancel.
