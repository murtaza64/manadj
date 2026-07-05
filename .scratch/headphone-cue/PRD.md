# PRD: Headphone Cueing (Cue bus, PFL, output routing)

Status: ready-for-agent

## Problem Statement

There is no way to pre-listen: whatever the decks play goes to the one output
everyone hears. The DJ cannot audition or beatmatch the next Track in
headphones while the room hears the master — the defining workflow of DJing
with hardware.

## Solution

A Cue bus (glossary) alongside the Master bus: per-channel PFL toggles put a
channel's post-EQ/filter, pre-fader signal in the headphones, blended with an
adjustable taste of master (cue/mix). Master and Cue are each independently
routable to any audio output device — primary setup: master on Mac audio, cue
on the Inpulse's built-in interface (headphone jack). The Controller's PFL
buttons and cue-level knob drive it; the screen grows the same controls plus
the routing picker and the cue/mix slider.

## User Stories

1. As a DJ, I want a PFL toggle per channel, so that I can put either deck in my headphones regardless of its fader.
2. As a DJ, I want both PFL toggles active at once, so that I can hear both decks blended while beatmatching.
3. As a DJ, I want the cue tap post-EQ/filter but pre-fader and pre-crossfader, so that I audition the next track fully shaped with its fader down.
4. As a DJ, I want a cue/mix blend from cue-only to full master, so that I can bring the room mix into my headphones while aligning.
5. As a DJ, I want the blend built so cue and master are sample-aligned inside the headphones, so that beatmatching by ear is trustworthy.
6. As a DJ, I want the hardware PFL buttons (per deck) to toggle PFL, so that cueing lives on the surface.
7. As a DJ, I want the hardware headphone-level knob to set cue volume, so that headphone level is physical.
8. As a DJ, I want on-screen PFL buttons mirroring the hardware ones, so that the Controller adds no capability the screen lacks.
9. As a DJ, I want on-screen PFL buttons to repaint when toggled from hardware (and vice versa), so that the two surfaces never disagree.
10. As a DJ, I want the PFL button lights on the Controller to show which channels are cued, so that I can see cue state on the surface.
11. As a DJ, I want to route the Master bus to any output device, so that the room plays from whatever speakers I choose.
12. As a DJ, I want to route the Cue bus to a different device than master, so that headphones on the Inpulse work while master plays from the Mac.
13. As a DJ, I want Mac speakers and Mac-jack headphones usable as two devices in the same way, so that I can cue without the controller's interface.
14. As a DJ, I want my routing choices remembered across restarts, so that my booth setup is plug-and-go.
15. As a DJ, I want a missing saved cue device to disable the Cue bus but leave master playing on the default device, so that audio never dies because I forgot to plug something in.
16. As a DJ, I want the Cue bus torn down safely if its device disappears mid-session, so that master audio is never at risk.
17. As a DJ, I want PFL toggles and cue/mix to reset to defaults each session (off / cue-heavy), so that a session starts predictable, like the rest of the mixer.
18. As a DJ, I want the routing picker in the app chrome (top bar or the performance view's middle strip), so that routing is reachable but out of the way.
19. As a DJ, I want cueing to work from any view, so that I can pre-listen while browsing the library.
20. As a DJ, I want the transition editor's private player unaffected, so that audible-surface arbitration keeps working as documented.

## Implementation Decisions

- The Mixer owns the Cue bus: per-channel PFL tap nodes (post-EQ/filter,
  pre-fader), a cue sum, the cue/mix blend (master signal mixed in-graph),
  and a cue gain (cue-level). All in the main AudioContext.
- Cross-device delivery per ADR 0017: the blended cue signal crosses to the
  cue output device over a MediaStream bridge into a second AudioContext
  whose sink is the cue device. The cue context contains only the bridge
  source and nothing else. Master device selection uses the primary
  context's sink.
- Routing state: enumerate audio output devices, persist device id + label
  per bus; re-resolve on boot; missing device → default device for master,
  disabled Cue bus. Performance state (PFL, cue/mix) resets per session.
- Action vocabulary grows: PFL toggle button target per channel, cue-level
  absolute target, cue-mix absolute target. Dispatch routes them to the
  registered mixer surface like existing mixer targets (jump semantics, no
  soft takeover).
- Hardware bindings (learned): PFL = note 0x0C on the per-deck channels;
  cue-level = the 14-bit CC pair 0x04/0x24 on the mixer channel. Cue/mix has
  no hardware control on this device — screen slider only, target
  hardware-bindable for other devices later.
- On-screen controls subscribe through the Mixer's existing change
  subscription (hardware moves repaint them, same as knobs/faders today).
- PFL button lights ride the LED Feedback seam (midi-pad-leds feature);
  cue state is part of the mixer state the feedback bridge can read.
- The audible-surface arbiter (ADR 0013) is untouched: the Cue bus belongs
  to the shared Mixer; the editor's private surface gains nothing.

## Testing Decisions

- Good tests assert observable behavior at existing pure seams: dispatch
  routing (action in → mixer surface call out, prior art: dispatch tests),
  translator decode (already covered by the 14-bit/button decoders), cue
  gain/blend math as pure functions (prior art: mixerMath tests), routing
  resolution logic (saved device present/missing → chosen sinks) as a pure
  function.
- Web Audio graph topology and the MediaStream bridge are hands-on-verified,
  consistent with how the existing Mixer graph is handled (no Web Audio
  mocking).

## Out of Scope

- Single-context 4-channel optimization for the all-Inpulse setup (ADR 0017
  names it as a later optimization).
- Split cue (cue in one ear, master in the other), booth bus, recording bus.
- Soft takeover for cue-level (jump semantics, like the rest of the PRD line).
- OS-level aggregate devices; VU metering of the cue bus.
- Persisting PFL/cue-mix across sessions.

## Further Notes

- Depends on midi-pad-leds only for the PFL button lights; all audio work is
  independent and can proceed in parallel up to that issue.
- Glossary: Cue bus, PFL (CONTEXT.md); architecture: ADR 0017.
- Chrome/Electron caveat to verify early: `AudioContext.setSinkId` device ids
  come from `mediaDevices.enumerateDevices`, whose labels/ids may require a
  permission grant; the desktop shell can pre-grant. A tracer issue should
  prove the bridge + sink selection end-to-end before the mixer work builds
  on it.
