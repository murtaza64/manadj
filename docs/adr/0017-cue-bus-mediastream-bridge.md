# The Cue bus crosses to its output device over a MediaStream bridge

The Cue bus (headphone cueing) must be routable to a different audio device
than the Master bus — the primary setup is master on Mac speakers, cue on the
Inpulse 300 MK2's built-in interface. One AudioContext has one output device,
so the cue path runs: main graph → MediaStreamAudioDestinationNode →
MediaStreamAudioSourceNode in a second AudioContext whose sinkId is the cue
device. The whole cue signal — per-channel PFL taps AND the master blend
(cue/mix) — is mixed in the MAIN graph, before the bridge.

Why in-graph blend matters: the bridge adds latency (tens of ms, roughly
constant) and the two devices run on independent clocks. Beatmatching happens
*inside the headphones*, against the blended taste of master — building the
blend before the bridge keeps cue and master sample-aligned where alignment is
audible. The residual offset is headphones-vs-room, which is constant and no
worse than room acoustics.

## Considered options

- **Single 4-channel context on the Inpulse (master → outs 1/2, cue → 3/4)**:
  no bridge, one clock — but forces all audio onto the controller's interface.
  Rejected as the only mode (master must stay routable to Mac audio); remains
  a possible later optimization when both buses target the same device.
- **Two independent contexts, blend in the cue context**: master copy would
  cross the bridge separately from the cue taps — alignment inside the
  headphones would depend on bridge buffering. Rejected.

## Consequences

- Deck/mixer nodes stay in one graph and one clock (ADR 0009 unchanged); the
  cue context contains nothing but the bridge source and a gain.
- If the cue device disappears mid-session, the bridge is torn down and the
  Cue bus goes silent — master audio is never at risk.

## Hardware findings (2026-07-05 smoke test)

- The Inpulse enumerates as ONE 4-channel device (outs 1/2 = rear RCA, 3/4 =
  front headphone jack), so a plain stereo bridge lands on the RCA. The cue
  context therefore places the stereo cue on an explicit output pair
  (splitter → merger, 'discrete') — the picker exposes multichannel devices
  as stereo-pair entries, and outs 1/2 stay free, so master → same device
  gives the all-Inpulse setup without the single-context optimization.
- Measured bridge latency: main context 5.8 ms base / 29 ms output; the cue
  context reports 0 output latency for non-default sinks (Chrome). No
  audible glitches; the "constant-ish tens of ms" assumption holds, and
  headphone-internal blend alignment was confirmed by ear across the full
  cue/mix sweep.

## Amendment (2026-07-15, four-deck 32): bridge is cross-device only

Routing master over a bridge left the main context's own destination
rendering pure silence. After 30 s Chromium's SilentSinkSuspender
(media/base/silent_sink_suspender.cc) swaps the real sink for a
FakeAudioWorker whose per-callback frame clock drops buffers when its timer
thread runs late — under real render load (deck worklets) the main context
clock, and thus every deck, collapsed to ~0.4-0.6× wall time
(crbug.com/40247085; reproduced and verified live on the DDJ-GRV6 and the
Inpulse).

Decisions:
- The main context's sink IS the master device (`planOutput`, routing.ts).
  Master never leaves over a bridge; explicit pairs open a wider 'discrete'
  destination with a merger. The clock that drives the decks is fed by the
  audio the room hears.
- Cue joins the main destination when it targets the same device on an
  explicit pair. The MediaStream bridge remains for CROSS-DEVICE cue only.
- Every context we create keeps an inaudible ~-140 dBFS ConstantSource on
  its destination (`attachSinkKeepalive`, cueBridge.ts) so the suspender
  can never engage on a clock that matters.

The 2026-07-05 note above ("outs 1/2 stay free, so master → same device
gives the all-Inpulse setup without the single-context optimization") is
superseded: that configuration is exactly the one that starved the main
destination.
