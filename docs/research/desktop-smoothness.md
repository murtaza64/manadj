# Desktop smoothness (gh#385)

Profiling pass over the desktop waveform and dynamic surfaces, with the Android app as the reference. Probe: `scripts/debug/desktop_smoothness.py`.

## Method

- Headed Chromium on the real GPU. Apple M2 Max, built-in XDR display with 120 Hz rAF, DPR 2, 1600×1000 viewport. Lane dev app (Vite dev, React development build) against a Sandbox DB clone with 1,243 Tracks. Non-GET `/api/**` requests are intercepted, so nothing persists.
- Per scenario, 8 s of steady state:
  - rAF frame intervals (p50/p95/p99, dropped vs the median vsync)
  - long tasks
  - React commits/s and render ms/s, collected by a DevTools-style hook that counts only fibers with PerformedWork
  - CDP main-thread metrics and renderer/GPU process CPU
  - optional V8 CPU profile, Chrome trace with main-thread self-time by event, and GPU timer queries
  - playhead motion: per-frame step error of `getPlayhead` vs `getVisualPlayhead` against the rAF timestamp
- **Caveat: the machine was heavily shared throughout** (load average 15–57: other lanes' ffmpeg, headless Chromium, qemu). A trivial CSS animation on a blank page dropped ~10% of frames, so frame-drop percentages are noisy.
  - Before/after pairs were run back to back against the same lane app, with `jj new main` for the baseline.
  - Conclusions lean on load-insensitive signals: commits, React ms, trace self-time, CPU-profile self-time, and step error.

Run: `uv run scripts/debug/desktop_smoothness.py --url http://localhost:<vite> --scenario perform|library-scroll|session-replay|editor-play [--decks 4 --play] [--trace f.json] [--profile] [--react-detail]`.

## Findings and fixes (landed in this lane, before → after)

| Surface | Hotspot (evidence) | Fix | Before → after |
|---|---|---|---|
| All waveforms | `ctx.currentTime` advances in 128-frame quanta, often several at once. Per-frame playhead steps are 0 / 5.8 / 11.6 ms at a 8.3 ms frame | Visual clock: frame-timestamp extrapolation with a first-order PLL to `currentTime` (`playback/visualClock.ts`, `DeckEngine.getVisualPlayhead` / `visualClock`), used by the strips, minimaps, fader fill and play guides. Transport logic still reads the exact `getPlayhead` | Step error p50 **2.8–3.2 ms → 0.35–0.47 ms** (same run, 2 decks) |
| Perform idle | Infinite `pairlink-pulse` animating `color`/`border-color`: style recalc + paint every frame (trace: Paint 100 ms/s, recalcStyle 95 ms/s, Layerize 54 ms/s) | Opacity-only pulse: a green icon layer plus a ring `::after` (`links/linkPulse.css`). Peak-phase pixels are identical except icon-edge antialiasing | **Combined with the blink-clock fix below.** Idle main thread **36–40% → 3.6–3.8%**, renderer CPU **48% → 19%**, Paint **100 → ~1 ms/s** |
| Every view | MIDI blink clock re-renders the bridge plus 4 publishers at 20 Hz whenever a loaded deck is paused, even with no controller output | Clock only runs while an output is connected | Idle commits **19.4/s → 0.1/s** |
| Library scroll | `.app-main:has(.perf-root.midi-cursor-hidden) :not(…)` makes every row insertion recalc style for about 1.8k elements (35–60 ms each) | Hook puts the class on `.app-main` itself; no `:has()` | Style recalc **1,022 ms → ~60–90 ms per 3–4 s**; zero >500-element recalcs |
| Library scroll | Preview raster `toDataURL` (sync PNG encode, 115 ms/s). After switching to `toBlob` on a GPU canvas, the main thread blocked on readback (`WaitForGetOffset` 105 ms/s). The 128-entry LRU re-rasterized the 1.2k-track library on every pass | CPU-backed canvas (`willReadFrequently`), async `toBlob` → object URL, 4,096-entry LRU with revoke on eviction | (below) |
| Library scroll | Window re-read `scrollTop` during render and per scroll event. Fresh bulk-cue arrays on every window shift | rAF-coalesced viewport read; the store snapshot is the row window `{start,end}`; per-track cue arrays reused when unchanged | Gentle scroll (6 px/frame): p50 **16.0–16.6 → 9.0 ms**, p95 **100–109 → 50 ms**, long tasks/8 s **33–43 → 19**. Stress (24 px/frame): p50 **34–50 → 25–34 ms** |
| Session replay | `setReplayT` every rAF re-renders the whole 2,600-line `SessionTimelineView` (620 ms/s React render on a 4 h Session) | Replay head moved by a transform from the rAF loop; React state flips only on start/stop; follow-scroll runs in the loop | p50 **25 → 9 ms**, p95 **110 → 19–23 ms**, main **100% → 35%**, commits **25.5 → 2/s**, React render **620 → 0.2 ms/s** |
| Routine editor | Unconditional rAF loops (beat readout `textContent` written every frame, playhead), also while the keep-alive view is hidden. Playhead not on its own layer | Loops gated on `viewActive`; readout writes only on change; `will-change: transform` on `.rt-playhead` | Playing: Paint **105 → 49 ms/s**, HitTest **53 → 23 ms/s**; hidden view does zero per-frame work |
| Perform playing | Renderer CPU: `getUniformLocation` 13 ms/s plus `uniform1iv` allocations; fader fill makes ~W/2 `fillRect` calls per deck per frame (34 ms/s) | Cached uniform locations and scratch LOD arrays; fader fill as one path + one `fill()` (top-edge antialiasing alpha within ±4/255) | `renderFrame` self **39 → 13–15 ms/s**, `getUniformLocation` **13 → 0**, fill **34 → 14 ms/s** |
| Perform playing, 4 decks | Overall (A/B back to back, same load) | All of the above | Frame p50 **16.4–16.7 ms (60 Hz) → 8.4–8.5 ms (120 Hz)**, p95 **66–76 → 42–49 ms** (17–23 ms in lighter-load runs) |

Behaviour: vitest suites for every touched area pass and tsc is clean.
- Waveform renderer output is unchanged: uniform caching only.
- The pulse and fader fill are pixel-equivalent apart from antialiasing alpha on edge pixels.
- The visual playhead is within ~1 quantum of `currentTime`.

## Negative result: column-cache shader

- Prototype: a two-pass body. Per-column aggregation goes to a W×2 RGBA32F target (row per lobe), then a per-pixel style pass.
- Output matched within ≤1 LSB on a handful of pixels.
- In-page throughput benchmark (40 frames × 6 rounds, interleaved): **no gain**, 0.2–0.3 ms/frame per renderer either way. The M2 Max shades a 3,200×104 strip trivially.
- An earlier GPU-timer reading of 0.88 ms/strip was contention from other GPU clients, not shader cost.
- Discarded. Per-pixel aggregation is not the Performance-view bottleneck on this hardware.

## Remaining candidates (ranked by gain / effort)

1. **Perform compositing surfaces (M–L).** Under load, 4 decks playing still drop 16–43% of frames, and the GPU process runs at 70–88% CPU. Per row and per frame, the GL strip, the 2D text overlay and the fader-fill canvas all change, and the minimap GL canvas changes as well: about 16 canvas surfaces swap every frame.
   - Fold the time readout, hot-cue numbers and fader fill into the GL pass (one surface per strip).
   - Or use one shared WebGL canvas with scissored viewports for all strips, which also stays clear of the ~16-context cap.
   - Measure on a quiet machine first.
2. **Production build as the daily driver (S, workflow).** Library stress scroll p50: dev 25–34 ms vs production build 15–16 ms. React 19 dev JSX (owner stacks) dominates JS self-time. `make dev` / lane apps are dev builds.
3. **Session timeline follow-scroll when zoomed (M).** While the head pins at the 80% edge, `setScrollX` fires every frame and the whole view re-renders. Windowing is already quantized to 100 px; the sticky labels are what need exact `scrollX`. Move them to CSS sticky or an imperative update and quantize the state.
4. **`useAutomationGhost` (S–M, unmeasured).** It calls setState every frame during Conductor or Session replay automation, re-renders `DeckWaveform`/`MixZone` ×4, and is not view-gated. Expose the held flag as a boolean store and read the ghost value imperatively in the fader paint.
5. **Routine editor paint layerization (M).** `PaintArtifactCompositor::Update` costs about 200 ms/s while playing. Find which layer repaints per frame (lane canvases or ruler).
6. **Visualizer window in the app's renderer process (S–M).** `window.open` keeps the opener, so the visualizer's rAF/GL work shares the deck main thread. Use a separate BrowserWindow or `noopener` so it gets its own process.
7. **Visual output-latency compensation (S, behaviour change).** The built-in output reports `outputLatency` 32 ms, so visuals lead sound by about 30 ms. The visual clock is the seam: subtract the latency there. Pair with the latency calibration being designed for Android (#382).
8. **Small items.**
   - TrackList header re-renders on every row-window shift (~13 `ColumnResizeHandle` per commit); memoize it.
   - `OverviewLadder` writes `left` and then reads layout every frame while conducting (forced layout); switch to a transform and read first.

Electron: `backgroundThrottling: false` is already set. No GPU flag changes are indicated by the traces.
