# Minimal audible loop: engage and release

Status: done (implemented, change korxkwrz)

## Parent

`.scratch/looping/PRD.md`

## What to build

The **Active loop** (glossary) end-to-end at fixed size: press LOOP, hear a clean 4-beat loop, press again to release.

Loop state — beat-domain region (start + length in beats) plus active flag plus per-Deck pending size (default 4) — lives in the transport reducer beside playhead/playing, and surfaces in the Deck snapshot. Engaging anchors the region at the playhead: Quantize on snaps the start to the nearest beat (possibly slightly ahead — the playhead plays into it; the playhead itself never moves on engage), Quantize off starts exactly at the playhead. Seconds are projected through the Beatgrid at gesture time. Releasing lets the playhead flow past the end edge — no relocation. Load clears the loop. Gridless Track: the control is inert. The loop is Deck state — it survives view switches and audible-surface displacement (pause in a loop, visit the Transition editor, return, resume wrapping).

The wrap is enforced in the audio path at sample accuracy: the pure worklet source kernel wraps the voice position when it crosses the loop end from inside, with declick handling, identically in resample and time-stretch (Key Lock) modes; loop wrap takes precedence over end-of-track inside the region. The engine's playhead anchor math stays correct across wraps (ADR 0018 — kernel stays pure and testable).

Triggers: a minimal `LOOP 4` stateful button (lit green while active — state color, never Deck identity) in the Performance Deck panels' beatjump/pads column and the library player's control overlay; keyboard `r` (Deck A) / `u` (Deck B) in the Performance view, `r` in the library view, with the usual key hints. "Loops" joins the Controller gesture-class vocabulary (ADR 0019): registered by the Performance and library surfaces, dropped by the Transition editor; actual hardware mapping stays out of scope.

## Acceptance criteria

- [ ] Pressing LOOP (button or key) while playing engages a 4-beat loop that wraps sample-accurately and click-free, in both Key Lock modes; pressing again releases past the end edge
- [ ] Quantize on: region start snaps to the nearest beat; off: starts exactly at the playhead; engage never moves the playhead
- [ ] Reported playhead position remains correct across many wraps (no drift in the engine clock)
- [ ] Load clears the loop; view switches and editor displacement preserve it; gridless Track: control inert
- [ ] Loop state (region, active, pending size) visible in the Deck snapshot; button lit green while active, in both Deck surfaces
- [ ] Reducer tests: engage/release, snap vs exact, clear-on-Load; kernel tests: wrap across the end edge, declick, both modes, wrap-vs-end-of-track precedence; engine tests: clock across wraps

## Blocked by

- `01-quantize-toggle-placement-snapping.md`

## Comments

**2026-07-05 — Done** (jj change `korxkwrz`, workspace looping). Loop state (`loop: LoopRegion | null` + `pendingLoopBeats`) lives in the transport reducer; `loop-toggle` event engages (start snapped per Quantize via `snapToNearestBeat`, end via new `addBeats` grid projection; playhead never moves; gridless = inert, needs ≥2 beats) and releases (no relocation). New `playback/loop.ts`: LoopRegion, size constants, `formatLoopBeats`, `foldLoopPlayhead` (engine-clock modulo fold). Kernel: `setLoop({startFrames,endFrames}|null)`; a live voice crossing the end from inside wraps via the existing declick splice machinery (retire + fresh voice at the wrapped position), identical in resample and stretch modes (stretch re-primes per wrap); wrap beats end-of-track inside the region (end clamped to track length); render loop reordered tails-before-live so a mid-block wrap can't double-mix. Protocol `loop` command + `DeckSourceNode.setLoop`. Engine: `toggleLoop()`, loop-diff → worklet sync + re-assert per start, `getPlayhead` folds into the region (anchor-guarded), Load clears loop but keeps pending size; snapshot gains `loop`, `pendingLoopBeats`, `hasBeatgrid`. UI: `LoopRow` (`LOOP N`, lit green = state color) in DeckPanel padcol + library Player overlay; keys `r`/`u` (perf, in DECK_KEYS + hints) and `r` (library hub); "loops" gesture class (SurfaceLoops + audibleLoops + shared-surface registration + `loop-toggle` ButtonTarget/dispatch case — editor unregistered, drops). Tests: reducer loop-toggle block, kernel loop-wrap block (8 cases incl. declick splice sum, precedence, stretch), engine loop block (snapshot/Load/gridless/pause), loop.test.ts fold math. Note: engine "clock across wraps" is covered by the pure fold tests — the running-clock path needs live audio the engine tests can't fake. (Process note: the 02 Done comment accidentally rode trunk change `wnoxsnsq` via a wrong-workdir append — content accurate, change attribution wrong; landed, immutable.)
