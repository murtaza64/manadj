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
