# 02 — Cue bus + PFL end-to-end

Status: ready-for-human

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

Press PFL (hardware or screen) and hear that channel in the headphones:

- Mixer grows the Cue bus: per-channel PFL taps (post-EQ/filter, pre-fader,
  pre-crossfader), cue sum, cue gain; the summed signal rides issue 01's
  bridge to the cue device. Both channels may be cued at once.
- Action vocabulary + dispatch: PFL toggle button target per channel routed
  to the registered mixer surface; Inpulse binding note 0x0C on the per-deck
  channels (hardware-learned).
- On-screen PFL toggle per deck (performance view), subscribed through the
  Mixer's change subscription so hardware and screen repaint each other.
- Audible-surface arbitration untouched (Cue bus belongs to the shared
  Mixer; the editor's private surface gains nothing).

## Acceptance criteria

- [ ] PFL A/B (screen or hardware) puts that channel in the headphones with
      its fader down and crossfader away, EQ/filter audible
- [ ] Both PFLs on → both decks blended in headphones
- [ ] Screen buttons reflect hardware toggles and vice versa
- [ ] No cue device configured → PFL toggles work (state) but produce no
      sound anywhere; master unaffected
- [ ] Dispatch routing + cue gain math under vitest (prior art: dispatch and
      mixerMath tests)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-sink-bridge-tracer

## Comments

- (hpcue lane, change vlrunqwz) Implemented:
  - Mixer: `ChannelState.pfl` (default off per session), per-strip `pflGain`
    tapped off the sweep output (post-EQ/filter, pre-fader/crossfader) →
    `cueSum` → `cueGain` (cue level, `cueLevelToGain` audio taper, default
    0.7 — headphone-safe, knob jumps anyway) → cue safety limiter (same
    settings as master: two full-scale cued tracks) → issue 01's CueBridge.
    All rebuilt on graph revival; cue sink reapplied, failure → cue disabled
    + notify, master untouched.
  - API: `setPfl`/`togglePfl` (both channels may sum), `getCueLevel`/
    `setCueLevel`, `getCueSinkId`/`setCueSinkId(null = torn down)`.
  - Actions: `ButtonTarget` += `{ control: 'pfl'; channel }` (mixer-facing →
    `channel:` key); dispatch routes down-edge to
    `midiMixerControls()?.togglePfl` — outside the arbiter like the other
    mixer controls (ADR 0013 untouched; tested).
  - `MidiMixerControls` += `togglePfl` (Mixer still registers itself).
  - Inpulse mapping: note 0x0C ch 1/2 → PFL A/B (hardware-learned).
  - Screen: PFL toggle in each deck's MIX-zone foot (`perf-pfl`, green when
    on), driven by `useMixerValue` channel state so hardware ↔ screen
    repaint each other. Works with no track loaded and with no cue device
    (state-only, silent).
  - Tests: dispatch PFL routing (down edge, per channel, arbiter bypass,
    unregistered no-op), `cueLevelToGain` in mixerMath.test.ts. 423 vitest
    green; tsc + eslint clean.
- No cue device yet (issue 04 builds the picker): use the dev tracer —
  `__routing.setCue('inpulse')` routes the real Cue bus; `setCue(null)`
  disables.
- Smoke-test feedback (2026-07-05): cueing verified working (Mac
  speakers/headphone-port split; Inpulse jack fixed separately — see issue
  01's cue-to-3-4 comment). On-screen PFL now shows a headphone glyph
  instead of the "PFL" text (polish change); "PFL" stays in tooltip/aria.
- READY-FOR-HUMAN (change vlrunqwz): with master on Mac speakers and
  `__routing.setCue('inpulse')`: PFL A with fader down + crossfader hard-B →
  deck A alone in headphones, EQ/filter moves audible; PFL both → blend;
  hardware PFL buttons toggle the screen buttons and vice versa; with cue
  never configured, PFL still toggles and nothing plays anywhere.
