# One audio graph: the Mixer owns the AudioContext

Status: accepted (restored in full by ADR 0022 — the Transition editor's private-mixer deviation is retired)

Two-deck performance requires mixing in-graph, so there is exactly one `AudioContext`, owned by a Mixer module — not by decks. `DeckEngine` no longer creates or revives its own context; it is constructed against the shared context and an output node. Each deck feeds a mixer channel strip, and the signal chain mirrors DJ hardware:

deck (source → declick envelope, varispeed) → trim → 3-band isolator EQ → sweep filter → channel fader → crossfader gain pair → master gain → final output guard → destination

ADR 0034 supersedes the original `DynamicsCompressorNode` limiter detail:
neutral trim supplies summing headroom and Master/Cue end at a -2 dBFS
sample-peak ceiling.

The EQ and sweep filter move out of the deck's graph into the channel strip: on hardware they are mixer controls, and the domain model follows the hardware.

## Considered options

- **Two independent engines with their own contexts** — rejected: mixing would happen at the OS level (no shared gain stage → no crossfader, master, limiter, or future master-bus recording), and the decks would run on different hardware clocks, poisoning future sync/beat-alignment math.

## Consequences

- The StrictMode-safe context revival (lazy create/recreate-if-closed) moves up from `DeckEngine` into the Mixer/provider layer.
- The final output guard is always on; its policy is defined by ADR 0034.
- Headphone cue (pre-listen on a second output device) is deferred but shaped by this decision: it would be a second output path from the same graph (Chrome `AudioContext.setSinkId`), not a second engine.
- Recording a mix later is a tap on the master bus.
