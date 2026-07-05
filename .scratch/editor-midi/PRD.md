# PRD: Editor MIDI (surface-routed gesture classes)

Status: ready-for-agent

## Problem Statement

In the Transition editor the Controller goes half-dead: PLAY works, but the
pads, jump buttons, jog wheels, and LOAD either do nothing audible or
silently poke the silenced shared decks — hardware LOAD even swaps a shared
deck the editor view doesn't show. The DJ must put the Controller down and
reach for the mouse exactly where tactile alignment gestures (Slide, jumps,
cue stabs) would shine.

## Solution

Hardware mirrors the editor's on-screen controls, deck-for-deck: pads jump
the mix (A) or Slide the incoming Track (B), jump buttons move ±N beats (A)
or Slide ±N own beats (B), jogs scrub (A) or Slide continuously (B), LOAD
assigns to the pair, and the lights tell the truth about the mix transport.
Architecturally: pads/jumps/jog become surface-routed gesture classes on the
audible-surface handle (ADR 0019) — each surface registers what the gesture
means there, and unregistered classes drop, like CUE already does.

## User Stories

1. As a DJ in the editor, I want both PLAY buttons to keep driving the one mix transport, so that transport behavior stays as it is today.
2. As a DJ in the editor, I want deck A's pads on set slots to jump the mix to that cue, so that I can restart auditioning from a known point.
3. As a DJ in the editor, I want deck B's pads on set slots to Slide that cue under the playhead, so that I can align the incoming Track by feel.
4. As a DJ in the editor, I want a pad on an empty slot to set the cue at that deck's track playhead, so that curation works the same everywhere.
5. As a DJ in the editor, I want SHIFT+pad to clear the slot, so that the clear gesture is universal.
6. As a DJ in the editor, I want deck A's jump buttons to move the mix ±N of A's beats, so that I can step through the outgoing Track.
7. As a DJ in the editor, I want deck B's jump buttons to Slide B by ±N of its own beats, so that beat-quantized alignment is on hardware.
8. As a DJ in the editor, I want SHIFT+jump to halve/double the shared per-deck jump size, so that gesture size control works in both modes identically.
9. As a DJ in the editor, I want jog A to scrub the mix with velocity (touch surface = fine, SHIFT+rim = fast), so that seeking feels like the performance side.
10. As a DJ in the editor, I want jog B to Slide continuously with velocity (touch = fine, SHIFT+rim = fast), so that final alignment is a wheel gesture, not ±10ms button taps.
11. As a DJ in the editor, I want LOAD A/B to assign the library selection to the pair (mirroring to the shared decks, re-seeding the saved Transition), so that hardware LOAD does what double-click does there.
12. As a DJ in Performance view, I want LOAD to keep honoring the load lock, so that surface routing never weakens the lock.
13. As a DJ in the library view, I want LOAD to keep replacing freely, so that existing behavior survives the refactor.
14. As a DJ in the editor, I want CUE to stay dropped, so that a meaningless gesture stays silent.
15. As a DJ in the editor, I want the PLAY LEDs lit while the mix plays (both, since both buttons drive it), so that the hardware stops lying about transport.
16. As a DJ in the editor, I want the CUE LEDs dark, so that lights never suggest a gesture that does nothing.
17. As a DJ in the editor, I want pad lights to keep showing the pair's hot cues, so that lit pads mean exactly what pressing them does.
18. As a DJ, I want every gesture class to route back to the shared decks the moment the editor closes, so that mode switches never strand the hardware.
19. As a DJ, I want mixer/pitch/PFL hardware to keep addressing the shared Mixer regardless of view, so that state controls stay predictable.
20. As a DJ in a view with no browse surface, I want encoder/LOAD to stay silent no-ops, so that nothing surprising happens outside browse-capable views.

## Implementation Decisions

- ADR 0019: the audible-surface handle grows optional gesture-class sections
  — pads (hot cue down/up/clear), jumps (beatjump), jog (rim ticks, touch
  ticks, shifted-rim ticks) — beside the existing transport/cue. Dispatch
  routes these classes through the arbiter; an unregistered class drops.
- The shared surface's registrations delegate to the exact deck behavior
  hardware has today (hot cue set/jump/preview/clear, beatjump, the jog
  bend/seek controller) — no behavior change outside the editor.
- The editor surface registers: pads → jump-to-cue (A) / Slide-cue-to-
  playhead (B) with shared set-on-empty and clear; jumps → mix seek ±N of
  A's beats (A) / Slide ±N own beats (B); jog → velocity-scaled mix scrub
  (A) / velocity-scaled Slide (B), with the touch-surface fine tier and
  SHIFT-rim fast tier mirroring the performance jog's tiering. Pad release
  is a no-op (editor gestures are taps).
- Slide-by-seconds is the jog B primitive (the continuous generalization of
  the Alignment nudge); beat-quantized Slides stay on the jump buttons.
- Beatjump-size stays shared-direct: it mutates the shared per-deck jump
  size that the editor's gesture cluster already reads.
- LOAD leaves the deck-controls registry and joins the browse-surface
  registration: the embedding view supplies its load policy (editor
  assign-to-pair, Performance lock with silent refusal, library free
  replace). No browse surface → drop.
- Feedback becomes audibility-aware for transport lights: the surface handle
  exposes a minimal observable transport state (playing per deck — the
  editor reports its one transport for both decks); the feedback bridge
  subscribes to the audible holder. Pad lights are already correct via the
  editor's pair mirroring onto the shared decks.
- Mixer, pitch, PFL remain shared-direct and are untouched.

## Testing Decisions

- Tested at the dispatch + surface seam with fake surfaces, extending the
  existing dispatch suite's arbiter tests: gesture class in → the audible
  surface's registered handler called with the right deck/pad/ticks;
  unregistered class → silence; claim/release flips routing.
- Editor gesture math that is pure (jump delta from bpm and size, slide
  deltas from jog tiers) tested pure; prior art: jog controller and
  translator suites.
- LED derivation for the audibility-aware transport lights tested pure at
  the existing ledStates seam.
- Surface registrations inside the editor and DeckProvider are glue,
  hands-on verified per house style (ADR 0002).

## Out of Scope

- New editor capabilities with no on-screen counterpart (hardware stays an
  alternative input — glossary: Controller).
- Editor mixer/pitch hardware addressing the editor's private mixer.
- Jog bend (rate nudge) in the editor — the mix transport has no bend.
- Soft takeover; encoder press; any new persisted state.
- Changes to keyboard behavior in any view.

## Further Notes

- Depends on the landed midi-controller stack, midi-pad-leds (feedback
  bridge), and the browse-surface seam from midi-controller 05.
- Coordination: `frontend/src/midi/**`, the audible-surface module, and the
  editor are hot areas — check `.lanes/` before starting.
- ADR 0019 records the routing decision; the Audible surface glossary entry
  already speaks in gesture classes.
