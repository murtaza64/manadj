# Key Lock — grill notes (2026-07-04)

Decisions from the grilling session (PRD to follow via /to-prd).

## Vocabulary

- Canonical term: **Key Lock** (glossary entry added to CONTEXT.md). The
  fader stays "pitch fader"; "pitch" keeps meaning the ±% rate control.

## Decisions

1. **Per-Deck sticky toggle, default ON**, persisted. Belongs to the Deck —
   not Track, not Mixer.
2. **Covers the composed rate** (pitch × Nudge bend): the Deck stays in Key
   for everything that changes effective tempo while playing.
3. **Static routing, dual-mode worklet**: one AudioWorklet per Deck is the
   Deck's only audio source. Mode "resample" (Key Lock OFF) = worklet-side
   varispeed, bit-perfect at rate 1.0, ~zero latency. Mode "stretch"
   (Key Lock ON) = time-stretcher without transpose. Toggle = internal mode
   switch with a short internal crossfade; the graph never changes. The
   AudioBufferSourceNode path is retired.
4. **Latency model = Mixxx's** (validated against
   enginebufferscalerubberband.cpp): pull-based processing with read-ahead
   into the decoded track — algorithmic latency becomes input read-ahead,
   not output delay. Prime-and-drop on every seek/start/mode-switch
   (start-pad silence in, start-delay frames dropped) kills onset delay and
   fade-in. Playhead math (anchor + rate × elapsed) stays exact; hot cue
   stabs stay instant.
5. **Stretcher-agnostic seam; bake-off before commitment.** Candidates:
   Signalsmith Stretch (MIT, first-party WASM, npm signalsmith-stretch) vs
   Rubber Band WASM (GPL accepted if it wins by ear). Criteria: sound
   quality at ±8%, CPU for two decks, start-pad/onset parity.
6. **v1 scope: shared Decks only.** Transition editor follow-up filed with
   the PRD.
7. **Surface**: per-Deck toggle button in the MixZone next to the KEY
   readout, lit when ON. Hardware binding deferred until a candidate button
   (likely VINYL) is learned on the device. KEY readout keeps showing the
   Track's Key in v1; follow-up: dim/`~`-mark the readout when Key Lock is
   OFF and |pitch| is large enough to matter (≈ ≥3%). Computing the actual
   sounding key was rejected as false precision.

## Noted tensions

- **Editor architecture challenge**: the Transition editor owns a private
  playback surface (ADR 0013 family) with its own player. Key Lock
  machinery now lives in the Deck's worklet source — the editor's player
  either duplicates the dual-mode worklet, or the editor eventually plays
  through the shared Decks instead of a private surface. Tempo-matched
  editor playback is where Key Lock matters MOST (sustained rate offsets
  while judging harmonic blend), so this follow-up is not optional polish —
  it may force revisiting the private-surface decision.
- **Decoded-sample residency**: the worklet needs its own copy of the
  decoded track unless the buffer cache is restructured (SharedArrayBuffer
  needs cross-origin isolation; transfer would take the buffer away from
  the main thread). ~100MB/track ×2 decks of extra residency if naive.
