# 21 — Conductor playback survives entering the Transition editor

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (feedback 2026-07-05; CONTEXT.md Transition editor entry revised)

## Problem

Starting Set playback and then switching top-panel modes into the Transition editor silences it: the editor claims the Audible surface **on mount** (its original contract: "entering it pauses shared playback"), displacing the Conductor. The Conductor itself is mode-independent (module-level store; playback survives view switches) — the editor's eager claim is the only thing killing it. Observed: start set playback in editor mode (from the embedded Set pane), switch to Performance → playback dropped.

## Decision (2026-07-05, product owner)

The editor claims audibility **lazily — on its first audition gesture (play), not on mount**. Entering or leaving the editor mode never interrupts ongoing playback; one-audible-surface arbitration is unchanged at the moment an audition actually starts (the Conductor then stands down as today). CONTEXT.md's Transition editor entry updated accordingly.

## What to build

- Move the editor's `claimAudible` (and whatever setup rides it — automation engage, pitch snapshot) from mount to the first audition-start; release semantics on unmount only if the editor holds the claim.
- A mounted-but-silent editor must still be fully editable (sketching, slides, template ops) — only *sounding* requires the claim.
- Verify the matrix: Conductor playing → enter editor (keeps playing) → press editor play (Conductor stands down, editor sounds) → back to Performance (editor pauses per existing displaced-surface rule); plain deck playback → enter editor (keeps playing); editor keyboard transport before any claim.
- Take capture: Conductor playback remains capture-invisible while it plays under a mounted editor; editor auditions remain invisible as today.

## Acceptance criteria

- [ ] Set playback started anywhere continues across library/performance/transition mode switches until takeover or an editor audition
- [ ] Editor audition still pauses/steals from whatever was sounding (arbiter unchanged at claim time)
- [ ] Mounted editor without audition: all editing works, nothing silenced
- [ ] Deck/mixer gestures still take over the Conductor regardless of mode
- [ ] No new Takes captured from any machine-driven path

## Notes

- Touches editor surface lifecycle (`TransitionEditor` register/claim) and possibly the arbiter — coordinate with lane setlist if 16 (pickup) is still in flight (Conductor-adjacent, different files; likely fine).
