# BPM–grid authority: one served BPM, grid-first

Status: accepted (grill 2026-07-05, post cue-quantize-bpm audit)

Sharpens ADR 0016 after an audit found its invariant unenforced: two
backend writers bypassed the grid op, the API served two BPM fields and
consumers chose between them (half wrongly), and persisted placeholder
grids could freeze stale tempos. Decisions:

## 1. Grid tempo propagates outward; metadata never overwrites it

The grid's tempo is the truth; file/metadata BPM is often wrong
(integer-rounded, half/double-time). File→DB paths (`refresh_from_files`,
`sync_to_db`) never write BPM for a track with a real (non-generated)
grid. The sync compare diffs file BPM against the grid-first projection,
so in-sync gridded tracks stop showing phantom divergence. For
placeholder-only tracks, file BPM routes through `write_bpm` (regenerates
the placeholder — plain metadata seeding, per 0016). No deliberate
"take the file's tempo" override for gridded tracks: re-tempo via the
BPM control is that gesture.

## 2. One served BPM

`schemas.Track.bpm` IS the grid-first projection (what `bpm_effective`
computed); the separate `bpm_effective` field is deleted. The centibpm
column becomes purely internal — a write-through cache existing only so
SQL sort/filter and exports work without parsing grid JSON — kept honest
by the compliant writers plus a one-time backfill script (data, not
alembic). Exports (Rekordbox XML, ID3 write-back, sync cells) read the
same projection. Consumers stop choosing.

## 3. Placeholders are computed projections, not rows

Authority chain: grid with `origin != "generated"` → dominant tempo;
else the column. A placeholder is a grid-shaped *view* of the column —
same number by definition, never a second authority. Reads never persist
placeholders (`GET /api/beatgrids/{id}` computes them on the fly); grid
rows come into existence only via deliberate gestures (grid edit,
import, re-tempo), which promote to `edited` as before. The stale-frozen-
placeholder failure mode becomes unrepresentable.

## 4. Variable grids: exact beats, dominant-BPM doctrine

`calculate_beats_from_tempo_changes` walks all segments (fixing the
first-segment-only expansion that made client-side Quantize snap to
phantom beats). Beat-domain features (quantize, loops, jumps, readouts)
are exact on variable grids — their interval math already handles
non-uniform spacing. **Tempo-domain features (MATCH, tempo-fit, play
guides, planner pitch math) treat a variable track as its dominant
tempo, by doctrine** — marked `~N (var)` where displayed; no
section-aware matching until a real need exists. Variable grids remain
import-only (the 409 scalar-edit guard stands; no UI authors them).

## 5. Beat jumps are beat-domain

`DeckEngine.jumpBeats` displaces via `addBeats` over live `beat_times`
(phase-preserving by construction — fractional beat coordinates), scalar
`60/bpm` only as the gridless fallback. Identical on constant grids;
exact on variable; jump math stops depending on the bpm scalar's
freshness. The engine's bpm scalar remains for snapshot consumers (play
guides) and the fallback.

## 6. Loops: seconds are the identity

A re-tempo never audibly moves an active loop. Halve/double operate on
the audible seconds length; `lengthBeats` becomes a display projection
recomputed from the live grid (`~N` when non-integral). The
resize-after-re-tempo re-derivation discontinuity is removed.

## 7. Deck context: identity in context, facts in cache

`loadedTrack` is the identity of what's loaded (plus display
convenience); tempo facts read through the `['track', id]` query
(Follow's `bpmCenter`, the MATCH enable gate — matching what
`useMatchAction` already did). No structural id-only refactor unless it
bites again.

## Considered and rejected

- File BPM re-tempos the grid (route imports through `write_bpm` on
  gridded tracks) — rejected: ID3 BPM is the least trustworthy tempo
  source in the system; it would silently rewrite user-edited grids.
- Keep both `bpm` and `bpm_effective`, teach consumers to prefer the
  latter — rejected: documents the foot-gun instead of deleting it.
- Beats as the loop's identity (re-derive regions on grid change) —
  rejected: violates "what I hear is stable" mid-performance.
- Refusing variable-grid imports — rejected: an Engine tempo map is
  better information than a constant approximation; keep the data,
  scope the features.

## Implementation

`.scratch/bpm-grid-authority/` (issues 01–08). Related prior work:
cue-quantize-bpm 01/02 (live grid/tempo sync into the deck engine);
analysis-curation 02 (divergence surfacing — scope shrinks under §1/§2).
