# 14 — Grace fade: overlapping windows and load latency

Status: done (landed on main, change pkwxstws)

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

## Comments

**2026-07-05 — Implemented (change pkwxstws, stacked on 06/oxwwnsvl).**

- **Grace fade = planner transform** (`applyGraceFades` in
  `sets/planner.ts`, 6 new tests): for each adjacency j, if entry j−1
  (the deck's occupant, ping-pong parity) is still audible within
  `headroom` (default 5s) of W(j).mixStart, its exit truncates to
  `mixStart − headroom` with a synthesized fade (default 2s, ending at
  the cut) on its role-fader — `PlannedEntry.graceFade` carries
  fadeStart/fadeStartValue/authored-exit so ladder, row durations, and
  `planStateAt` all agree. The fade REPLACES the authored tail (ramp from
  the authored fader value at fadeStart to 0); past the truncated exit
  the window's outgoing-role lanes read silent (the dropped tail), and
  the freed deck parks/loads the next entry. Hard-cut outgoings get the
  same treatment; the cut instant stays derived from the AUTHORED end
  (planned silence up to `headroom`, never a timing shift). Degenerate
  floor (truncation into the victim's own entry window): as-authored +
  `grace-floor` error flag. The transform subsumes the raw
  window-overlap warning (one chip per collision). Tunables live in
  `sets/setSettings.ts` (store-only, matching the 06 precedent — no edit
  UI yet).
- **ADR**: docs/adr/0025-grace-fade-rewrites-the-plan-tail.md (truncate
  vs fade-in-late vs shift-window vs runtime handling).
- **Load latency (Conductor)**: the unconditional clock-freeze is
  narrowed to "freeze only when NOTHING is audible" (cold-cache ▶,
  hard-cut instant with the incoming still loading); while any deck
  sounds the clock runs and the late deck joins at its plan position via
  the existing per-tick seek-to-plan. Frozen = silent: anything still
  sounding is parked.
- **Prefetch**: `prefetchAhead` warms the decode cache one entry past the
  current deck occupants (`hooks.prefetch` → `sets/prefetch.ts`: fetch +
  decodeAudioData on the Mixer's context + putCachedBuffer; new
  `Mixer.audioContext()` accessor). DeckEngine loads consult the cache,
  so the handover load is a near-instant hit inside the 5s grace. Known
  minor: a failed prefetch isn't retried for that entry (degrades to a
  slow load — the grace fade still covers it).
- **Surfacing**: ladder draws the synthesized fade (red wedge over the
  clip tail) and the dropped tail (hatched + dashed outline past the
  truncated exit); adjacency rows chip "overlap: previous track fades
  early" (yellow) / "overlap pileup" (red error); toolbar ⚠ count
  includes both.

**2026-07-05 — Review walkthrough (ready-for-human).** Lane app at
**http://localhost:5253** ("test set"). The stack under review is 06 →
14 (review 06's walkthrough first if not yet done). Script:

1. Create a collision: pin transitions on two consecutive adjacencies and
   drag the second window early (in the Transition editor, move its start
   near/before the first window's end), or use any pair where the second
   handover opens within ~5s of the first track's exit.
2. The ladder shows the first track's clip ending early: a red fade wedge
   over its last 2s, then a hatched dashed region where the authored tail
   would have played. The row's "plays m:ss" shrinks to match. The
   adjacency row shows "⚠ overlap: previous track fades early".
3. Play through it: the dying track audibly fades out ~5s before the
   colliding window; the incoming's opening plays as authored (window
   position/timing unchanged); no jump-cut on the shared deck.
4. Push the collision deeper (window opening inside the previous track's
   own entry window): the fade disappears, the plan plays as authored,
   and the row/ladder show a RED "overlap pileup" error instead.
5. Load latency: while one track is sounding, seek far ahead (cold
   buffers) — the music never stalls; the late deck pops in at its plan
   position once decoded. Pause, seek to a hard-cut instant, play: the
   clock holds (silence) until the incoming is ready — its opening is
   never skipped. During normal playback the next track's buffer
   prefetches (handover loads are instant on second pass).

**2026-07-05 — Approved and landed.** Human approval ("land these");
landed with 06 as the stack head. main → pkwxstws.
