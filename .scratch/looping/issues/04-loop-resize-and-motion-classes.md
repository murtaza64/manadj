# Loop resize (halve/double) and playhead-motion classes

Status: ready-for-agent

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
