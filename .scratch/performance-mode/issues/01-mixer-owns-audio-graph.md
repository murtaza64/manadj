# 01 — Mixer owns the audio graph; Practice view deleted

Status: done (implemented, change vmyttqqw)

## Parent

`.scratch/performance-mode/PRD.md` (ADR 0009)

## What to build

The one-graph refactor: a Mixer module owns the single `AudioContext`; decks become channel inputs.

- Mixer module (framework-free, like the deck engine): owns the context (StrictMode-safe lazy create/revive moves here from the deck), builds per-channel strips — trim → 3-band isolator EQ → sweep filter → channel fader → crossfader gain pair → master gain → always-on limiter (`DynamicsCompressorNode`) → destination. The isolator/sweep DSP moves from the deck's graph into the strip (the pure mapping functions in `graph.ts` are reused).
- `DeckEngine` is constructed against the shared context and a channel input node; it keeps transport, declick envelopes, varispeed, cue/hot-cue semantics, and loses EQ/filter/graph ownership and context creation.
- The provider owns the Mixer and two eagerly-created decks (graph nodes only; no audio memory until Load), but continues exposing only Deck A through the existing `useDeck()` API — no component changes this slice.
- Pure mixer math (trim/fader value→gain, crossfader curve with both-center behavior and end kills) lives in a pure module under vitest.
- The Practice view is deleted (its EQ/filter UI depended on the deck-owned graph). The practice route/sidebar entry temporarily renders the existing layout prototype as a placeholder until issue 03 replaces it.

## Acceptance criteria

- [ ] Library plays Deck A audibly through the mixer graph: channel at defaults is transparent (flat EQ, open filter, unity trim/fader, crossfader center), limiter always in the chain
- [ ] Full library parity: load, play/pause, cue semantics, hot cues, beatjump, scrub, pitch — all unchanged by ear and by the transport tests
- [ ] `DeckEngine` contains no `new AudioContext`, no EQ/filter nodes; the engine's EQ/filter setters are gone (Practice view, their only consumer, is deleted)
- [ ] StrictMode dev double-mount still safe (context revival now at the mixer/provider layer)
- [ ] Mixer math pure functions under vitest (gain mappings, crossfader curve)
- [ ] Practice view deleted; ▸ route shows the prototype placeholder
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

None - can start immediately.

## Comments

Implemented in jj change `vmyttqqw` (performance-mode: 01-mixer-owns-audio-graph).
- `playback/mixer.ts`: Mixer owns/revives the AudioContext (moved up from DeckEngine); ChannelStrip per deck (input → trim → LR4 isolator EQ → sweep → fader → crossfader gain), master gain + always-on limiter (threshold -3dB, ratio 20:1); all control state survives graph revival. `DeckAudioPort` is the deck-facing seam.
- `playback/mixerMath.ts` (+14 tests): quadratic channel-fader taper, ±12dB trim, **dipless crossfader** (unity through center — deliberate deviation from constant-power after review flagged a -3dB level drop vs the pre-mixer chain; summed-center headroom is the limiter's job).
- `DeckEngine`: constructed against a port; keeps transport/envelopes/varispeed; EQ/filter/context ownership removed. `graph.ts` reduced to pure DSP mappings (shared constants exported — no duplication with mixer).
- Provider: Mixer + two eager decks (A exposed via existing API; B idle until issue 02; both disposed before the mixer closes the context).
- Practice view + PrototypeSwitcher deleted; ▸ route renders the prototype placeholder with a back button.
- Ear-verification pending user: library parity through the mixer chain, limiter behavior.
