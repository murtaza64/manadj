# PRD: Transition editor — two tracks, drawn saved Transitions

Status: ready-for-agent (re-scoped 2026-07-03; see Re-scope below)

## Re-scope (supersedes conflicting statements below)

Prototype iteration inverted the model (ADR 0010 amendment):

- The **Transition is the first-class persisted artifact**: ordered Track pair + anchors + duration + tempo-match + drawn lanes. Directional. A pair usually has one ("Transition 1", auto-created), occasionally more via a create-new dropdown; edits autosave to the active one — no save ceremony.
- The editor is the **third top-panel mode** — cycle Library (one deck) / Performance (two decks) / Transition editor — over the shared bottom library-browse panel (`Library browseOnly` + selection-based load → A/B).
- **Audio isolation + handoff**: the editor keeps its own deck pair; entering it pauses the shared decks (one audible surface at a time) and adopts their loaded track(s) as a load shortcut.
- **Deferred**: sequenced Mixes (a later feature composing saved Transitions), arbitrary-length arrangements. Transition templates were deferred here originally; they are now designed (see Transition templates below) and scheduled behind DB persistence.
- Real/effective BPM shown per deck (editable base + tempo-matched effective).

### Graduation (decided 2026-07-03)

The prototype **is graduating** (user verdict; NOTES.md). Graduation is incremental, render/motion layer first:

1. Productionize the timeline render/motion layer in place (issue 01): `WebGLWaveformRenderer` gains a driven-draw mode (the editor's single rAF motion clock calls `draw()` after writing DOM transforms — no independent renderer loops) and visible-window geometry when externally windowed (constant cost in zoom, replacing full-track regen per zoom step). The prototype shell keeps running on top; other surfaces are unaffected.
2. Remaining real-module fixes from the prototype ride back to the main line (issue 02).
3. Shell graduation (DB persistence, third top-panel mode integration) — slices to be cut after the remaining verdict details (drawing feel, playback conviction) are recorded.

Named escalations, not built: LOD/mipmap geometry pyramid if fit-zoom aggregation on long tracks is still hot; imperative per-frame timeline styles if the per-zoom-frame React commit blows frame budget.

### Transition templates (designed 2026-07-03, grill session; issue 03)

**Template = beat-domain recipe; Transition = seconds instance.** Instantiation translates beats → seconds via the tempo-matched beatgrids, keeping ADR 0010's seconds-based model intact (anchor rules are edit-time affordances).

- Contents: `alignA = (cueSlot, beatDelta)` on the outgoing track, `alignB = (cueSlot, beatDelta)` on the incoming track, `lengthBeats`, `scalable: boolean`, lanes (normalized 0→1, same `LanePoint[]` as Transitions), tempo-match implied true.
- Applying: the two resolved align points coincide and that instant is the transition start — `startSec` = A-local time of alignA, `bInSec` = B-local time of alignB; each delta resolves on its own track's grid. Drop-alignment-with-lead-in needs no extra field: shift both deltas by −lead (e.g. drop+64-beat phrase offset with 32-beat lead-in = `alignA(cue4, +32)`, `alignB(cue4, −32)`).
- Length classes: fixed (applies at exactly `lengthBeats`; choreographed moves) vs scalable (apply-time beat count, default `lengthBeats`); both resolve beats → seconds. Lanes stored normalized in both cases.
- Cue-slot convention (library convention, one glossary line, no code concept): 1 = first buildup, 4 = drop.
- Apply fallback chain, no silent guessing: cue slot → hard-coded convention heuristic (e.g. missing cue 4 → drop ≈ beat 128 from first downbeat; constant table next to the code) → current values + one-line notice. Out-of-range resolutions clamp + notice. Partial application always proceeds (lanes/length/tempo-match stamp regardless).
- Authoring: save-from-Transition only, no separate abstract editor. "Save as template" normalizes lanes, derives `lengthBeats` from the grid, and asks one explicit question per side: which cue anchors it (delta auto-derived from actual placement, rounded to whole beats with confirmation). Editing later = load onto a pair, edit, re-save. Management = dropdown (rename/delete).

### Deck slides (grill 2026-07-03 #2; issues 11–12, prototype iterations)

Hot cue and beat jump controls on both editor decks act as **Slides** (glossary), not transport: they realign the pair. Axiom: **the sketch origin is A's start** (glossary: Sketch origin) — no A content-offset exists; A-side gestures execute as their mirror.

- Gesture × lock semantics (each Slide changes the A↔B alignment; the lock chooses which side the window sticks to):

  | Gesture | Preserves | Mutates |
  |---|---|---|
  | B-slide, unlocked | window↔A | `bInSec` |
  | B-slide, locked | window↔B | `startSec` |
  | A-slide, unlocked | window↔B | `startSec` (mirrored sign) |
  | A-slide, locked | window↔A | `bInSec` (mirrored, ×rateB) |

  Equivalences: unlocked-A ≡ locked-B, locked-A ≡ unlocked-B (mirrored). Both decks get controls anyway — they aim with different landmarks (own cues/beats).
- **Playhead rule**: the playhead stays pinned to the un-slid track's content — a Slide re-cues exactly one deck engine; the other never hiccups. B-slides leave the playhead's mix position; A-slides move it by the mirrored delta (A-hotcue lands the playhead on the cue literally). Slides while playing are safe: one deck seeks, deterministic.
- **Signature gestures**: park playhead at window start + tap A.cue (unlocked) = relocate the transition to A's landmark, rig intact. Park playhead on B's drop + tap A's drop cue (locked) = double-drop alignment in one gesture (mirror: stand on A's drop, tap B's drop cue unlocked).
- **Hot cue slide math**: Δ = cueTime − playhead position (in the deck's local time); applied per the table.
- **Beat jump controls**: reuse the established idiom (`playback/beatjump.ts`: per-deck size, halve/double, 1–128, `◀ [n] ▶` + readout); jumps are in the deck's own beats (B scales by rateB into mix time).
- **Negative entry anchor is first-class**: `bInSec < 0` = B's audio begins partway into the window (silent lead gap). Player defers deck B's start to `startSec + (−bIn)/rateB`; the timeline draws B's block from its true audio start. Large positive `bInSec` makes B's content-origin virtual (extrapolated before mix 0 for short A into deep B) — only the audible portion exists; no clamps on the B side in either direction. The only clamp: `startSec ≥ 0` (a transition can't begin before A exists).
- **Model hygiene rider**: `bInSec` moves from `ProtoMix` into `ProtoTransition` — B's entry is pair knowledge and must switch with the named Transition (latent bug under multiple Transitions per pair).
- Slides are exact; the global snap toggle does not quantize slide results (snap the playhead first if you want quantized aims).

### Editor tools (grill 2026-07-03; issues 04–05, prototype iterations)

- **Chop stamp** (issue 04): shift+drag on any lane = rectangular full-cut between beat-snapped drag edges (4 inserted breakpoints, near-vertical walls); shift+click = 1-beat cut. Works on EQ lanes too (2-beat bass kill). Pure breakpoint insertion — no new model, editable like hand-drawn points. Lanes remain transition-window-only (no clip/region concept — reaffirmed).
- **Zero-length Transition shortcut** (issue 04): "cut" button sets `durationSec = 0` with beat-snapped `startSec` (model already treats zero-length as a hard cut).
- **Lane endpoint visibility** (issue 05): endpoint breakpoints (= entry/exit values) rendered larger with dark outline ring, clamped inset so they never clip at strip edges; hover shows breakpoint value, endpoints show it persistently.
- **Hotcue clarity** (issue 05): renderer config `waveformBrightness: 0–1` (default 1) scaling band colors only — markers/beatgrid full-strength; editor rows ~0.6; Player/Practice/minimaps unchanged. Rides slice 01's premultiplied-color path.
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
