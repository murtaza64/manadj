# 08 — Cleanup: delete-projection, GET error semantics, dominantBpm unification, downbeat epsilon

Status: ready-for-agent
Type: task

ADR 0027 §8 bundle (grill Q8). Four independent small items; land
together.

## Change

1. **Grid DELETE projects first** (`routers/beatgrids.py:182-189`):
   before deleting, write the grid's dominant tempo into the column so
   the served bpm is continuous across deletion.
2. **Beatgrid GET error semantics** (`routers/beatgrids.py:28-58`):
   track missing → 404 (today 400); grid-exists-but-waveform-missing →
   clean 4xx (today an uncaught `ValueError` → 500 from
   `_format_beatgrid_response`).
3. **`dominantBpm` unification**: TransitionEditor
   (`TransitionEditor.tsx:163-164`, `tempo_changes[0]`) and
   `templateModel.beatPeriodSec` (`templateModel.ts:73-75`) use the
   shared `dominantBpm` helper (`bpmCommit.ts:31-53`). Raw-column
   readers need no edits — issue 01 makes served bpm grid-first.
4. **Downbeat epsilon matching** (`WaveformRendererV2.ts:487-491`):
   replace exact `Set.has` float matching of downbeat times against beat
   times with epsilon matching (or index-based downbeats). Today
   correct-by-construction (backend appends the same accumulated float
   to both arrays); the failure mode if either side ever derives
   independently is ALL beat lines vanishing at zoomed-out levels.
   Cheap insurance; coordinate with issue 04, which must keep the two
   backend arrays consistent regardless.

## Testing decisions

- 1: delete a grid whose tempo diverges from the column → subsequent
  track GET serves the (former) grid tempo.
- 2: router tests for 404 and the waveform-missing 4xx.
- 3: editor tempo-match on a variable fixture uses dominant, not first
  segment (pure-fn assertions).
- 4: renderer unit: downbeat times offset by 1e-9 still match.
