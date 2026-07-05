# 16 — Pickup: Conductor resumes from manual deck state

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (grilled 2026-07-05, round 4 — see PRD Comments; glossary: Pickup)

## What to build

The inverse of takeover. After manual fiddling, a **Pick up** control adopts the current deck state as a mix instant and resumes Set playback from it — explicit gesture, automatic mapping, never audibly destructive.

**Predicate** (button lit iff the state maps cleanly; anchored on the audibly dominant Deck, computed from mixer state via the Master-bus audibility model even when paused):

- Lit: exactly one audible Deck on a Set track within its planned audible span (entry ≤ τ ≤ exit) → mix instant `t = mixOffset + τ`; positions inside a transition window count (pickup then reconciles the silent incoming deck like a seek).
- Lit: two audible Decks on adjacent Set tracks, both in span, relative alignment within tolerance of the pinned Transition (tunable; default the Conductor's drift tolerance) → pickup adopts the blend mid-window.
- Unlit, reason shown: anchor track not in the Set / anchor outside its planned span ("silent in the set") / two audible decks non-adjacent or misaligned. The reason teaches the fix: fade the stray channel out and the button lights. No "pick up anyway" that yanks a live deck; no re-planning around the user (the plan is fixed).

**At the pickup instant:**

- Anchor Deck untouched — seamless by construction.
- Non-anchor (silent) Deck reconciled per `planStateAt(t)`: load, cue, start as needed.
- Mixer converges: each control ramps from its current value to the plan's over a short tunable window (~1–2s) — the mirror of takeover's inaudible disengage.
- Pitch ramps back to the plan's rate (a Tempo return in a new costume); sticky per-Deck settings (Key Lock) untouched.
- Capture: Conductor playback goes invisible again; an in-flight Handover engagement is abandoned — no Take (finishing by machine forfeits it; pick up after the settle horizon to keep a completed take).

## Acceptance criteria

- [ ] Button lit/unlit matches the predicate in all five cases; unlit states show their reason
- [ ] One-deck pickup mid-track and mid-window both resume correctly; anchor audio never glitches
- [ ] Two-deck aligned pickup adopts the blend; misaligned shows the fade-out hint and lights after the stray deck is faded
- [ ] Mixer/pitch converge by ramps, no snaps
- [ ] Mid-engagement pickup yields no Take; post-settle pickup preserves the completed Take
- [ ] Predicate + mapping logic is pure and tested at the planner seam (`planStateAt` companion)

## Blocked by

- 05-seek-playhead-follow (pickup is structurally "seek with an untouchable anchor" — 05's plan-evaluation seek is the engine)
