# PROTOTYPE — mix editor two-track arranger

Throwaway. Delete or absorb after the verdict (prototype skill, rule 6).

## Questions under test

1. Does drawing transitions (breakpoint lanes over an overlap region) feel right
   as the primary authoring gesture? (vs recording — ADR 0010)
2. Does deterministic playback of a drawn Mix sound convincing at ideation
   fidelity (two independent DeckEngines, OS-level summing, wall-clock sync)?

## Run

One command from this workspace:

    make proto

(Starts/reuses the backend from the MAIN workspace — the real library DB lives
there, this workspace's `data/` is a stub — runs vite on 5174 (CORS-allowed),
and opens the browser. Backend log: /tmp/manadj-proto-backend.log.)

## Iterations

- v3: timeline became a native scroll container — content width = mix extent
  (nothing past the last track), browser scrollbar as pan control/position
  indicator, zoom floor = fit, cursor-anchored zoom, fit button + auto-fit
  on first load. (v2's free-pan let you scroll everything out of view.)

- v2: replaced ruler + static waveform rows with a DAW-style timeline
  (proportional blocks on a shared zoomable axis; drag B block = move
  transition, trim B left edge = entry, trim A right edge = exit, overlap
  highlight = the Transition; wheel = zoom around cursor, shift/trackpad-X =
  pan). Renderer gained CSS-resize handling in its loop (real-module
  improvement, keeps WebGL context count stable while zooming).

- v4 (after rebasing onto the Engine DJ beatgrid import): beat/downbeat ticks
  render inside both blocks; snap-to-beat toggle (B move snaps the entry onto
  A's grid, B trim snaps onto B's own grid, A trim snaps its exit onto A's
  grid); B's block is time-stretched on the mix axis by its tempo-match rate
  so beats visually align (also fixed the player's arrangement math to advance
  B at its rate — the drift corrector no longer fights the pitch); per-deck
  tweak rows: BPM edit (persisted, beatgrid regenerates), grid nudge ±10ms,
  set-downbeat at the deck's playhead.

- v5: full rendering resolution at all zooms — rows are viewport-sized sticky
  canvases; renderer gained setDisplayWindow (external windowing driven by
  scroll/zoom per frame). Lane strips pinned under their deck's row at the
  transition region (DAW automation style); sticky lane labels; detached lane
  panel removed. Graduation note: geometry still regenerates full-track per
  zoom change — visible-window-only geometry would remove the zoom-notch jank
  on long tracks.

- v6 (transition-editor re-scope, after the grill): top-panel/library shell
  (top 50vh editor over `Library browseOnly` with load→A/B from selection);
  saved Transitions per ordered pair (auto "Transition 1", dropdown +
  create-new, autosave — templates deferred); adopts the shared deck's track
  and pauses it on entry; base » effective BPM per deck.
- v7: global minimap (A-only / split / B-only regions, envelope-transformed:
  fader scales height, EQ lanes fade band colors; transition frame, draggable
  viewport rect, playhead, click-to-seek); info bar reorganized — deck cards
  left/right (title/artist/BPM/pitch/key/grid tools), transition controls
  center (dropdown, play, start/length/entry, tempo match, snap, add-lane).

- v8: scroll-tearing fix — no native scrolling, no scrollbar (minimap viewport
  + wheel are the pan inputs). A plain `scrollPxRef` owns horizontal motion;
  one rAF applies it everywhere in the same frame: content `translateX(-s)`,
  waveform-canvas wrappers counter-`translateX(+s)`, renderer display windows,
  playhead. GlobalMinimap takes a get/set/view-px controller instead of a
  scroller ref. Site-design-language pass partially done (PLAY uses
  `player-button` classes, radii stripped, fit button on vars) — deck-card /
  load buttons / selects still to bring in line.

- v9: wheel-zoom smoothness — wheel events now only accumulate into refs
  (zoom factor × continuous exponential `1.0015^-deltaY`, latest cursor X);
  the rAF tick applies at most one zoom step per frame and `flushSync`es the
  px state so DOM widths, transforms, canvas windows, and scroll offset all
  commit in the same frame (previously the handler mutated scrollPx for the
  NEW zoom while px landed a render later — torn frames read as surprising
  pans; rapid events also read a stale px so zoom didn't accumulate).
  Gesture-axis latch (pan vs zoom, 150ms) stops diagonal trackpad zooms from
  sprinkling pans between steps. LaneCanvas `key={pxPerSec}` remount replaced
  with a `widthPx` draw-effect dependency.

- v10 (graduation slice 01, real-module work in change
  `mix-editor: 01-renderer-driven-draw-windowed-geometry`): renderer
  driven-draw + windowed geometry. `WebGLWaveformRenderer.renderFrame(clock)`
  renders one frame synchronously (`startRenderLoop` is now a wrapper); the
  hook grew `driven: true` + stable `draw()`; the proto tick draws rows A/B
  right after writing transforms/windows — layer order by construction, the
  remaining waveform-shift source. Externally-windowed geometry now covers
  only the visible window ±1 viewport (regen cost constant in zoom, was
  full-track = zoom-gesture jank), built into a preallocated Float32Array;
  waveform GPU upload only on regen (was every frame, ~MBs); beatgrid
  vertices cached keyed on window; separate GL buffers for
  waveform/beatgrid/markers; overlay canvas lookup cached. `?protoperf` logs
  worst tick per second (remove at ride-back). Two follow-up fixes to land
  the feel: exact (1e-9) cache range epsilon for external windows (the 0.1%
  guard reused stale-scale geometry during smooth sub-0.1%/frame zooms —
  drift-and-snap), and `calculatePixelOffset()` moved AFTER the cache
  refresh in `render()` (it read the previous frame's cacheValidation, so
  regenerated geometry drew with a one-frame-stale zoom mapping — a latent
  main-line bug: one mispositioned frame per Player zoom step). Verdict:
  zoom smooth and anchored ("perfect now").

- v11 (stack merge): the mix-editor stack was rebased onto the
  performance-mode head (its agent paused) — one unified lineage now.
  Notable prototype-side consequences: `MixProtoPlayer` runs on its own
  private `Mixer` (single context, channel strips, master limiter — replaces
  two-context OS summing; audio isolation preserved by instance separation);
  DeckEngine lost EQ/filter/volume (Mixer owns them, ADR 0009); the shared
  `rampGain` streamed-automation fix lives in `mixer.ts`; PracticeView and
  the old performance prototype files are gone (real Performance view
  exists). Library gained perf-mode's `onLoadToDeck`/`browseRef` alongside
  our `onBrowseSelect`.

## Real-module fixes made here that MUST ride back to the main line

_(all landed on the unified line via the v11 merge — issue 02 closed;
list kept for history)_

- `graph.ts` `rampGain` (read computed value BEFORE cancelScheduledValues):
  the previous cancel-then-read order froze gains at their old anchor and
  buzzed at 60Hz when setters were called per animation frame (streamed
  automation). Latent in the main line's `setEqValue` since the true-zero-kill
  review fix — masked there only because slider events are sparse.
- `WebGLWaveformRenderer` CSS-resize handling in the render loop (v2) and
  `setDisplayWindow` external windowing (v5) — both generally useful.
- `WaveformMinimap` optional `beatgrid` prop; `api.tracks.update` declares
  `bpm`; `DeckEngine`/`DeckGraph` `setVolume`.

## Verdict

**Graduating** — user call 2026-07-03: "this prototype is for sure going to
graduate to implementation — it's already working pretty well."

Detail still to fill:

- Lane drawing feel:
- Playback conviction (incl. two-context drift, fader/EQ ramp quality):
- Ruler/region drag ergonomics:
- Keep/change model decisions:
