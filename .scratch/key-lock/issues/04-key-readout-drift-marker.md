# 04 — KEY readout drift marker (follow-up)

Status: done — landed; eye-verified 2026-07-05

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

## Comments

- Done (change `key-lock: 04-key-readout-drift-marker`). Pure predicate
  `keyDrifted(keyLockOn, pitchPercent)` in playback/tempo.ts (threshold
  KEY_DRIFT_PITCH_PERCENT = 3 ≈ half a semitone; bend excluded — same
  anti-wobble reasoning as effectiveBpm), tested. MixZone KEY readout dims
  + gains a `~` while drifted; the tilde is always laid out (transparent
  until drifted) so the readout width never jumps. Eye-verified.
- Rode along (user-requested foot-row polish): the KEY/BPM readout labels
  removed (values keep tooltips); dead `.perf-readout-label` rule dropped.
