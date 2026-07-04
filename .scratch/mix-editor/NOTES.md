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
  waveform/beatgrid/markers; overlay canvas lookup cached. `?protoperf`
  logged worst tick per second (stripped 2026-07-03 after 08/10 verified).
  Two follow-up fixes to land
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

- v12 (issue 06): persistent TopBar (new `components/TopBar.tsx` + CSS) with
  logo, Library/Performance/Transition-editor mode switch, and Sync — App
  gained an `app-shell` column and the `transition` view; `?proto=mix` now
  just opens that mode. Sidebar logo/sync/▸ header removed; PerformanceView
  lost its floating back button and `onClose`; 100vh/50vh layouts became
  100%/50% under the bar. Editor load mechanics unified with Performance:
  embedded Library gets `onLoadToDeck` (hover A/B buttons, dblclick → A) +
  `browseRef`; ↑↓ navigate, ←/→ load A/B, Enter → A (SELECT-focused events
  left alone); header load→A/B buttons and `onBrowseSelect` removed
  (Library prop deleted too).

- v13 (issue 07): loaded tracks persist across refreshes and mode switches.
  DeckProvider persists the shared decks' loaded ids
  (`manadj-loaded-tracks`) and restores them on boot (fetch + Load, paused;
  StrictMode-guarded; all-null boot state never written; a Load that lands
  during the restore fetch wins). Editor `assignTrack` mirrors onto the
  shared decks (id-guarded, via ref so identity stays stable), making them
  the canonical pair; editor adoption on entry now prefers shared decks per
  slot → saved last-pair → default pair.

- v14 (issue 09): TopBar now carries the section identity — icon mode switch
  (≡ ▸ ⋈) + active section title; the editor's own header (h1 + help text)
  deleted. Deck cards gained "track ◀ ▶" nudge buttons (±10ms relative
  alignment: B shifts startSec with the frame, bMove-style; A is the mix
  anchor so its nudge shifts frame+B the opposite way). Shift-drag
  suspends beat snap on all three drag kinds (bMove/bTrim/aTrim).
- Issue 08 root-caused via the protoperf log: the mix timeline ran on wall
  time while deck playheads ran on ctx time; two live AudioContexts (issue
  07's mirrored loads spin up the shared Mixer) made the clocks stutter
  against each other and the drift corrector re-seeked audibly every few
  hundred ms. Fix: MixProtoPlayer's timeline anchors to its own Mixer's
  audio clock (`Mixer.now()` — REAL-MODULE pattern worth keeping), and the
  editor suspends the shared Mixer's context while mounted
  (`Mixer.suspend()/resume()`). Corrector kept as safety net;
  instrumentation kept until verified on the bad pair.

- v15 (issue 10): playback-start visual jitter in editor + Performance —
  library-mode's old disease (main-thread style/layout/React work stalling
  the render loops). Fixes: editor's embedded Library is a memoized element
  (whole-tree emit re-renders no longer re-diff the table); mix playhead
  driven by `transform` instead of per-frame `style.left` (layout-property
  writes recalc layout across the whole document); PerformanceView's deck-
  lock booleans moved into a self-subscribing `LockDimmedLibrary` wrapper
  (play/pause no longer re-renders the view); `DeckEngine.setRateComponents`
  no-ops without emit when pitch/bend unchanged (lane drags had spammed
  emit → full editor re-render per event). Escalation if still jittery:
  narrow the editor's whole-tree emit bump into per-widget subscriptions.

