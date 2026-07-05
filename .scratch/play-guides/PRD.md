# PRD: Play guides

Status: ready-for-agent

## Problem Statement

The Transition library records how to mix out of the playing Track into the next one — entry/exit anchors, alignment, tempo-match. But in the Performance view, none of that knowledge is visible at the moment it matters. With the incoming Track loaded and paused, the DJ has to remember or re-derive the alignment by ear and eye: where in the outgoing Track the saved Transition begins, and when to press play so the pair lands on the rehearsed alignment. The saved Transition sits in the library while the performer flies blind.

## Solution

**Play guides** (see `CONTEXT.md`): when one Deck is playing and the other holds a paused Track, every saved Transition from the playing Track to the paused Track projects a marker onto the performance waveforms — a single line spanning both stacked waveform rows, labeled in the gutter with the Transition's name, carrying the paused Deck's color. The line sweeps toward the playhead as the outgoing Track plays; press play on the paused Deck the instant they coincide and the pair rides the saved Transition's alignment.

The guide is dynamic: it works wherever the incoming Track is cued. Given the paused Deck's current playhead, the marker sits at the A-track-time where that cued position coincides with the Transition's saved trajectory — `startSec + (playheadB − bInSec) / r`, `r` being the Transition's tempo-match ratio (or 1). Scrubbing the paused Deck moves the marker; cueing at the Transition's own entry recovers the static alignment point as a special case.

Guides are purely visual, derived state — never stored, never editable, never enforcing pitch. A pitch mismatch against the Transition's tempo-match is surfaced on the label chip, not corrected.

## User Stories

1. As a DJ in the Performance view, I want a marker on the waveforms showing when to press play on the paused Deck, so that a saved Transition's alignment is reproducible live without re-deriving it by ear.
2. As a DJ, I want the guide computed from wherever the incoming Track is currently cued, so that I am free to cue anywhere (a hot cue, a scrubbed position) and still get a correct press moment.
3. As a DJ, I want one guide per saved Transition from the playing Track to the paused Track, so that a pair with several rehearsed moves shows all my options.
4. As a DJ, I want each guide labeled with its Transition's name, so that I can tell my options apart at a glance.
5. As a DJ, I want a favorited Transition's guide to show its star, so that my proven move stands out among alternatives.
6. As a DJ, I want the guide line to span both stacked waveforms with the label in the gutter between them, so that the press moment reads as one instant across the pair rather than a per-deck annotation.
7. As a DJ, I want the guide to carry the paused Deck's color (cyan/magenta), so that it reads as "Deck B business on Deck A's timeline" per the Deck-color-is-identity rule, and stays self-labeling when I swap which Deck is playing.
8. As a DJ, I want the guide visually distinct from Hot Cues (different glyph, name label instead of slot badge), so that I never mistake derived guidance for a stored cue.
9. As a DJ, I want the guide to move with the waveform like any track-time landmark, so that judging the approach uses the same eye skills as hot cues and beatgrid lines.
10. As a DJ, I want guides on the minimap as well as the main waveforms, so that I can see whether the press moment is thirty seconds or three minutes out.
11. As a DJ, I want a missed guide (already behind the playhead) to stay visible and scroll away rather than vanish, so that I understand why nothing is upcoming and that re-cueing the incoming Track earlier would bring it back.
12. As a DJ, I want the marker position to use the Transition's saved tempo-match ratio rather than my current pitch faders, so that the guide always shows the press moment for the Transition as saved, not for whatever my faders happen to be doing.
13. As a DJ, I want the guide correct regardless of the playing Deck's pitch, so that riding pitch on the outgoing Track never invalidates the marker (it lives in A-track-time and moves with the waveform for free).
14. As a DJ, I want the label chip to warn me with the required pitch value when the paused Deck's effective rate would drift from the Transition's ratio, so that I can set the fader before the press instead of discovering the drift after it.
15. As a DJ, I want no warning shown when my pitch is within tolerance of the required ratio, so that the guide stays quiet when everything is already right.
16. As a DJ, I want the guide never to auto-set my pitch fader, so that a passive visual never produces a surprising transport side effect mid-set.
17. As a DJ who saved a Transition with a silent lead gap (negative incoming entry anchor), I want the guide to account for it, so that pressing play with the incoming Track cued at its start still lands the alignment.
18. As a DJ whose saved Transition contains Jump events, I want the guide projected on the trajectory before the first Jump, so that the press moment anchors to the alignment at the window start and mid-mix jump choreography stays my own gesture.
19. As a DJ, I want guides to appear only when exactly one Deck is playing and the other holds a paused loaded Track, so that they never clutter the view when both Decks are stopped or both are running.
20. As a DJ, I want guides to disappear the moment I press play on the incoming Deck, so that the display returns to clean performance state once the guidance has served its purpose.
21. As a DJ, I want guides to recompute when I swap which Deck is playing, so that the feature is symmetric: the playing Deck is always the outgoing side and the direction of the Transition lookup follows.
22. As a DJ, I want only Transitions in the playing→paused direction to produce guides, so that a Transition saved in the opposite direction never suggests a nonsensical press moment.
23. As a DJ, I want guides to update live as I scrub, jog, or hot-cue the paused Deck, so that the marker always reflects my actual cued position.
24. As a DJ, I want guides to appear or update when Transitions for the loaded pair are saved or edited elsewhere (Transition editor), so that the Performance view reflects the current library without reloading.
25. As a DJ, I want the guide to be non-interactive (not clickable, not draggable), so that a derived marker never pretends to be editable state.
26. As a DJ playing doubles (same Track on both Decks with a saved self-Transition), I want guides to work unchanged, so that the technique needs no special casing.

