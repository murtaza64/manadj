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

## Platter motion (#225)

- Scratch input is calibrated displacement over decoded PCM, not repeated seeks
  or reversed buffers. Two cascaded 8 ms velocity filters reconstruct continuous
  motion; their analytic integral is the playhead. The worklet evaluates the same
  model at sample time, independently of callback gaps. Filter states are capped
  at 16x; saturated input is discarded rather than accumulated as release debt.
- Gain follows speed with a 1 ms slew. Packet-expiry fades are forbidden: the
  first implementation amplitude-modulated even perfectly uniform jog input.
  True stops, edges, and transport handovers retain de-click fades.
- `scratchMotion.ts` is shared by the engine clock, worklet, and capture
  reconstruction. It folds loops in either direction and clamps track edges.
  The ordinary rate AudioParam remains the pitch/bend path.
- Key Lock is bypassed during scratching without changing its stored setting.
  Stem gain ramps use output time while scratching, not reversible track time.
- Slip latches on touch-down. Its hidden timeline follows normal pitch/bend and
  loops; release records the resolved landing position.
- Slip loops (#253) latch separately on loop entry and keep an unlooped clock.
  Nested scratches keep their loop-local return; loop exit uses the outer clock.
  Capture records the loop latch and resolved exit. Replay preserves loop/Play/
  Pause ordering alongside scratches on the audio clock when vinyl is present.
- Switching Slip off cancels both loop and scratch returns immediately, without
  moving playback or ending the gesture. Switching it on arms future gestures only.
- Ordinary hand-up resumes the prior transport synchronously with a 5 ms audio
  crossfade. A fresh reverse throw below -2x keeps the same gesture and Slip
  latch; real rotation extends a 12 ms coast timeout. Retouch cancels the timeout.
  Residual rim ticks are suppressed from bending for 80 ms after release. These
  controller thresholds are provisional until GRV6 listening verification.
- Sessions record scratch begin/move/end and Slip/Vinyl settings. Replay queues
  timestamped trajectories and releases on the worklet, splitting render blocks
  at command boundaries. Applying several historical jog increments on one
  animation frame would erase reversals. Replay prepares sources and uses a
  50 ms startup preroll; ownership tokens cancel queues on transport takeover.
- Scratch snapshots carry both filter states, finite track duration and the
  audio instant. Capture uses a shared audio-to-capture epoch, not callback
  spacing. Effective scratch loops are clipped to the track. Replay splits use
  offsets into output buffers; scheduled transitions are prepared off the render
  path, without per-quantum array/view allocation.
- Scratch-bearing Take/Routine promotion is refused until those artifacts can
  represent continuous signed motion. Session replay retains the raw gesture.
- Slip-loop Take/Routine promotion is likewise refused until vectorization
  preserves the compensating return jump, not only backward wraps.
