# 03 — Transition templates: beat-domain recipes

Status: ready-for-agent
Blocked by: 01 (verification of the render layer), and the DB-persistence
graduation slice (not yet filed — templates are library-level artifacts and
should be born in the DB schema, not migrated out of localStorage twice).

## Parent

`.scratch/mix-editor/PRD.md` (Transition templates section — the full design;
ADR 0010 Amendment 2).

## What to build

Named, saved Transition templates and one-gesture application to a track
pair. Design is settled in the PRD; summary:

- Template: `alignA`/`alignB` anchor rules (cue slot + beat delta, each on
  its own track's grid), `lengthBeats`, `scalable`, normalized lanes,
  tempo-match implied.
- Apply: resolved align points coincide at the transition start; beats →
  seconds via the tempo-matched grids; scalable templates prompt for a beat
  count (default `lengthBeats`).
- Fallback chain when resolution fails: cue slot → hard-coded convention
  heuristic (cue-slot convention: 1 = first buildup, 4 = drop; e.g. missing
  drop ≈ beat 128 from first downbeat) → leave anchor as-is + one-line
  notice. Clamp + notice when out of range. Lanes/length/tempo-match always
  stamp (partial application, no modals).
- Authoring: "Save as template" from the current Transition only (no
  separate abstract editor): normalize lanes, derive `lengthBeats`, one
  explicit cue-slot pick per side with the delta auto-derived and rounded to
  whole beats. Dropdown management (rename/delete).

## Acceptance criteria

- [ ] Save a working buildup-into-drop Transition as a template; apply it to
      a different pair with cues 1/4 set → playable Transition lands with
      correct beat alignment, no manual anchor work
- [ ] Drop-alignment + lead-in expressible purely via the two deltas
      (worked example from the PRD reproduces)
- [ ] Apply to a pair missing a cue slot → heuristic fallback + visible
      notice; missing beatgrid → lanes still stamp, anchors untouched, notice
- [ ] Scalable template applied at 32 and 64 beats stretches lanes correctly;
      fixed template applies at its own length
- [ ] Templates persisted in the DB (alembic migration per repo convention)
- [ ] Pure-module tests (vitest): anchor resolution incl. fallbacks and
      clamping, beats→seconds translation, lane normalization round-trip
- [ ] Glossary/PRD stay true (cue-slot convention recorded)
