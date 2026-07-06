# 31 — Stock template library: drop-relative recipes

Status: ready-for-agent (blocked by sets/27)

## Parent

`.scratch/mix-editor/PRD.md` (Transition templates). Filed 2026-07-05 from the sets/27 grill, which surfaced a *class* of drop-relative recipes — (B entry rung, A exit offset, window, lane moves) tuples — all expressible in the post-28 template model with no vocabulary gaps.

## What to build

Populate the built-in template registry (mechanism lands in sets/27) with the stock members beyond the default:

1. **Rolling handover** — `align(A cue4+128 → B cue1)`, window 0/128, scalable; faderB in over 8 bars, bass swap at 8 bars, faderA out over the last 8. *Ships in sets/27 as the built-in default — listed here as the class's first member, not this issue's work.*
2. **Double drop** — `align(A cue4+0 → B cue4)`, window 32/32; the PRD's canonical worked example as a stock recipe.
3. **Slam cut-in** — `align(A cue4+128 → B cue4)`, window ~8/0, fixed; B drops cold at A's mix-out point, one-bar fader wall.
4. **Long blend** — `align(A cue4+64 → B cue1)`, window 0/256, scalable; filter-assisted slow melt.

Registry members appear in the templates dropdown (distinguished from user rows — not renamable/deletable; "use as default" eligible). Exact lane shapes for 2–4 to be tuned by ear during implementation; the tuples above are the spec.

## Acceptance criteria

- [ ] All registry members applicable from the templates dropdown like saved templates (apply, scalable stepper where scalable)
- [ ] Built-ins not renamable/deletable; any can be designated default
- [ ] Each recipe's applied result eye/ear-verified on a real cued pair
- [ ] Pure-module tests: each recipe's tuple applies to expected window/anchor geometry

## Not in scope

- Context-aware selection among registry members (BPM/key/energy) — named v2 in sets/27
- Chop flourishes in recipes — expressible once issue 30 lands (templates capture chop breakpoints for free); revisit shapes then

## Blocked by

- sets/27 (registry mechanism + dropdown integration)
