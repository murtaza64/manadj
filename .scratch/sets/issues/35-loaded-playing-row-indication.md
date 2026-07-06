# 35 — Set rows: per-deck loaded highlight + animated playing indicator

Status: done (landed 2026-07-06, merge `lqrswlms`; change `lmutuszo`)

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

## Comments

Implemented 2026-07-06 (setui lane, jj change `lmutuszo` — `sets:
35-loaded-playing-row-indication`, on top of 31/32). Notes:

- Pure rules in `frontend/src/sets/rowMarks.ts` (vitest-tested):
  `loadedDecks` / `isRowPlaying` / `loadedWash`. Occupancy reads live off
  the two shared DeckEngines (`useDeckOccupancy`: primitive slices, pane
  re-renders only on load/play/pause) — view-only, no store changes.
- Loaded wash = deck color at 16% alpha, inline (wins over hover + the
  `.selected` blue wash; the blue ring still marks selection — the old
  conducting-wash precedent). Same track on both decks → A→B gradient.
- Playing mark = 3 green EQ bars in the ▶ play-from column; on row hover
  it yields to the ▶ affordance (Spotify idiom) — but only when the ▶
  actually appears (a plan-less playing row keeps its mark). Deviation
  from the strict "states outrank hovers" reading flagged on
  perf-layout 08, not forked. `prefers-reduced-motion` renders the bars
  static.
- The single conducting "active row" highlight (mauve wash) is REMOVED —
  a conducting row is a loaded+playing row now. Follow auto-scroll still
  keys off the Conductor's activeEntryIndex, unchanged.
- `playing` = the deck transport flag (hot-cue preview does not animate
  the row) — reading "actually playing" as transport state.
- For review judgment: a selected+loaded row shows identity wash + blue
  ring (no blue wash) — precedent-following but worth an eyeball.

## Verification walkthrough (ready-for-human)

Lane app on setui: http://localhost:5313 (or
`npm --prefix desktop start -- --port 5313`). Review tree includes 31+32.

1. Open the demo Set, ▶ Play set. The current track's row washes in its
   HOLDING deck's color (cyan/magenta) with animated green EQ bars in
   the leftmost column; the pre-loaded next row washes in the other
   deck's color, no bars until it enters.
2. Mid-window (during a pinned overlap): BOTH rows washed, BOTH animating.
3. Pause the Conductor: washes stay, bars stop (paused-but-loaded).
4. DIVERGENCE check (the acceptance case): take over (touch a deck
   directly), then manually load a DIFFERENT Set track onto a deck from
   the row context menu — the wash jumps to the row actually loaded,
   plan parity be damned. Load a non-Set track: no Set row marked.
5. Coexistence: select a loaded row (blue ring over the wash), hover it
   (bars yield to ▶ only where play-from exists), and check badges
   (NEVER AUDIBLE / ⚠) still read.
6. Plain manual use (Conductor idle): loading any Set track onto a deck
   still washes its row — the marks mirror the Decks, not the Conductor.
