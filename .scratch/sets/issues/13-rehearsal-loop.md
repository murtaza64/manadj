# 13 — Rehearsal loop: practice an adjacency live, pin the fresh Take

Status: ready-for-human

## Parent

.scratch/sets/PRD.md (grilled 2026-07-05, round 3 — see PRD Comments)

## What to build

The one-gesture loop: editing a Set → an adjacency is Unpracticed or its pin displeases → mix it live on the decks → the captured Take surfaces on that adjacency immediately, one click to pin.

**Practice affordance** — a second verb on each adjacency row, distinct from the editor click-through (issue 09: *sketch it*; this: *mix it live*):

- Loads outgoing→Deck A, incoming→Deck B (editor convention; Conductor parity is irrelevant here), staying in the Performance view.
- Cue positioning: pinned/planned adjacency → A at the planned window start minus a runway (tunable heuristic, ~30s), B at its planned entry. Unresolved → A at its last hot cue (cue-slot convention puts it near the mix-out region) else N seconds before its end; B at its Main cue.
- Pressing practice again re-cues both decks to the same spots — the rehearsal reset.

**Fresh-Take surfacing**:

- Persisting a captured Take invalidates the takes query — all Set-view evidence counts recompute live. (Honest latency: detection completes after the Handover settle horizon — a few seconds after the outgoing goes silent.)
- The adjacency matching the Take's ordered pair grows a transient "new take — pin?" chip; one click pins it (never auto-pinned — Takes are unreviewed by definition; this is the softest manual act).
- Repeated attempts: the chip reflects the latest Take; the evidence count carries the rest; click-through to Take review (Transition history) remains for inspection/promotion.

## Acceptance criteria

- [ ] Practice on a pinned adjacency cues A before the planned window, B at its entry; on an unresolved adjacency uses the hot-cue/Main-cue fallbacks
- [ ] Practice again re-cues both decks identically
- [ ] Mixing the pair by hand yields a Take that bumps the adjacency's evidence count without a reload
- [ ] "New take — pin?" chip appears on the matching adjacency; clicking pins that Take
- [ ] Five consecutive attempts: chip offers the latest, count shows all
- [ ] Editor auditions and Conductor playback still produce no Takes (no capture regression)

## Blocked by

- 02-adjacency-pins-evidence (done)

Dispatch note: touches `SetDetailPane.tsx` (adjacency rows) — hold until the parked 03+04 stack lands, then bundle naturally with issue 09 (both are adjacency affordances). Planned-window positioning consumes the issue-03 plan; the fallback path works without it.

## Comments

**2026-07-05 (agent, lane setui) — implemented, parked for review** (jj change `lpyqvuys`, stacked on 09's `pqmwzoxy`)

Mechanism: each adjacency row grows a dashed-yellow "⏵ practice" button (second verb beside 09's row click-through). Pressing it stops any Conductor, then cues outgoing→A / incoming→B on the shared decks: positions from `sets/practice.ts` (pure, tested) — planned adjacency → A at `mixStartSec − mixOffsetSec − 30s runway`, B at `entrySec` (read-only `useSetPlan` consumption); unresolved/hardcut → A at its temporally-last hot cue else `duration − 30s`, B at its Main cue. Re-press pauses + re-seeks (identical spots); a cue on an unloaded track parks via a one-shot engine subscription that fires when decode completes (re-press mid-load re-parks without restarting the fetch). The shared surface keeps audibility, so capture stays armed — mixing the pair by hand is what produces the Take.

Fresh-Take surfacing: `capture/takeSink.ts` now invalidates `['takes']` itself on persist (via the new module-scoped `api/queryClient.ts`; TakeHistoryView's redundant event listener retired along with `TAKE_RECORDED_EVENT`) and records the take in `capture/freshTakes.ts` (latest-per-ordered-pair store, house snapshot/subscribe pattern, tested). The matching adjacency shows a mauve "● new take — pin?" chip offering the LATEST take; one click pins (`{kind:'take'}`) and retires the offer; never auto-pinned. Counts recompute from the invalidated query — repeated attempts: chip = latest, count = all.

Capture regression guard: recorder gating (`audibleHolder() !== 'shared'`) untouched — editor auditions ('editor' claim) and Conductor playback ('conductor' claim) still produce no Takes.

Verification: gate green on the rebased stack (pytest 648, vitest 944/63 files incl. new practice + freshTakes tests, tsc+vite build, alembic single head; no backend files touched). Code-review findings addressed: duplicate invalidation path removed; in-flight re-press no longer restarts the load.

**Verification walkthrough** — lane app at http://localhost:5313 (desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5313`):

1. Performance view → in the embedded library, select a Set. On an adjacency with a green ◆ pin, press "⏵ practice" → deck A loads the outgoing track parked ~30s before the transition window; deck B loads the incoming at its planned entry (check the waveform playheads).
2. Play with the decks (nudge, play a bit), press "⏵ practice" again → both decks pause and re-cue to the same spots.
3. On an unresolved (✕) adjacency, press practice → A parks at its last hot cue (or 30s before the end if it has none), B at its Main cue.
4. Mix the pair by hand: play A, bring B in with the crossfader, fade A out. A few seconds after A goes silent (the settle horizon), the adjacency's `tk` count bumps without a reload and the mauve "● new take — pin?" chip appears on that adjacency.
5. Click the chip → the pin chip flips to "● take · <today> (unpromoted)", the offer disappears.
6. Repeat the mix a couple of times without pinning → the chip stays (offering the latest), the `tk` count grows by one per attempt.
7. Regression guard: audition inside the Transition editor, and play a Set via ▶ Play set — neither should add `tk` counts or chips.
