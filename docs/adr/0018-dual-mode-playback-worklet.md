# Deck audio comes from a dual-mode pull worklet, not AudioBufferSourceNode

Key Lock (CONTEXT.md) needs a time-stretcher in the playback path, and Web Audio
has no native one — `detune` on a buffer source just multiplies into the rate.
We decided each Deck's one audio source is an AudioWorkletNode holding the
decoded samples, with two internal modes: **resample** (Key Lock off —
worklet-side varispeed, bit-perfect at rate 1.0, ~zero latency) and **stretch**
(Key Lock on — a time-stretcher without transpose). `AudioBufferSourceNode`
playback is retired.

## Considered options

- **Dual routing** (keep the buffer source for Key Lock off, add a worklet for
  on): rejected — toggling swaps live graph nodes (splice clicks, two code
  paths for one transport), and the off path would be the rarely-used one.
- **Always-stretch, no resample mode**: rejected — a stretcher at unity is not
  bit-perfect (windowed resynthesis) and its coloration+cost would be paid
  even when doing nothing.

## Latency model (Mixxx prior art)

The worklet is pull-based with read-ahead (validated against Mixxx's
`EngineBufferScaleRubberBand` + `ReadAheadManager`): for file playback the
stretcher's algorithmic latency becomes *input read-ahead*, not output delay,
because future samples are already available. Every seek/start/mode-switch
primes the stretcher with start-pad silence and drops the start-delay frames
from the first output — no onset delay, no fade-in. Consequently the engine's
playhead math (`anchor + rate × elapsed`) stays exact, hot-cue stabs stay
instant, and "Playhead = what is sounding" holds without compensation.

## Consequences

- The stretcher library sits behind a worklet-internal seam (feed samples,
  set rate, set transpose) and is swappable; the library choice (Signalsmith
  Stretch vs Rubber Band WASM, GPL accepted if it clearly wins by ear) is
  deliberately NOT part of this ADR — a prototype bake-off decides it.
- The worklet needs the decoded samples on the audio thread; the buffer cache
  must hand them over (copy or restructure) — decided in the implementing
  issue, not here.
- The Transition editor's private playback surface (ADR 0013) does not get
  Key Lock from this work; tempo-matched editor playback is where Key Lock
  matters most, so the follow-up may force revisiting the private-surface
  decision (noted in .scratch/key-lock/). *(Resolved 2026-07-05 by ADR
  0022: the private surface is retired — the editor plays through the
  shared Decks and their sticky Key Lock.)*