- v16 (issue 05 rework + 04): breakpoints redrawn per user feedback —
  uniform size, centered on their true curve position (the clamped-offset
  version misaligned circle vs click target); value readout hover-only; the
  lane canvas overhangs the window by `LANE_PAD` so edge circles float over
  the borders (pointer events live on a hit div that matches the lane rect,
  overhanging sides-only so stacked strips don't steal each other's clicks).
  Filter lanes magnet y to 0.5; breakpoint x magnets loosely (6px) to beat
  guides; crop is now the DEFAULT trim semantics (alt = stretch); both
  transition edges grabbable from either row. Cut tools (issue 04):
  `insertChop` pure stamp in mixProtoModel (4 points, near-vertical walls
  to 0, interior points removed — under vitest; walls fixed-TIME 20ms via
  prop — user-tuned from 10 — not duration-proportional), shift+drag on a
  lane chops with a live preview, shift+click cuts one beat. Cut edges snap
  to the beat lines; each WALL is centered on its line (cut-out opens
  wall/2 before the beat — user-corrected twice: on-the-beat edges, then
  midpoint-snapped edges, were both wrong; beats align, walls straddle);
  culled guides ⇒ interval may be >1 true beat at low zoom — acceptable.
  A "cut" button collapses the
  Transition to zero length on A's nearest beat (model already hard-swaps).
  Modifier tension resolved: shift on a breakpoint = fine drag; shift on
  empty lane = chop.

- v17 (issue 11): deck slides groundwork + deck B controls. Model hygiene:
  `bInSec` moved INTO `ProtoTransition` (pair knowledge rides the named
  artifact; localStorage pair-store migrated on load, legacy sibling field
  folded in and deleted). Negative entry anchor first-class: `bInSec < 0`
  = silent lead gap — `arrangementAt` keeps B inactive until `bTrackTime ≥
  0` (the player's deferral falls out of that one predicate), the B block
  frame draws from the true audio start, `startSec ≥ 0` stays the only
  clamp (B-entry input accepts negatives). Pure slide math in
  mixProtoModel (`slideB`, `slideBToCue`, `bTrackTimeAt`) under vitest:
  unlocked mutates `bInSec`, locked mutates `startSec` (÷rateB), cue
  slides land exactly (the startSec clamp is the one exactness breaker).
  UI: "locked window" toggle beside snap; deck B card gains a slide row —
  Performance beatjump idiom (◄◄ − [n] + ►►, halve/double 1–128, B's own
  beats via base BPM) + one button per hot cue (slide so the cue lands
  under the playhead). Slides push the new mix into the player
  synchronously and re-park paused decks (`seek(playhead)`); playing decks
  re-cue via the soft-sync drift path — A never hiccups, the playhead's
  mix position never moves. Deck A's mirrored controls are issue 12.
  bMove drag respects the lock too (user follow-up): locked = window rides
  B (startSec, the old behavior); unlocked = B's content slides under a
  fixed window (bInSec only; snap puts a B beat on the window start, or —
  in the lead-gap regime — B's audio start on A's grid).

- v18 (issue 12, re-grilled): deck A's controls are TRANSPORT, not
  mirror-slides — user re-opened the quadrant table mid-build: mirror-A
  added no expressive power (unlocked-A ≡ locked-B, locked-A ≡ unlocked-B)
  and "move everything else" needed re-explaining every session. New
  split: one deck slides (B), one deck is the axis you navigate (A ≡ mix
  time via the sketch origin). A hot cue = `player.seek(cueTime)`; A beat
  jump = seek ±n·60/bpmA, phase-preserving; plain-seek semantics playing
  or paused (both decks re-cue, same as a timeline click); the lock
  toggle scopes to B gestures only. Double-drop is now two comprehensible
  gestures: A drop cue (jump) → B drop cue unlocked (align). DeckCard's
  `slides` prop generalized to `gestures {kind: 'slide'|'jump'}` — one
  row idiom, per-kind labels/tooltips. `slideA` model math reverted
  before it shipped; PRD quadrant table + glossary (Slide, Locked window)
  updated to the B-scoped semantics. Cue row shows all 8 slots
  (Performance pad semantics: empty = set at this deck's playhead,
  dashed style; right-click deletes) and always reads 1-8 left-to-right —
  deck B's mirrored card layout is overridden for the gesture row.

- v19 (issues 15/17/19, design pass): `user-select: none` on the editor
  surface (inputs/titles opt back in) — stray lane drags no longer
  highlight labels. Live selects + number inputs restyled to the site
  control idiom (transparent, 1px border, bold, square; native chrome +
  spinners suppressed, drawn select caret, sapphire focus ring); dead CSS
  swept (.mixproto-play/-picker*/-body/-deckrow/-controls*/-lanes old
  layout). Deck-card clusters became segmented pairs: `track ‹◀|▶›`,
  `grid ‹◀|▶›`, and the slide/jump gesture row all share the
  `.mixproto-pair` one-border grouping (label as prefix segment, step in
  tooltip); uniform 22px control height; downbeat button weighted yellow
  as a distinct action. Screenshot round with the user pending.

- v20 (issue 13): stacked half-waveforms. Renderer gains
  `amplitudeAnchor: 'center'|'top'|'bottom'` (config-only, construction
  like brightness; minimap branch untouched; every non-editor surface
  stays `center` by default) — edge anchors draw double-amplitude halves
  growing from the baseline edge. Editor restacked: A lanes / A wave
  (anchor top, peaks down) / seam / B wave (anchor bottom, peaks up) /
  B lanes; rows flush (border between them removed — the seam IS the
  meeting line), transition highlight + playhead span the stack. Lane
  editing untouched by the relocation (strips are self-contained).

- v21 (issue 14): marker readability. Renderer: hot cue triangles
  (10 CSS px fixed, cue-colored) at the baseline edge pointing toward the
  seam on edge-anchored rows only ('center' surfaces untouched); downbeat
  thinning — once weak beats are density-culled, downbeats drop to 1px @
  0.15 alpha (they're the only lines left), full weight returns on zoom-in.
  Editor: DOM playhead 3px → 1.5px (matches the renderer playhead's
  apparent width at DPR 2). GlobalMinimap: per-track hot cue triangles
  (A top edge / B bottom edge, cue colors, hotCues props added) and the
  transition window is now a translucent pink tint instead of a bordered
  box. Row height halved (56→28px min, 8→4vh) — polarized halves carry
  the same information in half the space (user call); the freed space
  went to the lane strips (26→30px min, 3.6→4vh — first cut at 6vh pushed
  the controls out of the top panel; budget is 6 strips + 2 waves within
  ~32vh), and filterA/filterB joined the default lane set (six strips
  standard). Inaudible waveform spans (A past the transition end, B's
  drawn head before the window start) grey out via a backdrop-filter
  overlay in content coordinates.

- v22 (user iterations): envelope preview on the main rows — renderer
  `setModulation((trackTime) => {gain, low, mid, high})` scales bar
  heights by the fader lane and band colors by the EQ lanes inside
  `generateGeometry` (minimap parity: a bass kill visibly removes red);
  editor feeds `laneValuesAt` through it per row (B via the tempo-stretch
  mapping), re-applied on model change (windowed regen = zoom-frame
  budget). All lanes removable now, defaults included: × hides (envelope
  KEPT in `lanes`, restored on re-add via the add-lane dropdown); hidden
  lanes read as their default during playback (`hiddenLanes` on the
  Transition — an invisible bass-kill must not duck the mix). Inaudible
  waveform spans grey out (backdrop-filter overlays: A past transition
  end, B's drawn head before the window). Timeline height is FIXED
  (max(280px, 34vh)): waveform rows flex-fixed, lane strips flex-share
  the rest — add/remove redistributes instead of growing the stack;
  LaneCanvas got a ResizeObserver redraw (flexing strips resize sibling
  canvases without any React dep changing). Default envelopes redesigned
  (user call): flat single-point shapes — faderA full, EQs/filters 0.5 —
  and faderB ramps 0→full over the first 2 SECONDS of the window
  (`defaultLanePoints`/`lanePoints` now take `durationSec` for the
  normalized x; windows ≤2s ramp across their whole length). The old
  defaults (A ramp-down / B full-length ramp-up) implied a full crossfade
  nobody asked for. "reset" button restores the default transition; the
  zero-length "cut" button removed (design revisit noted in issue 04).
  Value axis inset 6px inside the lane rect (`LANE_VPAD`): y=0/1
  breakpoints no longer sit ON the strip boundary (bottom-edge grabs
  fought the adjacent strip's hit zone), draw + pointer mappings share
  the inset.

- v23 (user batch): locked-window moved onto deck B's card as a pressed-
  state `lock` button (it scopes to B gestures; checkbox removed from
  center controls). Clicking B's block without dragging now seeks (drag
  handlers gained a 4px move threshold — micro-wobbles no longer mutate
  the model either). Hot cue number badges now render on BOTH rows: the
  overlay canvas was reused via a document-wide id lookup, so the two
  id-less row canvases shared one overlay and fought (parent-scoped class
  lookup now; dispose removes only its own overlay — REAL-MODULE fix);
  badges sit at the baseline (outer) edge on anchored rows. Deck mute
  buttons (player `setMuted` overrides the fader lane inside applyLanes —
  a one-shot fader write would be re-overwritten per tick). Minimap moved
  below the timeline, above the controls.

- v24 (regression hunt: "everything sluggish, even the library"): two
  self-inflicted wounds from v22. (1) The inaudible-span overlays used
  `backdrop-filter` — the row canvases repaint every rAF tick, so the
  compositor re-ran grayscale+brightness passes over large regions EVERY
  frame, degrading the whole app; replaced with a plain translucent
  overlay (lesson: never park a backdrop-filter over an animating
  canvas). (2) The envelope-modulation callback ran `laneValuesAt` (all
  10 lanes) and allocated a result object per pixel column — ~10k+
  calls/frame during zoom regens; now evaluates only the row's 4 lanes
  via a direct evalLane helper and mutates one reused object per row.
  Round 2 (still sluggish): modulation is now a 2048-sample Float32Array
  LUT built once per model change — the per-column callback is a clamped
  index (evalLane fell off the hot path entirely); and the LaneCanvas
  ResizeObserver reacts to HEIGHT only — zoom changes lane widths every
  frame, and the observer was scheduling a second React commit + a
  duplicate redraw of all six lanes per zoom frame (the `widthPx` draw
  dep already handles widths). Escalation if zoom still lags: move
  modulation into the vertex shader (LUT as a texture) — named, not
  built. Round 3 (scroll jitter over the window): lane canvases span the
  whole window — at 240px/s a 35s window = 16.8k buffer px, PAST the 16k
  GPU canvas limit, and 6 taller strips ≈ 10× yesterday's moving-layer
  area; bitmap now capped at 8192 buffer px (effective DPR shrinks past
  that — flat line art degrades gracefully). Also the editor rows' badge
  overlays were DOUBLE-sized (style.width copied from a CSS-sized
  canvas's empty style → bitmap-size fallback at 2×): overlay now sized
  from clientWidth — REAL-MODULE fix, also corrects badge positions.
  Round 4 (still hitching as the window entered/left the frame): the
  named escalation got built — lane canvases are now VIEWPORT-WINDOWED:
  each covers only the visible slice of its window + half-viewport
  margins, positioned inline within the lane window; scrolling inside
  the margin is pure layer translation, exiting it repositions+redraws
  imperatively (the rAF tick feeds every lane the visible range via a
  registry; React redraw effect and scroll redraw share one draw closure
  through refs). Pointer math untouched (the hit div still spans the
  full window). Bitmaps are now ≤ ~2 viewports regardless of zoom.

- v25 (deep perf pass, production-bound): (1) autosave DEBOUNCED 300ms —
  it stringified the whole pair store into localStorage at drag rate
  (biggest drag-path cost); pending edits flush before transition
  switch/create and on unmount (a late flush would write the old mix into
  the newly-active slot). (2) Beatgrid vertices now live in GEOMETRY
  space and ride u_pixelOffset like the waveform — scrolling stopped
  rebuilding+uploading them every frame (cache keys on extent+zoom, not
  scroll position; REAL-MODULE fix, benefits the library player too).
  (3) generateGeometry reuses a persistent scratch Float32Array (fresh
  multi-MB allocs per zoom frame were GC churn — the NOTES claim from
  slice 01 had regressed). (4) The rAF tick is dirty-keyed (scroll, zoom,
  mix time, durations, viewport, model version): an idle editor skips
  every transform write and both WebGL passes. (5) Default-lane point
  identities memoized (fresh arrays per render redrew every undrawn lane
  canvas on any model edit). (6) Modulation LUTs keyed on lane shapes
  only — window moves/slides skip the 8k-evalLane rebuild. (7) Guide
  memos binary-search the window slice instead of scanning all beats per
  zoom frame. (8) beatXs memoized; (9) redundant structuredClones dropped
  from trim drags. TEMP ?protoperf worst-tick readout re-added — strip
  after verification.

- v26 (file split, production-bound structure): the 2300-line
  MixEditorProto.tsx became modules — `pairStore.ts` (persistence +
  migrations; the DB-graduation seam), `DawTimeline.tsx` (rows, lanes
  layout, drags, guides, the rAF tick), `LaneCanvas.tsx` (breakpoint
  editor), `laneColors.ts`, `DeckCard.tsx`, `GlobalMinimap.tsx`, with
  MixEditorProto.tsx as the ~570-line shell (state, persistence glue,
  controls, keyboard, library). Pure moves — no behavior change; the
  planned player `parkDecks` extraction turned out moot (its duplicate
  died with the mirror-slide revert).

- v27 (transition-library 01): Transition switcher + lazy persistence.
  pairStore gained the materialization rules as pure fns under vitest —
  `isPristine` is VALUE-based (default shape + default name + never
  favorited), so exactly-reverted edits evaporate too and the same
  predicate prunes legacy pristine saves on load. The editor now works on
  a SESSION list (may contain in-memory pristine items); the debounced
  persist writes `toStoredEntry` (pristine filtered, active remapped,
  all-pristine pairs deleted) — merely-opened pairs leave zero trace.
  Dropdown replaced by `TransitionSwitcher` (◀ name ★ 2/3 ▶/+): inline
  rename, favorite star (`favorite` on SavedTransition — Preferred pair
  stays derived), two-step inline delete (replaces the reset button;
  last-one deletion re-inits blank, else lands on next); leaving a
  pristine take discards it silently; ▶ past the end is a no-op when the
  current take is already fresh.

- v28 (transition-library 02): discovery surfaced in the library.
  `transitionIndex.ts`: direction-aware `transitionsFrom/Into` over the
  pair store (in-memory rebuild; honest by construction — only
  materialized Transitions exist in storage), `useTransitionIndex` hook
  fed by new pairStore save events (`subscribePairStore`, notified with
  the store so no re-parse). Library rows get per-source-deck marks in
  the title cell (◆ in the deck accent color, ★ when the pair is
  Preferred — strings through the memoized rows). Filter bar gains the
  "◆ transitions" toggle: `hasTransitionFromDecks` is a first-class
  FilterState axis composed CLIENT-side over the server-filtered list
  (transition knowledge lives in localStorage); Find Related now
  preserves the axis when applying, Clear All resets via DEFAULT_FILTERS
  (also de-triplicated its predicate). Index correctness under vitest
  (direction, Preferred derivation, counts). Note: favorite→star updates
  ride the 300ms debounced save — near-live.

- v29 (transition-library 03): discovery unified. "Find Related" is now
  "Find Compatible" (user-facing strings only; internal keys/filenames
  unchanged). Loaded-deck reference model: the modal gets A/B buttons
  (track titles, empty deck disabled), the selection-based reference is
  retired, the whole feature disables with nothing loaded, and
  `refDeck` persists with the settings so the quick-apply arrow reuses
  the last deck. The modal's "has transition" switch binds to the SAME
  `hasTransitionFromDecks` filter state as the filter-bar toggle (one
  source of truth, two controls — the switch applies live, not on
  Apply). Composition rules from 02 hold: applying writes only the four
  heuristic criteria, Clear All clears both axes. Settings loads merge
  over defaults (pre-refDeck saves).

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

## Graduation (2026-07-04) — this log is now an archive

The editor graduated to production in the post-consolidation change: code
moved to `frontend/src/editor/` under production names (TransitionEditor,
MixPlayer, mixModel, EditorMix/Transition, editor-* CSS; ADR 0010
Amendment 3 records the full rename map + kept affordances). This NOTES
file moved from `frontend/src/prototype/NOTES.md` to the tracker and stops
accumulating; future work is ordinary issue-tracked development. The
"real-module fixes" list above was honored by the 2026-07-04 merge (all
rode in with the stack).
