# PRD: Controller LED Feedback (pad + transport lights)

Status: ready-for-agent

## Problem Statement

The Inpulse 300 MK2's lights are dark while using manadj. The DJ can't glance
at the hardware to see which pads hold hot cues, whether a deck is playing,
or whether a press latched — they must look at the screen, which defeats the
point of a hardware surface. (PRD midi-controller shipped input-only; MIDI
output was its top named follow-up.)

## Solution

Feedback (glossary): the Controller's lights mirror existing on-screen state.
Hot cue pads light when their slot is assigned on the loaded Track; the PLAY
LED shows playing/pending/paused; the CUE LED shows ready-at-cue and
hold-to-preview. Lights sync fully on connect and stay correct through loads,
hot cue edits (from screen or hardware), and replug. Feedback adds no
capabilities — losing it changes nothing about what the app can do.

## User Stories

1. As a DJ, I want pads with assigned hot cues lit, so that I can stab cues without looking at the screen.
2. As a DJ, I want empty pad slots dark, so that I never stab a pad expecting a cue that isn't there.
3. As a DJ, I want pad lights to update when I set a hot cue from the hardware, so that the surface confirms what I just did.
4. As a DJ, I want pad lights to update when I set or delete a hot cue on screen, so that hardware and screen never disagree.
5. As a DJ, I want pad lights to switch when I load a different Track, so that lights always describe the loaded Track.
6. As a DJ, I want all eight pads dark on an empty deck, so that an unloaded deck looks unloaded.
7. As a DJ, I want the PLAY LED solid while the deck plays, so that I can see transport state across the booth.
8. As a DJ, I want the PLAY LED blinking while play is latched during a load, so that I know the deck will start when decode finishes.
9. As a DJ, I want the PLAY LED off while paused, so that a stopped deck is obviously stopped.
10. As a DJ, I want the CUE LED solid when the deck is paused at the cue point, so that I know a stab is armed.
11. As a DJ, I want the CUE LED lit during hold-to-preview, so that I can see why audio is playing.
12. As a DJ, I want every light correct immediately when I plug the Controller in (or replug it mid-session), so that the surface is trustworthy from the first glance.
13. As a DJ, I want the lights to go dark when the app releases the device, so that stale state doesn't linger on the hardware.
14. As a DJ, I want lights driven per-deck independently, so that deck A's state never bleeds into deck B's lights.
15. As a DJ, I want Feedback to work from any view, so that the hardware mirrors the decks even while I browse the library.
16. As a mapping author, I want all LED addresses in the device's Mapping file, so that device knowledge stays in one place.

## Implementation Decisions

- The device's pads are boolean lights (no RGB): lit = assigned, off = empty.
  `HotCue.color` remains a screen-only concern.
- LED addresses (notes/channels/velocities for pads, PLAY, CUE, per deck) are
  sourced from Mixxx's MK2 mapping as ground truth and hardware-verified at
  smoke test; they live in a new `feedback` section of the Mapping schema.
- Pad-mode isolation: pad modes are note-isolated on this device; we write
  only the HOTCUE-mode base-layer addresses and never touch other modes'
  lights.
- The adapter grows output-port support: match output ports by the same
  port-name substring as inputs, publish a per-device send capability
  module-level (mirroring the connection store), send all-off on detach and
  dispose.
- A headless feedback bridge component (beside the existing control
  registrar) subscribes per deck to the deck snapshot (transport LEDs) and
  the hot cue query cache (pads — the same source the on-screen pads use, so
  they cannot drift), computes desired LED states, and sends.
- Desired state is recomputed and fully resent per deck on: controller
  connect/replug, Track load (including boot restore), hot cue set/delete,
  transport snapshot changes. No diffing — 10 lights per deck is nothing.
- Blink is app-driven (the device has no native blink): one ~2 Hz timer,
  running only while some deck is pending-play.
- LED updates after a hardware pad-set round-trip through the mutation and
  query cache (brief lag accepted). Optimistic LED-on is a flagged future
  improvement.
- Transport-state semantics reuse the deck snapshot's existing vocabulary
  (playing, pendingPlay, previewing, cuePoint) — no new engine state.

## Testing Decisions

- The tested seam is pure: deck/hot-cue state in → per-light on/off out, and
  light state → MIDI bytes out (given a Mapping's feedback section). Assert
  observable outputs only, never bridge internals — same philosophy as the
  translator and dispatch tests (synthetic input → asserted output).
- Blink phase logic tested pure (pending → alternating states under a fed
  clock), like the jog controller's fake-timer tests.
- The adapter's output half and the feedback bridge are hands-on-verified
  glue, per house style (no Web MIDI mocking — ADR 0002 discipline).

## Out of Scope

- RGB/color fidelity (device is boolean).
- Non-HOTCUE pad modes, shifted-layer pad lights.
- Beatmatch-guide lights, VU meters, ring/display output.
- Optimistic LED updates ahead of the mutation round-trip (flagged follow-up).
- PFL button LEDs ship with the headphone-cue feature but reuse this
  feature's output seam and bridge.
- Any behavior change to input handling.

## Further Notes

- The glossary defines Feedback; ADR 0013's routing rules are untouched —
  Feedback is read-only with respect to app state.
- The headphone-cue feature depends on this feature's output seam for its
  PFL button LEDs; land this first.
