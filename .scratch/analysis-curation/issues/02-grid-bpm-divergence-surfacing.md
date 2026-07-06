# 02 — Surface grid↔BPM divergence for hand verification

Status: needs-triage

## Problem (found 2026-07-05 while debugging a Set misalignment)

ADR 0016 makes the Beatgrid the tempo authority and `tracks.bpm` its projection — but the invariant is broken in the wild: **12 unarchived tracks** have `|bpm − grid dominant BPM| > 0.5`, and the wrongness cuts both ways:

- Raskal (512): field 87.0, grid 174.0 — stale half-time FIELD (grid right)
- Say Nothing (141): field 172.0, grid 114.9 — wrong GRID (field right)
- RATATA (102): field 174.0, grid 124.0; Satisfaction (238): 87.0 vs 130.4; plus off-by-small cases (Apollo 119 vs 119.96, Only in My Mind 142 vs 142.75)

Consequences ripple everywhere tempo is consumed: the Set planner mismatch is being fixed to read grid-first (bugfix in flight), but any grid that is itself wrong still poisons alignment, tempo-match, Fixed set tempo, and template application. No auto-repair is safe — each of the 12 needs eyes.

## The ask (shape for triage)

Surface the divergence for hand verification and make resolution one gesture each way:

- A queryable mark/filter ("BPM ≠ grid") — candidate homes: a library FilterBar chip, a Sync-inbox-style section, or the analysis-curation review surface (this tracker's territory; triage decides)
- Per track, two resolutions: **re-project** (bpm := grid dominant — for stale fields) or **flag grid for re-analysis / hand grid edit** (for wrong grids; native grid Analysis bails rather than guess, per Quantized track)
- Consider a projection-maintenance guard so the invariant can't silently rot again (whatever writer produced half/double-time fields without touching grids — find it during triage; Analysis vs import vs old data)

## Repro query

`SELECT … FROM tracks t JOIN beatgrids b ON b.track_id=t.id WHERE abs(t.bpm/100.0 - json_extract(b.tempo_changes_json,'$[0].bpm')) > 0.5 AND t.archived_at IS NULL` → 12 rows (2026-07-05).

## Blocked by

- Triage/grill (needs the human: where it surfaces, what the guard is)

## Comments

**2026-07-05 — scope shrinks under ADR 0027 (bpm-grid-authority grill):**
the audit found the writers that rotted the invariant
(`refresh_from_files` and `sync_to_db` bypass `write_bpm` —
`track_metadata/manager.py:116,217`); bpm-grid-authority 02 guards them
and 01 backfills the column from grids, so **column↔grid divergence
becomes unrepresentable** — the "projection-maintenance guard" ask is
covered, and the re-project resolution happens wholesale via the
backfill. What REMAINS for this issue: the *wrong-grid* half (Say
Nothing-class rows, where the grid itself lies and the file/field was
right) — the backfill would overwrite a correct field with a wrong
grid's tempo for those. Recommend: run this issue's repro query and
hand-verify the ~12 rows BEFORE the 01 backfill lands; keep this issue
scoped to "flag grid for re-analysis / hand grid edit" surfacing.
