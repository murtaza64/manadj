# 03 — Transition templates: beat-domain recipes

Status: ready-for-agent
Blocked by: nothing (01 and 26 both done).

## Parent

`.scratch/mix-editor/PRD.md` (Transition templates section — the full design,
sharpened in the 2026-07-04 grill; ADR 0010 Amendment 2).

## What to build

Named, saved Transition templates and one-gesture application to a track
pair. Design is settled in the PRD; summary:

- Template: `alignA`/`alignB` anchor rules — base (cue slot 1–8 **or grid
  origin**) + whole-beat delta, each on its own track's grid — `lengthBeats`,
  `scalable`, sparse normalized lanes (hidden/untouched lanes stripped at
  save), tempo-match implied.
- Grid origin: true first downbeat via backward whole-beat extension of the
  first tempo segment (ε = min(50ms, beatPeriod/4), `bar_position` phase
  carried back). Pure frontend helper, used by both save and apply.
- Apply: resolved align points coincide at the transition start; beats →
  seconds via the tempo-matched grids; scalable templates get an inline
  beat-count stepper (default `lengthBeats`, beat-jump idiom, no modal).
  Target: pristine active Transition, else a new Transition in the pair's
  set; it takes the template's name.
- Fallback chain for cue-slot anchors: set cue → relative ladder resolution
  from the nearest set ladder slot (convention: 4 = drop, 3 = −8 bars,
  2 = −16, 1 = −32, "typically") → absolute last resort from grid origin
  (4 ≈ beat 128, 3 ≈ 96, 2 ≈ 64, 1 ≈ 0) → anchors untouched + notice.
  Anchoring is all-or-nothing across the pair; lanes/length/tempo-match
  always stamp (missing A grid: duration untouched too). Clamp + notice
  when out of range; every substitution gets a one-line notice naming
  the path.
- Tempo-match beyond ±8%: widen the editor player's varispeed range
  (editor-only) so beats genuinely align; notice fires above 8%.
- Authoring: "Save as template" from the current Transition only (no
  separate abstract editor). Preconditions: beatgrids on both sides
  (disabled + tooltip otherwise); cues optional. Modal asks one question
  per side: anchor base (set cue slots + "first downbeat", default =
  nearest set cue by |delta|), delta auto-derived and rounded to whole
  beats (shown); `lengthBeats` derived on A's grid, rounded, shown.
- Persistence: `transition_templates` table (client-generated uuid, name,
  per-side base+delta, `length_beats`, `scalable`, `lanes_json`,
  timestamps) via alembic migration; **CRUD API** (explicit saves — no
  autosave loop, no reconciliation; deliberately unlike Transitions'
  pair-replace).
- Management: Templates dropdown next to the TransitionSwitcher — per-row
  apply + scalable stepper, inline rename, two-step delete, "Save current
  as template…". Duplicate names allowed (uuid is identity).

## Acceptance criteria

- [ ] Save a working buildup-into-drop Transition as a template; apply it to
      a different pair with cues set → playable Transition lands with
      correct beat alignment, no manual anchor work
- [ ] Drop-alignment + lead-in expressible purely via the two deltas
      (worked example from the PRD reproduces)
- [ ] Apply into a pristine active Transition stamps it in place; apply
      into an edited one creates a new Transition; both carry the
      template's name
- [ ] Apply to a pair missing a ladder cue but with another ladder cue set →
      relative resolution (e.g. cue 3 from cue 4 − 8 bars) + notice;
      no ladder cues at all → absolute grid-origin heuristic + notice;
      missing beatgrid → lanes still stamp, anchors (and duration, if A's
      grid) untouched, notice
- [ ] Grid-origin anchor resolves correctly on a track whose first grid
      mark sits one beat after the true first downbeat (backward
      extrapolation; no off-by-one-bar)
- [ ] Scalable template applied at 32 and 64 beats stretches lanes correctly
      via the inline stepper; fixed template applies at its own length
- [ ] Pair with |ΔBPM| > 8%: beats still align in the editor player
      (widened varispeed), notice shown; Performance view unaffected
- [ ] Hidden and untouched lanes are absent from a saved template
- [ ] Templates persisted in the DB (`transition_templates`, alembic
      migration per repo convention) behind a CRUD API
- [ ] Pure-module tests (vitest): grid-origin extrapolation, anchor
      resolution incl. relative-ladder and absolute fallbacks and clamping,
      beats→seconds translation, lane normalization + stripping round-trip,
      apply-target (pristine vs new) logic
- [ ] Glossary/PRD stay true (cue-slot ladder + Grid origin recorded)
