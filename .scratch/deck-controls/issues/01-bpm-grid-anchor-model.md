# 01 — BPM⇄Beatgrid anchor model (backend)

Status: closed (implemented change lvulxzsq, gridmodel lane; user-verified 2026-07-04 — anchor pins the marked downbeat through BPM edits; nudge visibility scales with distance from anchor, explained and accepted)

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

## Comments

**2026-07-04 (lane gridmodel, jj change lvulxzsq) — done + writer audit.**

Built: migration `0016_lvulxzsq` (`beatgrids.anchor_time`, nullable float;
renumbered from 0015 and re-parented onto `0015_xupryqxp` after the
archival lane landed first);
set-downbeat records the mark as anchor (last mark wins) and re-anchors
variable grids by rigid shift (`re_anchor_tempo_changes` — the old
flatten-to-constant in `set_downbeat_at_time` usage is gone); nudge shifts
every tempo change and the anchor by the applied (post-clamp) offset; new
`backend/beatgrid_ops.write_bpm` is the one BPM write path (no grid → plain
write; generated → regen; edited/imported → re-tempo around
`anchor_time`/first-downbeat fallback, fallback persisted so repeat
re-tempos don't drift; variable → `VariableGridBPMError` → 409 at the
tracks PATCH). `anchor_time` exposed on `BeatgridResponse`. Router-seam
tests in `tests/test_beatgrids_router.py` (10 cases incl. the 46.7s
174→175 exactness check).

Audit of `tracks.bpm` writers:

- `track_metadata/manager.py apply_update` (tag editor, deck panels,
  analysis accept — all PATCH /tracks): **routed** through
  `beatgrid_ops.write_bpm`.
- `sync_performance/apply.py import_beatgrid`: grid writer that previously
  left the cache stale — **now writes through** the imported grid's
  dominant tempo (`beatgrid_utils.dominant_bpm`) and clears `anchor_time`
  (mark referred to the replaced grid).
- `crud.py create_track`, `library/import_manager.py import_tracks`,
  `tracks/executor.py import_tracks_from_rekordbox`: **justified** — all
  create brand-new Track rows; no grid can exist yet, so BPM is a plain
  seed (ADR 0016's gridless case).
- `track_metadata/manager.py refresh_from_files` and `sync_to_db`:
  **justified** — explicit "file wins" restore/sync tools operating on
  integer file-tag BPM. Routing them through re-tempo would let rounded
  tags silently respace saved grids. Left as direct cache/seed writes; on
  gridded tracks the grid stays the read authority. Known divergence
  surface — revisit if the sync view grows grid awareness (ADR 0016
  consequences note).
- Everything else matching `bpm=` (sync_status aggregator/adapters/compare,
  sync_manager discrepancies, analysis.py, analyze router) is read-only or
  writes `BPMAnalysis`, not `tracks.bpm`.

Frontend follow-up for slices 02–03: three client copies of the
PATCH→delete-grid→regenerate ritual survive (`editor/DeckCard.tsx:92`,
`components/performance/DeckPanel.tsx:59`, `components/TagEditor.tsx:199,234`).
The server now re-tempos on PATCH, so the client's follow-up DELETE
destroys the re-tempoed grid (same net loss as before this change, but now
strictly the client's fault) — remove the ritual client-side.
