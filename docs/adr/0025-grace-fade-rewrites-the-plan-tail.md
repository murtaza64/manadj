# Grace fade rewrites the plan's tail, never its windows

Status: accepted (sets 14, 2026-07-05)

When adjacency i+1's window opens before adjacency i's has closed (or before a
hard-cut outgoing has finished), entry i+2 needs the deck entry i still
occupies — ping-pong parity leaves no third deck. Found in the sets 04 review
click-through: the runtime jump-cut the shared deck, aggravated by load
latency. Something authored has to give. The surprising decision: **the
planner forges the dying track's tail** — it truncates entry i's exit to
`W(i+1).mixStart − grace` and synthesizes a fade-out ramp on its role-fader,
REPLACING the authored tail (authored lane material past the truncation is
unreachable and dropped). The transform lives in `planSet` itself
(`applyGraceFades`, `frontend/src/sets/planner.ts`), so the ladder, per-row
durations, and Conductor all agree on the rewritten plan — it is a plan
transform, not runtime improvisation.

Alternatives considered and rejected:

- **Fade the incoming in late** (start entry i+2 after the deck frees) —
  mutilates the authored move's identity: the pinned Transition's opening is
  exactly "the move I intend" (PRD story 7).
- **Shift W(i+1) later** until the deck is free — changes authored timing;
  every pin downstream drifts. Windows are the user's artifact; the planner
  never moves them. (Hard-cut instants stay put too — they are derived from
  the outgoing's *authored* end, so a truncated hard-cut tail buys its load
  headroom with up to `grace` seconds of planned silence rather than a
  timing shift.)
- **Handle it in the Conductor** ("latest window wins" + clock freeze, the
  pre-14 behavior) — the runtime and every visualization disagree about what
  should sound; the jump-cut stays audible and undocumented.

The forgery is confined to the tail: `grace` (load headroom, default 5s) and
the fade length (~2s, ending at the truncation instant) are tunable settings
(`sets/setSettings.ts`), not model. Degenerate pileups — truncation that would
cut into entry i's own entry window — get no heroics: the plan stays
as-authored and carries an error-severity validation flag (`grace-floor`,
same family as 06's runway flag), rendered as an error in the Set view.

Hard to reverse because the plan's public shape now carries the rewrite
(`PlannedEntry.graceFade`, truncated `exitSec`/`exitMixSec`) and every
consumer — ladder clip geometry, "plays m:ss" row durations, `planStateAt`
lane evaluation, the Conductor's deck-freeing — leans on it.
