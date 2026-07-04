# 14 — Marker readability: hotcue triangles, downbeat thinning, playhead, minimap markers

Status: closed (implemented change `yuzzqomk`; user-verified 2026-07-04)

## Parent

`.scratch/mix-editor/PRD.md` (Marker readability). Prototype iteration.

## What to build

Five small visual changes reducing vertical-line noise on the editor
timeline and minimap:

1. **Hot cue triangles** (renderer): fixed-screen-size triangles in each
   hot cue's color at the row's baseline (outer) edge, pointing toward the
   seam — same convention as the existing cue-point triangle. Existing
   vertical lines and numbered badges unchanged. Respects the stacked-half
   anchor (issue 13): row A top edge, row B bottom edge; `center`-anchored
   surfaces keep today's rendering.
2. **Downbeat thinning** (renderer): once weak beats are density-culled
   (existing `showWeakBeats` threshold), draw downbeats at 1px and lighter
   alpha (~half of current 0.3). Full width/alpha returns as you zoom in.
3. **Playhead width** (CSS): `.mixproto-playhead` is 3 CSS px; the renderer
   playhead is 3 buffer px = 1.5 CSS px at DPR 2. Thin the DOM playhead to
   match the apparent width of other views (~1.5px).
4. **Minimap hot cues** (GlobalMinimap): triangle markers per track in the
   cue's color — A's along the top edge, B's along the bottom edge.
5. **Minimap transition window** (GlobalMinimap): translucent tint over the
   window region instead of the current bordered box.

## Acceptance criteria

- [ ] At fit zoom on a full track, each hot cue is locatable by its triangle
      at a glance; triangles don't scale with zoom
- [ ] At distant zoom only thin, light downbeats remain; zooming in restores
      current appearance smoothly (no popping between more than the existing
      culling states)
- [ ] Editor playhead visually matches the Player's playhead width on a
      retina display
- [ ] Minimap shows both tracks' hot cues; transition region reads as a tint,
      no border lines
- [ ] Non-editor surfaces unchanged (cue triangles only under top/bottom
      anchor; beatgrid change is zoom-gated, main Player is unaffected at its
      zoom range — verify by eye)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately. Coordinate with issue 13 (same row-rendering
code and anchor config); if 13 isn't done yet, implement triangles against
the current centered rows at the top edge and let 13 re-anchor them.
