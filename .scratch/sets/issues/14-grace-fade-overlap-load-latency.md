# 14 — Grace fade: overlapping windows and load latency

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## Problem

When adjacency i+1's window opens before adjacency i's has closed (or
before a hard-cut outgoing has finished), entry i+2 needs the deck entry i
still occupies: the Conductor jump-cuts the shared deck, aggravated by
load latency. Found during the 04 review click-through (2026-07-05). The
planner already detects this (`warnings`) but nothing consumes it, and
the runtime behavior ("latest window wins" + clock freeze while loading)
is the buggy-sounding part.

## What to build (grilled 2026-07-05)

**Grace fade — a planner transform, not runtime improvisation.** The plan
itself is rewritten, so the ladder, per-row durations, and Conductor all
agree:

- When entry i+2's window needs a deck whose occupant (entry i) is still
  audible, truncate entry i early: exit = `W(i+1).mixStart − grace`, with
  a synthesized fade-out ramp on its role-fader replacing the authored
  tail (authored lane material past the truncation is unreachable and
  dropped). Applies equally when entry i was playing out to a hard cut.
- Never shift authored windows: pins play "the exact move I intend" (PRD
  story 7); the forgery is confined to the dying track's tail. (Considered
  and rejected: fading the incoming in late — mutilates the authored
  move's identity; shifting W(i+1) later — changes authored timing. If
  this decision needs promoting to an ADR at implementation time, the
  bar is met: surprising — the planner rewrites an authored plan tail.)
- Constants: `grace` = load headroom, default 5s; fade length ~2s ending
  at the truncation instant. Both tunable settings (PRD: tunable
  heuristics are settings, not model).
- Degenerate floor: if truncation would cut into entry i's own entry
  window, don't attempt heroics — plan as-authored and emit a validation
  flag (same family as 06's runway flag).

**Load latency (Conductor)** — rule: *never stall while music plays;
never skip while silent*:

- Replace the unconditional clock-freeze-while-loading: freeze only when
  NOTHING is audible (cold-cache ▶, hard-cut instant with the incoming
  still loading — running the clock there would skip the incoming's
  opening). While any deck is sounding, let the clock run and have the
  late deck join at its plan position when ready (the sync loop's
  existing seek-to-`planStateAt` does this once the freeze branch is
  narrowed).
- Prefetch one entry ahead into the decoded-buffer cache (fetch +
  decodeAudioData + putCachedBuffer for entry i+2 while i+1 plays) —
  decks hold one buffer, but the cache doesn't care; deck loads become
  near-instant cache hits and the 5s grace is almost always enough.

**Surfacing (ladder + rows)** — the planner's warnings finally get a
consumer:

- Truncated tails render distinctly in the ladder (hatched/dimmed clipped
  region with the synthesized fade drawn).
- A warning chip on the affected adjacency row ("overlap: previous track
  fades early"); validation-flag floor cases render as errors, not
  warnings.

## Acceptance criteria

- [ ] Overlapping windows plan a grace fade: outgoing truncated `grace` before the next window, synthesized fade, ladder/durations/Conductor agree
- [ ] Hard-cut outgoings get the same grace when the next window collides
- [ ] Degenerate pileups plan as-authored with a validation flag, never a mangled plan
- [ ] While any deck sounds, a late load never stalls the clock — the deck joins at its plan position; while silent, the clock holds (no skipped openings)
- [ ] Next-entry buffers prefetch into the cache; a warm handover load is near-instant
- [ ] Truncations and floor cases are visible in the ladder and adjacency rows

## Blocked by

- 04-conductor-v1
