# 24 — Live re-plan: plan-input edits reflect into ongoing Set playback

Status: ready-for-human (implemented 2026-07-06, change `uuzluzpl`, lane setlist — parked for review)

## Parent

.scratch/sets/PRD.md (feedback + design 2026-07-05)

## What to build

The Conductor currently snapshots the plan at start (04's documented edge: "re-pin → next start"). Replace the snapshot with a **live re-plan**: while the Conductor plays, any plan-input change — a Transition edit (the editor autosaves sketches), a re-pin or auto-fill, a Dormant-pin restore, a tempo-policy/Set-tempo change, a reorder — recomputes the plan and the Conductor continues seamlessly in the new one.

**Position remapping is Pickup's anchor mapping, reused**: anchor on the audibly dominant Deck at its current track-time, map to the new plan's mix time, leave the anchor untouched, reconcile only silent decks, converge mixer/pitch by the existing ramps. A live re-plan is "an automatic Pickup into the new plan" — no button, same invariants (never audibly destructive).

**The active window rule (decided)**: geometry changes (start, duration, B-entry alignment) to the adjacency **currently sounding mid-window** are **deferred** — the active window completes as it was; the new geometry applies downstream and on any later replay. Its **lane values apply live** (automation values are safe to swap under the playhead — that's riding the mix, the editor's own idiom). Everything upstream of the playhead is bookkeeping; everything downstream applies immediately.

Combined with issue 21 (mounted editor no longer silences playback), this completes the loop: set playing → open the adjacency in the editor → drag lanes → hear the ongoing set change.

## Acceptance criteria

- [ ] Editing a downstream Transition during playback: the handover plays the edited version, no interruption
- [ ] Editing the sounding window's lanes: values change audibly, live; editing its geometry: no effect until the window completes (then downstream plan uses it)
- [ ] Re-pin / auto-fill / Dormant restore during playback take effect without stopping (subsumes 04's "re-pin → next start" edge — update its documented-edges note)
- [ ] Reorder during playback: playback continues anchored on the dominant deck; if the anchor's track left the Set, fall back to the Pickup unlit rules (playback continues on the old plan's tail? no — define: Conductor keeps playing the current audio and stops conducting at the next boundary, surfacing the unresolvable state like an unlit Pickup)
- [ ] Tempo policy / Set tempo changes converge by ramp, not snap
- [ ] Anchor deck audio never glitches across any re-plan
- [ ] Remap logic is pure and tested at the planner seam (reuses 16's pickup mapping functions)

## Notes

- Blocked by 16 (landed) — reuses its mapping; strongly synergistic with 21 (in flight). Dispatch after 21 lands to the Conductor-owning lane (setlist).
- The one open sub-case (anchor's track removed by a mid-playback reorder) is written as a fallback above; if implementation reveals a cleaner behavior, propose it in the park comment rather than inventing silently.

## Blocked by

- 16-conductor-pickup (landed)
- Soft: 21-conductor-survives-mode-switch in flight on the Conductor-owning lane

## Comments

**2026-07-06 — implemented (change `uuzluzpl`, lane setlist). Parked ready-for-human.**

What was built (all ACs covered, tests at each seam):

- **Pure remap seam** — `frontend/src/sets/replan.ts`: `evaluateReplan(oldExecPlan, mixTime, newPlan)` anchors on the audibly dominant playing deck (plan-lane audibility, pickup's Master-bus kill model), maps its plan track-time through 16's `mixTimeForTrackTime`, computes `flip` for parity moves. Never the user-facing `evaluatePickup` — its holder gate (25) would refuse the Conductor's own holder. Tested round-trip in `replan.test.ts` (pickup.test.ts style).
- **Sounding-window graft** — `soundingWindowAt` + `graftSoundingWindow`: geometry (start, duration, bInSec, jumps, tempo-match) of the adjacency sounding mid-window is deferred by re-running `planSet` on an input whose active adjacency keeps the executed geometry — cascaded consequences (grace fades, tempo returns, downstream offsets) stay correct by construction. Lane values ride live (same pin uuid → new lanes on old geometry). A re-pin mid-window freezes the window whole. `planner.ts` grew `pinUuid` on windowed adjacencies for the identity match. Deferral expires via a 250 ms mix-clock poll in `conductorStore` (`startGraftPoll`) — the deferred geometry lands when the window completes or the playhead leaves it, so later replays play the new geometry.
- **Runtime** — `Conductor.replacePlan(newPlan, mixTime, {rampSec})`: swaps the plan under the same run (borrow/claim/overlay never rebuilt), re-anchors the clock at the remapped instant. Lanes swap immediately while the same window keeps sounding (riding the mix); any other audible lane discontinuity converges from the sounding values over the pickup ramp. Playing decks whose planned pitch changed ease by ramp (never re-seeked mid-ramp); silent decks reconcile hard. 04's snapshot edge is retired (note updated in 04).
- **Subscription seam** — `ConductorPlanFeed` (App-level, headless, above the view switch): while a Set conducts, `useSetPlanParts` assembles the same PlanInput the view plans with (pair-store autosaves, pins/dormancy/order, tempo policy, hot cues, tunables) and pushes each recompute through `replanSetPlayback`. Issue 26 widens `useSetPlanParts` and arrives here for free. Coalescing = the editor's existing 300 ms autosave debounce.
- `startSetPlayback`/`seekSetPlayback` same-set checks dropped the plan-identity comparison (the running plan is current by construction now) — also fixes the pre-existing wart where any mid-playback edit made the row ▶ bounce the whole session.

**Fallback deviation (proposed per the issue's invitation, not silently invented):** for the anchor-track-removed-by-reorder case the issue sketched "keeps playing the current audio and stops conducting at the next boundary". Implemented instead: **immediate takeover-style stand-down** — `Conductor.standDown()` reuses the takeover path (decks keep playing, sounding mix written into base state, inaudible disengage, capture re-seeds), and the Pickup button immediately surfaces the unresolvable state with its existing teaching reason ("Deck X's track is not in the set"). Rationale: (a) the old plan's tail is a plan the user just invalidated — conducting a zombie plan to its next boundary means executing a handover into a track that may no longer follow; (b) "surfacing like an unlit Pickup" falls out for free — the moment conducting stops, the poll-driven Pickup predicate takes over teaching; (c) it reuses the tested takeover machinery instead of a new zombie mode. Tradeoff owned: if the reorder lands mid-blend, lane automation freezes at the sounding values (a half-crossfaded state the user takes over) rather than completing the blend. Also covered by the same fallback: the anchor's current moment vanishing from the plan entirely (a window dragged wholly across the playhead) — mapping it anywhere would jump the sounding deck, so the run stands down rather than glitch (AC 6); sub-tolerance (≤0.12 s) span clamps still map silently.

**Verification walkthrough** (lane app running):

- Open **http://localhost:5253** (or desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5253`). Sandbox DB has "test set" (8 tracks: 2 Transition pins, 3 Take pins, 2 hard cuts).
1. Library → Sets → "test set" → **▶ Play set**. While it plays, open the FIRST pinned adjacency in the Transition editor (set row → its transition chip / pair). Confirm playback keeps running (21).
2. **Downstream edit at the handover**: with the playhead still in the first track's solo, drag the transition's window later/earlier and reshape a fader lane; save happens on drag-release (300 ms autosave). Back in the Set view the ladder re-draws; the handover then PLAYS the edited version — no interruption, no deck restart at the edit moment.
3. **Sounding-window lanes live**: let playback run INTO a pinned window (or seek into it), keep the editor open on that adjacency, drag an EQ/fader lane — hear it change immediately under the playhead. Drag the window's geometry (start/duration) instead — nothing changes audibly until the window completes; the next replay of that adjacency (seek back) plays the new geometry.
4. **Re-pin / reorder during playback**: while a track solos, re-pin a downstream adjacency (pin picker) or drag-reorder downstream rows — the run continues, ladder and plan update, the handover follows the new plan. Reorder so the CURRENTLY SOUNDING track leaves the set → the set stops conducting, audio keeps playing, and the Pickup button shows the unlit teaching reason.
5. **Tempo by ramp**: while playing, flip the tempo chip to Fixed / change the Set tempo — pitch glides over ~1.5 s (no snap), position continues.
6. Row ▶ on another row mid-playback still just seeks (no session bounce) — the relaxed same-set check.

Gate run on the change: `uv run -m pytest` (666 passed), `npm --prefix frontend run build` ✓, `npx vitest run` (1093 passed, incl. new `replan.test.ts`, `replanFlow.test.ts`, Conductor re-plan describe), `uv run alembic heads` → one (`0022`), eslint clean on touched files. Two-axis code review run; findings addressed (clamp-glitch fix above, window-key dedupe) or noted (feed re-declares the pane's query keys — deliberate cache sharing; graft expiry is a 250 ms poll, not boundary-driven — sub-tick latency on a 250 ms grid is inaudible for geometry landing).
