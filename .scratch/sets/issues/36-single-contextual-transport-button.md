# 36 — Single contextual transport button

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (follow-up to issues 04/16/22 — filed from a
mini-grill in-session, 2026-07-05)

## What to build

Collapse the Set header's transport (▶ Play set / ⏸ / ⏹ / ⤴ Pick up)
into ONE contextual button whose verb tracks the Conductor state:

| State | Label | Look (perf-layout 08 vocabulary) |
|---|---|---|
| idle, pickup unlit | `▶ Play set` | green accent outline |
| idle, pickup lit | `⤴ Resume set` | peach accent outline |
| conducting, playing | `⏸ Pause` | solid mauve engaged fill |
| conducting, paused | `▶ Resume` | solid mauve engaged fill |

Behavior mapping: idle-unlit click → `playFromEntry(0)`; idle-lit click
→ `pickUp()`; conducting click → `conductorTogglePlay()`. No new
behavior — pure recombination of the existing actions.

## Decisions (mini-grilled 2026-07-05)

- **Pick up wins the button when lit.** Restart-from-top over live
  decks is the destructive choice; the safe action owns the button.
  Play-from-top stays reachable via row 1's hover ▶ (play-from-here).
- **The unlit teaching tooltip survives on the Play face**: `▶ Play
  set`'s title gains a second line with the pickup-unavailable reason
  (`pickupState.message`) so the sets-16 lesson is never lost.
- **⏹ Stop is dropped entirely.** Its unique job (return to idle via
  UI, decks pause) is already covered live: touching the decks
  triggers `takeover()` → conductor settles idle; practice stands it
  down programmatically; starting another set displaces it.
  `stopSetPlayback()` stays in the store for those programmatic
  callers (practice, tests). Silencing paused decks from the UI is a
  deck-panel concern, not a set-transport concern.
- **Labels are action verbs** (`⏸ Pause`, not today's status-y
  `⏸ Playing`).
- **Lit pickup drops its solid peach fill for a peach outline** —
  on a contextual button, solid fill must mean exactly "conducting"
  (engaged); lit is an available verb, and the green→peach accent
  swap carries the lit signal.

## Notes

- Keep the sets-22 layout-shift guarantees: fixed button height,
  `min-width` sized to the widest label (`⤴ Resume set`), and
  `\uFE0E` text-presentation on every glyph (Apple renders ⏸/⤴ as
  emoji otherwise — that bug shipped once already).
- `.set-play.on` / `.set-pickup.lit` CSS collapses into one
  `.set-transport` class with an `.on` engaged state; accents ride
  inline styles (the FilterBar dynamic-accent pattern).
- Pickup polling (`canPickup`/`pickupState` in `SetDetailPane.tsx`)
  is unchanged — the button just reads it.
- Transport behavior itself (Conductor semantics, pickup predicate)
  is out of scope, as in sets 22.

## Acceptance criteria

- [ ] One transport button in the header center; ⏹ and the separate ⤴ Pick up are gone
- [ ] Four faces per the table above, following the 08 vocabulary (outline rest, solid mauve only while conducting)
- [ ] Idle-unlit tooltip teaches the pickup fix (reason line); idle-lit click picks up from live deck state; conducting click toggles pause/resume
- [ ] Play-from-top reachable via row 1's hover ▶ while pickup is lit
- [ ] No layout shift across any state transition (label swaps included)

> *Filed from an in-session mini-grill; decisions above are settled — do not re-litigate.*
