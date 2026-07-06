# 27 — Default transition algorithm (replace bare hard cuts)

Status: needs-triage

## Parent

.scratch/sets/PRD.md (filed 2026-07-05 for a future grill — do not implement from this body)

## The ask (verbatim intent)

When an adjacency has no saved Transition (post-26: no evidence at all), don't bare hard-cut — synthesize a **slightly smarter default transition**. And rework the Transition editor's **default pristine sketch** so the two match: what you hear at an evidence-less adjacency during Set playback is exactly what you'd see (and start editing from) when opening that pair in the editor.

## Questions for the grill

- **Recipe**: what is the default? Candidates: a designated Transition template (the template system already encodes beat-domain recipes with anchors + lanes — "default" could be a reserved/user-chosen template applied at plan time via the existing cue-slot-ladder resolution), vs. a hardcoded minimal blend (N-beat tempo-matched crossfade with bass swap), vs. context-aware selection (BPM delta / key / energy pick among a few recipes).
- **Ladder position**: post-26 resolution is favorite → most-recent → hard cut. Does the synthesized default replace the hard-cut tier entirely (cuts only via explicit Hard-cut pin), or sit above it only when tempo-compatibility makes a blend sane (huge BPM delta ⇒ still cut)?
- **Artifact status**: purely synthesized at plan time (never persisted, recomputed against current beatgrids/cues — consistent with template-application semantics), or materialized as a real Transition on first play (pollutes the library; probably not)?
- **Editor unification**: the "pristine sketch" for an unsaved pair becomes the same recipe applied — one source of truth for the default (where does it live so planner and editor share it?). What happens to today's pristine defaults (window position, tempo-match flag, lane shapes)?
- **Badges/UI**: how does a synthesized default render in the ladder/rows (distinct from auto-resolved-saved and from hard cut)? Practice/edit affordances presumably unchanged (opening the editor shows the same thing — that's the point).
- **Anchor dependence**: template application resolves against the cue-slot convention (4=drop ladder) and falls back to Grid-origin heuristics — is that fallback good enough for arbitrary un-cued tracks, or does the default need its own entry heuristic (19's Hot Cue 1 → start)?

## Relations

- Builds directly on 26 (resolution ladder) and 19 (entry heuristics); the template system (Transition template, Cue-slot convention, Grid origin in CONTEXT.md) is the likely mechanism; 24 makes upgrades live.

## Blocked by

- 26-unresolved-auto-resolves (defines the ladder this slots into)
- The grill itself (needs the human)
