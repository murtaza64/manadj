# 27 — Default transition algorithm (replace bare hard cuts)

Status: ready-for-agent (grilled 2026-07-05; design settled below)

## Parent

.scratch/sets/PRD.md (filed 2026-07-05; grilled 2026-07-05). Sibling: .scratch/mix-editor/issues/31-stock-template-library.md (the class this default belongs to; only the default ships here).

## The ask

When an adjacency has no evidence at all (post-26), don't bare hard-cut — synthesize a smarter default transition. Rework the editor's pristine sketch to match: an evidence-less adjacency in Set playback sounds exactly like what you'd see (and start editing from) when opening that pair in the editor.

## Design (settled in the 2026-07-05 grill)

**Mechanism — the default is a template**, two layers:

- **Built-in registry**: a registry of code-value `TransitionTemplate`s (not DB rows — nothing to migrate or delete), plural from day one even though v1 ships one member. Stock-library expansion is mix-editor/31; context-aware selection among the registry (BPM/key/energy) is the named v2 seam.
- **User override**: new `is_default` boolean column on `transition_templates` (alembic migration; single-`true` app-enforced). Set via a radio-style "use as default" in the templates dropdown. Deleting the designated template reverts to the built-in — no dangling settings row.

**The built-in default — "Rolling handover"** (drop-relative; needs no new cue conventions):

- Alignment: `align(A cue4 + 128 beats → B cue1)` — B's buildup starts 32 bars after A's drop; since cue 1 sits ~32 bars before B's drop, B drops ~64 bars after A's — the classic buildup-over-outro handover.
- Window: 0 before / 128 after, **scalable**.
- Lanes (sparse): `faderB` 0→full over x 0→0.25; `faderA` full, ramp out x 0.75→1; **bass swap at x 0.25** (8 bars in, coincident with faderB reaching full): `eqLowA` flat→kill, `eqLowB` kill→flat, coincident chop-style walls. Mids/filters untouched (stripped).

**Anchor fallbacks**: the existing template chain, unchanged — set cue → relative ladder (1 = 2−64b = 3−96b = 4−128b) → absolute last resort (1≈0, 2≈64, 3≈96, 4≈128 from grid origin) → anchors unresolved. v1 keeps the absolute ladder flat; **v2 refinement (deferred)**: shift the whole absolute ladder by an intro offset (`+64` when gridded span ≥ 512 beats) — recorded here, not built.

**Ladder position — conditional tier**: favorite → most-recent → **synthesized default** → hard cut. The default tier applies only when a blend is sane:

1. |ΔBPM| ≤ 8% after tempo-match (Set/Performance playback is capped there; editor-only widened varispeed doesn't count)
2. Anchors resolve on both sides (all-or-nothing, per template semantics)

Otherwise fall through to hard cut (19's entry rule). Explicit Hard-cut pin (26) forces a cut regardless.

**Artifact status — synthesized only, never persisted**:

- Planner: recomputed at plan time against current grids/cues, every plan. Never materialized on play.
- Editor: `freshTransition(trackFacts)` = fresh session + apply the default recipe. Pristine stays value-based against a **seed-time baseline snapshot** (session-local), not the `defaultMix` constant — cue edits mid-session can't flip pristine, open-and-close persists nothing, first real edit autosaves as usual.
- Accepted drift: what an evidence-less adjacency sounds like evolves with cues/grids — same library-live softened invariant 26 recorded; pinning freezes.

**One source of truth**: a pure frontend module (registry + resolve/apply against pair facts) used by both the planner and the editor seed path; today's `defaultMix` window/lane constants (`mixModel.ts:99-131`) survive only as the degenerate fallback when the default can't apply (no grids).

**Badges**: synthesized default renders as a distinct chip — recipe's name (built-in or designated template's), the auto mark idiom from 26, dashed/outline treatment signaling "synthesized, not from your library". Red hard-cut chip keeps meaning "an actual cut will play" (gate failure or Hard-cut pin). UNPRACTICED and practice/edit affordances unchanged.

## Acceptance criteria

- [ ] Evidence-less adjacency, both tracks cued+gridded, compatible BPM: plan plays the rolling handover (B enters at cue 1 against A's cue 4 + 128, bass swaps 8 bars in); ladder shows the dashed default chip
- [ ] Same pair opened in the editor: pristine sketch is the identical transition (windows, lanes, anchors coincide with what the plan resolved)
- [ ] Open-and-close an evidence-less pair in the editor: nothing persisted; first edit autosaves as before
- [ ] Un-cued pair with grids: fallback chain resolves (relative ladder or absolutes), notice named, blend still plays
- [ ] |ΔBPM| > 8% or unresolvable anchors: hard cut with red chip, exactly as today
- [ ] Hard-cut pin still forces a cut; favorite/most-recent tiers unaffected
- [ ] "Use as default" on a saved template: planner + editor both switch to it; deleting it reverts to built-in
- [ ] `is_default` migration, single alembic head; single-true enforced
- [ ] Pure-module tests: recipe application (anchors, window, lanes), sanity gates (tempo, anchor failure), registry/override resolution, seed-time pristine baseline (cue edit mid-session doesn't flip pristine)
- [ ] Planner tests: ladder ordering with the new tier; badge state derivation

## Relations

- Builds on 26 (ladder), 19 (hard-cut entry stays the fallback), mix-editor 03/28 (template machinery is the mechanism), 24 (upgrades live)
- mix-editor/31: stock template library (the class: rolling handover, double drop, slam cut-in, long blend)

## Blocked by

- 26-unresolved-auto-resolves (defines the ladder this slots into)

## Comments

**2026-07-05 grill.** Mechanism fork resolved to template-as-default (hardcoded blend would duplicate template machinery; context-aware selection is v2 atop the registry). Drop-relative A-side anchoring (`cue4 + 128`) chosen over reifying a slot-8 mix-out convention — no new conventions needed; slot 8 stays free. Bass swap moved from window end to 8 bars in (user call). Intro-offset absolute-ladder refinement deferred from v1 (user call). Grill also surfaced the drop-relative recipe *class* → filed as mix-editor/31.
