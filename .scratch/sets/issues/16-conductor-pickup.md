# 16 — Pickup: Conductor resumes from manual deck state

Status: done (approved + landed 2026-07-05, change `mylmsyuu`)

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

## Verification walkthrough (2026-07-05, lane setlist, change `mylmsyuu`)

Implemented as specced. Pure seam: `sets/pickup.ts` — `evaluatePickup`
(predicate + reasons), `mixTimeForTrackTime` (the planStateAt inverse:
window segments / Tempo-return quadratic / solo anchor),
`flipPlanDecks`, `pickupStartLanes` — 29 vitest cases incl. round-trip
invariants (a lit instant puts the anchor exactly where its playhead
is). Runtime: `Conductor.pickup` (no-silence claim via
`claimAudible(id, {silencePrevious:false})`, mixer/pitch convergence
ramp, anchors never re-seeked mid-ramp), `pickupSetPlayback` (one
coherent snapshot per decision), toolbar button in SetDetailPane.
Capture rule rides the recorder's existing gate; 2 new regression
tests. Gate: 651 pytest · 999 vitest · build clean · one alembic head
(0021) · eslint clean on touched files.

Open **http://localhost:5253** (or `npm --prefix desktop start -- --port
5253`). Sandbox DB has set **test set** (8 tracks; adjacencies: 2
transition pins, 3 take pins, 2 hard cuts).

1. Sets → **test set**: the toolbar shows a dimmed **⤴ Pick up**; hover
   → "No audible deck to anchor on — bring a set track into the mix".
2. **One-deck pickup**: load "Weeble Wobble VIP" (track 1) on a deck by
   hand, play it mid-track, fader up. The button lights (peach). Click:
   the set resumes from that instant — the anchor keeps playing without
   a glitch, the other deck loads/cues "Last Time", mixer/pitch glide
   to the plan over ~1.5s (no snaps), ladder playhead lands mid-track-1.
3. **Takeover → pickup loop**: while conducting, nudge any fader —
   Conductor stops, decks keep sounding (takeover). The button lights
   again; click — seamless resume. Repeat at will.
4. **Reasons teach the fix**: seek the deck near its end (past the
   window) → dimmed "outside its planned span — silent in the set".
   Load a non-set track → "not in the set". Bring a second wrong deck
   audible → "…fade Deck X out and the button lights"; fade it → lit.
5. **Wrong physical deck**: track 1 on Deck B only → still lights;
   pickup runs the set deck-mirrored (flip) — watch the handover load
   land on Deck A.
6. **Paused pickup**: pause the deck mid-span, fader up → still lit;
   pickup resumes from the parked spot.
7. **Two-deck blend**: hard to stage by hand — use ⏸ mid-transition,
   then takeover by touching a fader, then Pick up while both decks
   sit aligned: lit, adopts the blend mid-window.

Notes for review: (a) deck-flip (`flipPlanDecks`) is my reading of
"automatic mapping" for a track sitting on the other physical deck —
mapping, not re-planning (instants/tracks/Transitions unchanged); flag
if you want it cut. (b) The two-deck instant derives from the audibly
dominant deck; alignment residue lands on the other. (c)
`pickupToleranceSec` raised past the drift tolerance (0.12s) means the
non-dominant deck can be adopted off-plan enough that the first
post-ramp drift check re-seeks it audibly — documented at the setting.
(d) Mid-engagement abandonment / post-settle preservation of Takes is
recorder-gate behavior, regression-tested in recorder.test.ts.
