# 03 — Stretch mode + Key Lock toggle

Status: ready-for-agent

## Parent

`.scratch/key-lock/PRD.md` (architecture: ADR 0018)

## What to build

Key Lock itself, on the worklet from issue 02, with the stretcher chosen in
issue 01.

- Stretch mode in the worklet: bake-off winner behind the internal seam
  (feed samples, set rate, set transpose=none); prime-and-drop on every
  seek/start/mode-switch; internal crossfade between modes at the audible
  position.
- Deck Key Lock state: sticky per Deck, default ON, persisted; covers the
  composed rate (pitch × bend) by construction (one rate reaches the
  worklet).
- MixZone toggle button next to the KEY readout, lit when on; disabled
  never (works loaded or not — it's a Deck setting).
- Both Decks locked simultaneously without glitches.

## Acceptance criteria

- [ ] Pitch sweeps ±8% hold the Track's Key with the toggle on; couple
      speed/pitch with it off
- [ ] Nudges (keyboard + jog) stay in Key while locked
- [ ] Mid-play toggle: no click, no position jump
- [ ] Cue/hot-cue stabs feel instant in both modes
- [ ] Two locked Decks play clean (CPU headroom from issue 01 holds)
- [ ] Toggle state survives reload, per Deck
- [ ] Mode/splice bookkeeping under vitest (pure); audio quality hands-on
      per ADR 0002
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 01-stretcher-bakeoff (library choice)
- 02-worklet-source-resample
