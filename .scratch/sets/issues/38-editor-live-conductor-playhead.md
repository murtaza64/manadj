# 38 — Editor: live Conductor playhead over the loaded transition

Status: done (human-approved + landed 2026-07-06, merge `oksyuznn`, lane conductor; incl. review fixes — whole-pair marker, take-pin matching)

## Parent

.scratch/sets/PRD.md (human feedback 2026-07-06, during sets 24 review)

## What to build

While a Conductor is playing and its sounding window executes the
transition loaded in the editor, render a live playhead marker across
the editor's lane timeline — so live-editing a set's sounding adjacency
(the sets 24 loop) shows WHERE in the window the set currently is.

- Match: `soundingWindowAt(getConductor().plan, mixTime)` (sets 24,
  `replan.ts`) against the editor's selected transition uuid —
  `SoundingWindow.pinUuid` (`PlannedAdjacency.pinUuid`, added by 24).
- Position: the marker lives on the AUTHORED window axis. Authored
  seconds = `sounding.transition.startSec + (mixTime − adj.mixStartSec) ·
  adj.rateOutgoing` (planner's `authoredLocalAt`); lane x =
  `(authored − startSec) / durationSec`, hidden outside [0, 1).
  Compute from the EXECUTED adjacency's geometry: during a deferred
  geometry edit (24's graft) the editor draws the NEW window while the
  Conductor executes the OLD — the executed mapping is the truthful one.
- The graft preserves `pinUuid` on the lanes-live path, so the marker
  survives mid-window edits; a re-pin mid-window grafts under
  `GRAFT_PIN_UUID` and the marker correctly disappears (the sounding
  window no longer executes the loaded transition).
- Refresh outside React (playheads move continuously): rAF or the
  pickup poll's 250 ms cadence; only the marker position enters state.
- Scope: one vertical marker over the lane stack; waveform-strip echoes
  can come later.

## Acceptance criteria

- [ ] Set playing into a pinned window + that transition loaded in the editor → marker tracks the conductor through the window, matching what is heard
- [ ] Different transition loaded (or conductor idle / outside the window) → no marker
- [ ] Dragging lanes while the marker is live: values change audibly (24) and the marker keeps tracking
- [ ] Mid-window geometry drag (deferred by 24): marker stays truthful to the EXECUTED window until it completes

## Blocked by

- 24-live-replan (parked ready-for-human — provides `pinUuid`, `soundingWindowAt`)

## Comments

**2026-07-06 — implemented (change `pytsnqou`, lane conductor, stacked on 34 `vkwnvxvv`). Parked ready-for-human.**

What was built:

- **Pure mapping seam** — `authoredPlayheadAt(execPlan, mixTime, transitionUuid)` in `sets/replan.ts`: matches `soundingWindowAt`'s window by `pinUuid` against the editor's active transition, maps mix time onto the AUTHORED axis via the EXECUTED adjacency's geometry (`transition.startSec + (mix − adj.mixStartSec) · adj.rateOutgoing` — the planner's authoredLocalAt), null-hides outside [0,1) of the window. Tested in `replan.test.ts` ("authoredPlayheadAt"): Riding + Fixed rates, solo/other-pin/hard-cut hiding, deferred-geometry truthfulness (graft keeps the marker on the OLD executed span), re-pin mid-window (GRAFT_PIN_UUID → marker disappears).
- **Overlay** — `editor/ConductorLanePlayhead.tsx`: one vertical marker (saturated orange, `.editor-conductor-playhead`, z between jumps and the pink mix playhead) mounted in `DawTimeline`'s `.editor-timeline-content` beside the mix playhead — spans lanes A + waves + lanes B. Self-owned rAF outside React, transform/display writes only (the mix playhead's idiom); reads `getConductor()` + the editor session's active uuid; content px = `authored × pxPerSec` (content is scroll-transformed as a whole, no scroll term). Zoom re-renders feed the loop through a ref — no rAF rebuilds.
- No planner/model/backend changes; waveform-strip echoes deferred per the issue's scope line.

Gate on the stack: `npx vitest run` 1133 ✓ (5 new authoredPlayheadAt tests), `npm run build` ✓, eslint clean on touched files, `uv run alembic heads` → one (`0022`).

**Verification walkthrough** (lane app running, same stack as 34's park):

- Open **http://localhost:5343** (or desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5343`).
1. Library → Sets → **post-forest** → play the set (Space or ▶) → open a PINNED adjacency's transition in the editor (click the adjacency/chip) — playback keeps running (21).
2. Let playback run into that window (or seek into it via the ladder): an **orange vertical marker** appears across the lane stack and tracks left→right through the window, matching what is heard; it disappears when the window completes (incoming's solo).
3. While the marker is live, drag an EQ/fader lane: the change is audible immediately (24) and the marker keeps tracking.
4. While the marker is live, drag the window's geometry (start/duration): the editor draws the new window, the set keeps executing the old one — the marker keeps moving over the OLD span (truthful to what is heard) until the window completes.
5. Load a DIFFERENT transition (another session item / another pair) while the set plays through the first: no marker. Conductor stopped/idle: no marker.

**2026-07-06 — review feedback, amended into `pytsnqou` (still parked).** The marker now tracks the WHOLE pair, not just the window (reviewer: "we should also show it outside of the transition window"): the outgoing's audible solo maps directly onto the authored axis (A time = authored time), the window maps as before (executed geometry), and the incoming's tail maps back through the window's B alignment (`startSec + (τ − bInSec)/rateIncoming`). Hidden whenever nothing of the pair is sounding at the pair's own entries (ping-pong deck reuse can't claim the marker). `authoredPlayheadAt` widened + 2 new tests (lead-up while the outgoing enters as the previous window's incoming; tail continuation). Gate re-run: vitest 1135 ✓, build ✓, eslint ✓. Also noted during this review pass: the Performance play-button hover-grow was a pre-existing CSS specificity bug — fixed and auto-landed separately (`vxrspwwl`); "playback stops entering edit mode via adjacency click" is issue 37's documented residue (datapoint added there).

**2026-07-06 — review pass 2.** (1) Takes: YES now — the marker matches a Take pin by the TAKE's uuid when the editor is in take review (the session draft item's own uuid is fresh, but a take pin plans the same deterministic vectorization the review displays, so the mapping is truthful by construction). Amended into `pytsnqou`; pure seam needed no change (it matches any windowed pinUuid — new test proves it), the component's matcher resolves takeDraft → takeUuid. (2) The "transitions visually misaligned depending on set play position" was a PRE-EXISTING editor bug the 38 loop exposed: DawTimeline's geometry read `player.engineA/B.getSnapshot().duration` — the SHARED decks (ADR 0022), which a conducting Set ping-pongs other tracks through, so the A/B block math re-warped at every handover. Fixed by gating the engine-duration reads on the engine holding the editor's own track (waveform-blob durations otherwise); auto-landed separately as `tykksult`. Gate re-run on the stack: vitest 1178 ✓, build ✓, eslint ✓.
