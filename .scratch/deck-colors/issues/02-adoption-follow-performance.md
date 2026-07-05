# 02 — Deck colors: adoption in Follow and the Performance view

Status: done — pending user eye-verify

## What to build

Adopt the Deck colors (CONTEXT.md: Deck color) on the surfaces that currently show no A/B identity, under the identity-vs-state rule — Deck colors mean identity; green/blue keep meaning state (play, PFL, pitch accent) and are never per-Deck.

- **Follow toggles** (FilterBar `[A][B]`): on-state color/border becomes the Deck color (A cyan, B magenta) instead of green; off stays neutral.
- **Follow parameters modal**: the per-Deck reference badges take Deck colors.
- **Performance deck tags** (`perf-decktag`): colored per Deck.
- **Channel volume fader fills**: Deck color per channel strip; MASTER's fill stays green (not a Deck).
- **Crossfader**: opposite-side fills — the region right of the handle fills cyan (A), left of the handle magenta (B) — so each colored width tracks that Deck's presence (hard left = full-width cyan = all A). Width is handle-position-based, not gain-curve-based. Small Deck-colored `A`/`B` labels at the physical left/right ends (labels in normal orientation; only the fills are reversed).
- **Load-to-deck hover buttons** in track rows: the existing per-deck classes take Deck colors.

Untouched: PFL, play buttons, pitch accent, waveforms, the library Player.

## Acceptance criteria

- [ ] Follow toggles show Deck colors when on; no green identity anywhere
- [ ] Performance view: deck tags and channel fader fills are Deck-colored; MASTER fill unchanged
- [ ] Crossfader hard-left reads as all-cyan, hard-right all-magenta, center half/half; colored end labels present
- [ ] Track-row load buttons Deck-colored on hover
- [ ] All colors consumed via the issue-01 source (no new hex literals)
- [ ] Gate green

## Blocked by

- 01-single-source-of-truth

## Comments

- Done (rrsmrnkp, lane followmode): Follow toggles + params-modal badges in Deck colors; perf deck tags (`.perf-decktag.deck-a/b`); channel VOL fill via new HFader `fillColor` (MASTER untouched); crossfader `crossfade` mode — opposite-side fills (right-of-handle cyan/A, left magenta/B, position-based) + colored end labels in physical orientation; per-deck load-button colors. All via the issue-01 vars; no new hex literals. NOTE: this change was untangled (jj split) out of a working copy shared with the follow-mode 08 agent; TrackRow.css hunks were separated manually.
