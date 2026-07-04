# 13 — Timeline waveform redesign: stacked half-waveforms

Status: closed (implemented change `kzsnnmwu`; user-verified 2026-07-04)

## Parent

`.scratch/mix-editor/PRD.md` (Timeline waveform redesign). Prototype
iteration.

## What to build

Restack the editor timeline per the PRD: A lanes / A half-waveform / seam /
B half-waveform / B lanes.

- `WebGLRendererConfig` gains an amplitude-anchor option (`center` default,
  `top`, `bottom`) — config-only, applied at construction like
  `waveformBrightness`. Editor row A uses `top` (peaks grow down), row B
  `bottom` (peaks grow up). Minimap-mode behavior unchanged.
- Rows sit flush (no gap) forming the seam; the transition-window highlight
  continues to span both rows and their lane strips.
- Lane strips relocate: A's above its waveform, B's below (currently both
  pinned under their rows). Sticky lane labels, guide-line mapping, and the
  chop stamp keep working.
- Beat ticks, cue lines, hot cue markers/badges render within each half's
  height. Playhead spans the full stack.
- Reclaimed vertical space: keep the editor's total height; let waveform
  halves + lane strips breathe (exact proportions are taste — iterate live).

## Acceptance criteria

- [ ] Layout order matches: A lanes / A wave (peaks down) / B wave (peaks
      up) / B lanes; quiet audio hugs the outer edges, loud peaks meet at
      the seam
- [ ] Beat alignment between tracks is readable at the seam during a
      tempo-matched blend
- [ ] No overlap: each half renders only its own deck; transition highlight
      spans the stack
- [ ] Hot cues, beat ticks, cue lines, playhead all correct in both halves
- [ ] All non-editor surfaces (Player, Practice/Performance, minimaps)
      pixel-identical (default `center` anchor)
- [ ] Lane editing (draw, drag, chop stamp, endpoint rendering) unaffected
      by the relocation
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately. (Touches the same row-rendering code as
issue 05's brightness knob — coordinate if both are in flight.)
