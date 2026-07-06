# 24 — Live re-plan: plan-input edits reflect into ongoing Set playback

Status: ready-for-agent

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
