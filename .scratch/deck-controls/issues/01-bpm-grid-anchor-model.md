# 01 — BPM⇄Beatgrid anchor model (backend)

Status: ready-for-agent (ADR 0016 is the spec)

## Parent

`.scratch/deck-controls/PRD.md`; ADR 0016; glossary Beatgrid entry.

## What to build

- Migration: `beatgrids.anchor_time` (nullable float, track-time seconds).
- `set-downbeat` records the marked time as anchor (last mark wins) and
  rebuilds the grid through it (display extrapolation both ways, as
  today); on a variable grid it re-anchors by shifting the tempo-change
  map — never flattens (replaces today's silent single-tempo collapse).
- Grid nudge shifts `anchor_time` along with the grid.
- New server-side BPM write operation (one endpoint — the tracks PATCH
  routes tempo through it when a grid exists):
  - no grid → plain metadata write (placeholder generation unchanged);
  - `generated` grid → regenerate from the new BPM;
  - `edited`/`imported` → anchor-preserving re-tempo (anchor fallback:
    first downbeat); origin becomes `edited`;
  - variable grid → 409 with a clear reason (UI never offers it).
- Audit every `tracks.bpm` writer (tag editor mutation, deck panels,
  analysis accept, sync/bulk import) and route or justify each.
- Read path: expose the projected BPM (grid-dominant tempo) so clients
  can render one truthful value; `tracks.bpm` may remain a cache kept in
  sync by the write op.

## Acceptance criteria

- [ ] Marked downbeat survives a subsequent BPM change exactly (test:
      mark at t=46.7, re-tempo 174→175, downbeat still 46.7)
- [ ] Placeholder grids regenerate; edited grids re-tempo; variable grids
      refuse with 409 (router-seam tests per case)
- [ ] Set-downbeat on a variable grid preserves its tempo changes
- [ ] Grid nudge moves the anchor with the grid
- [ ] Writer audit recorded in a comment here
- [ ] Alembic migration per convention; pytest green; single head

## Blocked by

None. Slices 02–03 consume this.
