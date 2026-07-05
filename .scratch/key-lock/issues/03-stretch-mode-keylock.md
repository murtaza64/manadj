# 03 — Stretch mode + Key Lock toggle

Status: done — landed; human smoke test passed 2026-07-05

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

## Comments

- Done (change `key-lock: 03-stretch-mode-keylock`). Signalsmith Stretch
  runs INSIDE the deck-source worklet: the npm package's emscripten factory
  is vendored (`worklet/vendor/signalsmithStretchModule.js`, MIT, tail
  patched to export the factory) and driven per block with the package's
  own buffer-mode window model (`_seek` + `_process`; window ends at
  position + rate × outputLatency + inputLatency — read-ahead per ADR
  0018). Kernel: voices carry a mode; StretchEngine seam is pure-fakeable
  (13 new kernel tests); mode switch = the stab splice at the live voice's
  position; tails always render varispeed (single stretcher instance,
  Mixxx-style). Persistence: `playback/keyLockStore.ts` (default ON, only
  explicit false is off), applied to the shared Decks at DeckContext boot;
  engine default is OFF so the editor's private decks stay varispeed (v1
  scope). MixZone LOCK button next to the KEY readout, PFL lit idiom.
- Machine-verified through the real worklet: 440Hz sine → 475.1Hz at
  rate 1.08 resample; 440.1Hz at 1.08 AND 0.92 in stretch mode.
- Human smoke test passed (pitch sweeps, mid-play toggles, stabs, nudges,
  both decks locked). Known/accepted edges recorded in review: LOCK-on at
  0% is not bit-perfect (windowed resynthesis; PRD guarantees bit-perfect
  for OFF only); splice tails are ≤5ms varispeed; stretch rate is
  per-block (~2.9ms); stretcher-init failure and foreign-sample-rate
  tracks silently degrade to varispeed with the button still lit (near
  unreachable; candidate follow-up if it ever bites).
- Smoke-test fallout fixed in the same landing: Chrome autoplay policy —
  MIDI input is not user activation, so a hardware play on a fresh
  (boot-restored) context left it suspended (UI ran, no audio).
  `DeckEngine.resumeWithGestureRetry` re-tries on the next real gesture,
  guarded so it never undoes an arbiter suspend (ADR 0013).
