# 13 — Rehearsal loop: practice an adjacency live, pin the fresh Take

Status: ready-for-agent

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
