# PRD: Mix editor — arrange tracks with drawn transitions

Status: ready-for-agent
Blocked by: nothing hard — the two-track prototype runs on today's modules; graduation aligns with the ADR 0009 Mixer module (see Implementation Decisions)

## Problem Statement

As a DJ, I have no way to sketch a mix: I can play tracks and (soon) perform with two decks, but I can't lay out "this track into that track, bass swap here, 20-second blend" and listen back to it. Ideas for transitions and pairings live in my head and die there. I want to arrange tracks in a sequence with predetermined transitions — a DJ.STUDIO-style editor at sketchpad fidelity — and over time accumulate a library of transitions and pairings that feed real mixing sessions.

## Solution

A **Mix editor** mode: arrange Tracks on a horizontal timeline, where each adjacent pair overlaps in a **Transition** — anchors and duration in seconds, with drawn automation lanes (channel faders, EQ, filters) shaped in a breakpoint editor. Playback is deterministic: a MixPlayer sequences two alternating deck instances and applies lane values continuously. Lane shapes save as duration-normalized **Transition templates** ("bass swap") for reuse. v1 is a deliberately isolated two-track arranger prototype persisting to localStorage; graduation adds DB persistence and moves playback onto the shared Mixer graph.

## User Stories

1. As a DJ, I want to place two tracks on a timeline with an adjustable overlap, so that I can define where one hands over to the other.
2. As a DJ, I want to drag each track's entry/exit anchors and the transition duration in seconds, so that any style of transition is expressible — beatmatched blend, ambient wash, or hard cut.
3. As a DJ, I want to draw automation lanes (piecewise-linear breakpoints) for channel faders and EQ over the transition, so that I can shape the blend precisely without performing it.
4. As a DJ, I want outgoing/incoming fader and low-EQ lanes visible by default and the rest (mid/high EQ, filter, trim) addable on demand, so that the common case is immediate and the full mixer reachable.
5. As a DJ, I want optional per-transition tempo matching (incoming track varispeed-matched to the outgoing), so that beatmatched blends are one toggle.
6. As a DJ, I want the matched track to ramp gently back to its native BPM after the transition, so that tempo drift never compounds across a Mix.
7. As a DJ, I want anchor snap-to-beat and beat guides in the lane editor when Beatgrids exist, so that beat-aligned work is easy without being mandatory.
8. As a DJ, I want to press play anywhere on the mix timeline — including mid-transition — and hear exactly what the arrangement specifies, so that iteration is instant.
9. As a DJ, I want to save a transition's lane shapes as a named template and apply a template to another transition, so that signature moves ("bass swap") become reusable vocabulary.
10. As a DJ, I want to save and reopen Mixes, so that sketches persist across sessions.
11. As a DJ, I want each timeline block to show the track's waveform strip, so that I can aim anchors at structure (drops, breakdowns) visually.
12. As a DJ, I want the editor isolated from the Performance view's decks, so that opening a sketch never disturbs a live mix.
13. As a DJ, I want my saved Mixes to eventually surface as track-pair knowledge ("what mixes well into this?"), so that sketching builds a transition library over time.
14. As the developer, I want lane evaluation, arrangement math, template normalization, and tempo-ramp math as tested pure modules, so that playback determinism is exact and regression-guarded.

## Implementation Decisions

- **Domain model** (glossary: Mix, Transition, Transition template; ADR 0010): a Mix is an ordered Track sequence with one Transition per adjacency; no clip/region concept — played portions are implied by surrounding Transitions. Transitions are pairwise: at most two tracks sound at once.
- **Seconds-based, drawn** (ADR 0010): anchors/durations in seconds; lanes are breakpoint polylines on a duration-normalized axis; beat-snapping and tempo-match are affordances. No crossfader lane (channel faders only); no pitch lanes (tempo-match is a setting + post-transition ramp-back). Recording transitions from live two-deck performance is a deferred capture method emitting the same lane format.
- **Playback**: a MixPlayer module owns a mix-timeline clock, alternates two deck instances through the sequence, and applies lane values at animation-frame rate through the existing ramped channel setters. Seek = evaluate all lanes at *t*, position decks, play.
- **Prototype isolation**: the two-track prototype instantiates its own deck pair using today's modules — two independent DeckEngines suffice because the model has no cross-deck coupled controls (crossfader was eliminated). Needs only a channel-volume setter on the deck's existing graph. Accepted prototype trade-offs: OS-level summing (keep faders conservative; no master limiter), two contexts' clocks (millisecond-scale, fine for ideation). **Graduation** moves playback onto the shared Mixer/one-graph architecture (ADR 0009) for a real master bus and limiter — aligning with, but not blocked by, the performance-mode work.
- **Arranger UI (v1)**: horizontal timeline; per-track blocks with full-track waveform strips (renderer minimap mode); drag block offset and anchor/duration handles; lane editor under the transition region (click-add, drag, double-click-delete breakpoints); snap toggle; click-to-seek + space transport; track search picker with two slots; save/apply named templates.
- **Persistence**: prototype in localStorage JSON (the model will churn). Graduation slice: backend models for Mix, ordered entries, Transitions, templates + alembic migration — Mixes are library artifacts and future association queries want them in the DB.
- **Track association is future, not now**: a Transition already *is* a track-pair association with anchors; the planned "transition library / what mixes into this" features are an index over saved Transitions. Nothing in v1 needs to manifest associations — only avoid precluding them (the model doesn't).
- **View wiring**: separate route/view ("Mix editor"), sidebar entry alongside Performance; no coupling to Library selection or Performance decks.

## Testing Decisions

- Established seam (ADR 0002, vitest, pure modules, no Web Audio mocking):
  - Lane evaluation: mix-time → control values (breakpoint interpolation, normalized-axis stretching, out-of-transition defaults).
  - Arrangement math: mix-time → active track(s), per-deck track positions, deck alternation; anchor/duration edge cases (zero-length transition = cut, transitions at track ends).
  - Template normalization round-trip (save at one duration, apply at another).
  - Tempo-match + post-transition ramp math.
- MixPlayer's audio behavior, the arranger UI, and lane-editing feel stay ear/eye-verified — they are the prototype's research questions.

## Out of Scope

- Recording transitions from live performance (future capture method)
- More than two simultaneous tracks / non-pairwise overlaps
- Offline render/export to file (future: OfflineAudioContext over the same lane data)
- Keylock/time-stretch (tempo-matched blends detune under varispeed — same named gap as everywhere)
- Track-association/transition-library features (future index over Transitions)
- Curve types beyond piecewise-linear; lane editing outside transitions (full-mix automation)
- Master tempo curve (DJ.STUDIO-style); per-mix master EQ/effects
- Seeding a Mix from a Playlist (obvious future flow, one line here so it isn't forgotten)

## Further Notes

- ADR 0010 records the seconds-based drawn-automation decision and its rejected alternatives; ADR 0009 defines the graph the graduated feature lands on.
- The prototype is genuinely unblocked today: DeckEngine, DeckGraph (EQ/filter/volume), the clock-driven renderer, and beatgrid/waveform APIs are all in place from the practice-view and deck-consolidation work.
- The deeper goal named during design: Mixes accumulate into a library of transitions and double-drop pairings. Every design choice here keeps that door open without building it.
