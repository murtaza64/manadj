# 04 — KEY readout drift marker (follow-up)

Status: ready-for-agent

## Parent

`.scratch/key-lock/PRD.md`

## What to build

When a Deck has Key Lock OFF and |pitch| ≥ ~3% (≈ half a semitone), the KEY
readout dims / gains a `~` marker: the sounding key has drifted from the
Track's Key, so Key-compatibility judgments are off. No computed "actual
key" (rejected in the PRD as false precision).

## Acceptance criteria

- [ ] Marker appears/disappears with the threshold, live with the fader
- [ ] Locked Decks never show it, regardless of pitch
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 03-stretch-mode-keylock