## Implementation Decisions

- **Vocabulary**: the concept is **Play guide**, already defined in `CONTEXT.md` (avoid: transition guide, entry/cue marker). All naming in code and UI follows the glossary.
- **Purely derived, frontend-only**: no schema changes, no API changes, no persistence. Guides are computed on the client from data already loaded: the pair's saved Transitions (pair store / transition index, boot-loaded per ADR 0011's client-authoritative model) and the Decks' live snapshots.
- **Pure model module** (the single seam): a new pure module computes guide descriptors from plain inputs — the ordered pair's Transitions (playing→paused, looked up via the existing directional transition index), the paused Deck's playhead, both Tracks' BPMs, and both Decks' pitch state. Output: plain descriptors `{ aTime, name, favorite, requiredPitchPercent?, pitchMismatch, missed }`. All semantics live here:
  - Marker position `m = startSec + (playheadB − bInSec) / r` in A-track-time, where `r` is the Transition's saved tempo-match ratio (`bpmA/bpmB` when `tempoMatch`, else 1).
  - Actual pitch faders never move the marker; A-track-time placement makes the marker correct under any outgoing-Deck pitch by construction.
  - Negative `bInSec` (silent lead gap) needs no special case — the formula covers it.
  - Jump events: project against the pre-first-Jump trajectory only; positions beyond that segment use straight-line extrapolation of the initial ratio.
  - `missed` when `m` is behind the playing Deck's playhead — the marker is reported, not dropped.
  - Pitch mismatch: flagged when the paused Deck's effective rate diverges from `r` (given the playing Deck's current pitch) beyond a small tolerance; the required pitch value is included for display. Tolerance is a tunable heuristic inside the module, not part of the concept.
