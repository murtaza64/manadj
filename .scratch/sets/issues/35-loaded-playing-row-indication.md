# 35 — Set rows: per-deck loaded highlight + animated playing indicator

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (feedback 2026-07-05)

## Problem

During Set playback only one row is highlighted ("the active row"). But conduction routinely has TWO tracks loaded (outgoing + incoming, especially through windows), and the single highlight also conflates *loaded* with *playing*.

## What to build

- **Loaded = deck-identity mark, per row.** Any Set row whose track is currently loaded on a Deck is highlighted in that Deck's identity color (A cyan / B magenta) — both rows at once when both decks hold Set tracks. This reflects **live deck occupancy** (deck state), NOT the plan's ping-pong parity: after takeover, manual loads, or practice (13), occupancy can diverge from the plan — the highlight must follow reality. (The existing static deck-color row accents from plan parity are a separate, unchanged thing.)
- **Playing = animated indicator, on top.** A row whose loaded track is actually playing gets a small moving "playing" icon (classic animated EQ-bars idiom); paused-but-loaded rows keep the identity highlight without the animation.
- **Glossary discipline** (Deck color entry): deck colors are identity only, state colors never denote a deck — this split satisfies it exactly: the color says *where it's loaded* (identity), the animation says *it's playing* (state). Do not tint the playing animation per-deck; it's a state mark (neutral/green per app convention).
- Works regardless of Conductor state: conducting, after takeover, or plain manual deck use with a Set open — the marks always mirror the shared Decks. Replaces the current single "active row" highlight (the conducting row is, by definition, a loaded+playing row now).
- Coexistence: must remain simultaneously legible with selection (18), hover treatments (22 / perf-layout 08 vocabulary — these marks are STATES, not hovers), and the NEVER AUDIBLE / UNPRACTICED badges.

## Acceptance criteria

- [ ] Both loaded Set tracks show their deck-identity highlight simultaneously, matching actual deck occupancy (verify divergence: take over, load a different Set track manually — highlight follows)
- [ ] Playing rows animate; paused-but-loaded rows don't; the animation is deck-neutral
- [ ] Mid-window during conduction: both rows highlighted, both animating
- [ ] Selection, hover, and badges all remain distinct and visible on a loaded+playing row
- [ ] Tracks not in the Set loaded on a deck: no Set-row effect (nothing to mark)

## Notes

- Deck occupancy + transport state are already exposed (DeckContext / engines; the conducting-row logic consumed something similar) — this is a read-only view concern, no store/model changes expected.
- Sequencing: Set rows are quiet right now (22 landed; 31/32/33 queued pending triage) — bundle with the rows batch or dispatch alone; check `.lanes/` at dispatch time.

## Blocked by

—