- **Appearance condition**: exactly one Deck playing, the other Deck loaded and paused, and at least one saved Transition in the playing→paused direction. Both-paused, both-playing, or wrong-direction-only pairs produce no guides. Symmetric across Decks.
- **Wiring**: the Performance view subscribes to the transition index (as the embedded Library and LinkToggle already do) and both Deck snapshots, feeds the pure model per frame or per relevant state change, and passes descriptors down to rendering. Thin, no logic.
- **Rendering**:
  - Main waveforms: one vertical line per guide spanning both stacked rows. Because zoom is linked (shared wall-clock window, per-Deck rate scaling), one A-track-time maps to one screen x valid across both rows. Marker data reaches each waveform via the existing overlay prop path (the route Hot Cues take into the renderer); the shared line/label treatment sits at the view level across the two rows.
  - Label: a chip in the gutter between the rows (introducing that gutter is part of this work — today the rows stack with no gap), showing the Transition name, favorite star, and — on mismatch — the required pitch in a warning treatment. Chip and line carry the paused Deck's color.
  - Glyph distinct from Hot Cues: no slot badge, no hot-cue rect treatment; shape alone must distinguish a guide from a cue at a glance.
  - Minimap: a guide mark per descriptor on the playing Deck's minimap.
  - Non-interactive throughout.
  - Screen-projection math that is more than trivial lives in the pure module (or existing zoom utilities), not in the renderer.
- **Performance view only**: the library view shows a single Deck; no guides there.
- **No ADR**: nothing hard to reverse — derived, view-only rendering.

## Testing Decisions

- **What makes a good test**: assert external behavior of the pure model — descriptors out for plain inputs in — never rendering internals or store subscription mechanics. Expected marker positions are computed by hand from the Transition arithmetic and written as independent literals, never re-derived through the code under test (the discipline the follow-model tests document explicitly).
- **The one seam under test**: the pure play-guide model. Cases to cover:
  - Basic dynamic projection: marker moves as the paused playhead moves; cueing at `bInSec` recovers the static alignment point.
  - Tempo-match ratio vs 1:1; marker indifferent to actual pitch fader values.
  - Negative `bInSec`.
  - Pre-first-Jump projection with a Jump present; extrapolation beyond the segment.
  - Missed markers flagged, not dropped.
  - Multiplicity (several Transitions for the pair → several descriptors) and directionality (reverse-direction Transitions produce nothing).
  - Appearance conditions (both playing / both paused / nothing loaded → empty).
  - Pitch mismatch flag and required-pitch value, including tolerance boundary and the playing Deck's pitch factoring into the required rate.
  - Doubles (same Track both Decks, self-Transition).
- **Prior art**: the pure-model vitest pattern used across the codebase — the follow-mode model tests (which already build pair-store + transition-index fixtures), the transport reducer tests, the perf-diff overlay math tests, and the waveform-zoom math tests. Colocated `*.test.ts`, node environment, no jsdom, no component tests.
- **Untested by decision**: wiring (subscription plumbing) and rendering (WebGL overlays, gutter chip, minimap marks), consistent with the codebase's existing treatment of waveform rendering.

## Out of Scope

- Auto-setting the paused Deck's pitch to the Transition's ratio (rejected: transport side effect from a passive visual).
- Quantized or latency-compensated auto-trigger of play — the guide is visual only; the press is the DJ's.
- A "cue the incoming Deck to this Transition's entry" affordance (surfaced during grilling as a possible follow-up; not in this PRD).
- Reproducing the Transition's automation lanes (faders, EQ, filter) live — the guide covers alignment timing only.
- Planning entries via mid-Transition Jump landings (guide projects the pre-first-Jump segment only).
- Guides outside the Performance view (library view, Transition editor).
- Any backend, schema, or Sync changes.

## Further Notes

- Deck colors are identity-only per the glossary; the guide deliberately uses the *paused* Deck's color on both rows to say "this instant concerns the other Deck." Green/blue state colors must not leak into guide styling.
- The gutter between the two waveform rows does not exist today; introducing it is a layout change that should stay minimal (the rows currently stack flush).
- The accumulating Transition library was always meant to seed track-association features; this is the first feature that pays it back *during* performance rather than during browsing.
