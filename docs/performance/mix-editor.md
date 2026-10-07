# Mix Editor Performance

Issue: #259. Measured 2026-09-11. Current surface: `RoutineTimeline`, not the legacy `DawTimeline`.

## Findings

- Pan repainted both waveforms and all six authored automation canvases. Fresh point/guide arrays defeated `LaneCanvas`'s existing overscan cache.
- Stationary slot-panel JSX was rebuilt on every viewport change.
- The CPU waveform interpreter sampled broadband peaks for styles that never use them, applied two exponentiations per amplitude, and repeatedly calculated a finite color palette.
- Idle rendering was already gated. No perpetual waveform repaint loop was found after metadata settled.
- Zoom still requires a full waveform raster and six automation redraws per view update. This pass does **not** achieve the 17 ms p95 frame target.

## Changes

- Waveform rows retain a viewport plus half-viewport pan margins. Translate the existing canvas within those margins; repaint on exhaustion, zoom, height, width, data, style, control or marker changes.
- Overscan is capped by an 8192-device-pixel width budget; no whole-track raster. Zoom paints only the viewport. Fractional-DPR translations reuse only integer device-pixel offsets.
- Metered guides, normalized lane points and slot-panel JSX retain their identities during pan. Gridless guides still update with the viewport.
- Canvas width-only changes no longer reset unchanged automation canvas heights.
- Waveform sampling skips unused peaks, combines gamma exponents and caches coverage palettes for additive RGB, additive screen and layered opaque. Dynamic-color styles retain their color functions.

An offscreen-bitmap copy experiment was rejected: `drawImage` added a bottleneck. The retained implementation translates the displayed canvas directly.

## Browser Measurements

Chromium, 1600 x 1000 CSS pixels, DPR 2. Sandbox saved transition:
`fc79c6f0-6626-45a3-b59a-ecc7df449188`, tracks 9 / 171,
Calling For A Sign -> Last Time. Production build, 90 wheel inputs per phase;
horizontal pan out/back, then cursor-anchored zoom in/out. No CPU profiler during these samples.

| Metric | Baseline | Updated |
| --- | ---: | ---: |
| Idle waveform / automation paints | 0 / 0 | 0 / 0 |
| Pan waveform paints | 136 | 2 |
| Pan automation paints | 408 | 0 |
| Pan frame p50 | 15.9 ms | 8.4 ms |
| Pan frame p95 | 62.3 ms | 19.9 ms |
| Zoom waveform / automation paints | 180 / 540 | 180 / 540 |
| Zoom frame p50 | 26.1 ms | 37.1 ms |
| Zoom frame p95 | 92.0 ms | 65.1 ms |

Wall-clock results varied substantially with host load, even for unchanged baseline runs.
The zoom median did not improve in this pair of runs; do not infer a zoom speedup
from the lower p95. Paint counts and isolated interpreter timings provide the
stronger evidence. Input-to-next-rAF timing is not a display-presentation measurement.

Development-build profiling also showed substantial `jsxDEV` and React property-diff cost.
Its timings are not interchangeable with production measurements.

## Interpreter Measurements

Real waveform for track 9; default style parameters; 1600 columns over a moving
30-second range, synthetic per-column EQ/fader modulation. Median of 40 batches
of five renders after warmup. Excludes Canvas2D painting, React and audio.

| Style | Before | After |
| --- | ---: | ---: |
| additive-rgb | 2.64 ms | 1.02 ms |
| additive-soft | 3.34 ms | 2.64 ms |
| additive-screen | 2.60 ms | 1.42 ms |
| layered-opaque | 3.10 ms | 1.10 ms |
| dominant-band | 1.86 ms | 1.54 ms |
| spectral-hue | 2.46 ms | 1.22 ms |
| transient-flux | 7.28 ms | 2.64 ms |
| additive-ticks | 2.98 ms | 2.40 ms |

All eight styles produced identical CSS colors and segment geometry within 1e-12,
including modulation and brightness changes, against the baseline interpreter.

## Reproduce

From an owned lane with its app running:

```sh
uv run scripts/debug/editor_perf.py --url http://localhost:<vite-port> --profile
uv run scripts/debug/editor_perf.py --url http://localhost:<preview-port> --backend http://localhost:<backend-port> --max-frame-ms 150 --interactions
uv run scripts/debug/editor_waveform_perf.py --url http://localhost:<vite-port> --baseline-url http://localhost:<baseline-vite-port>
```

- Default frame budget is 17 ms and remains failing. `--max-frame-ms 150` is a functional/paint-count smoke gate, **not** a smoothness verdict.
- The default pan budget is four waveform repaints. Baseline fails it; the updated desktop scenario paints twice.
- `--interactions` uses native material drag and undo, asserting waveform invalidation and byte-identical restored canvas pixels. Transition writes are intercepted.
- `--width`, `--dpr`, `--uuid` and `--screenshot` select alternate scenarios. Narrow viewports may exhaust pan margins more often; set `--max-pan-paints` explicitly.
- A production preview must be built with `VITE_API_URL` pointing at the sandbox backend. Use a `localhost` URL, matching backend CORS.

## Verification

- 638 relevant frontend tests passed; one opt-in corpus test skipped.
- Production build passed; existing large-chunk warning remains.
- Ruff passed for both probes. Exactly one Alembic head: `0040_snntw`.
- Native material drag and undo restored identical waveform pixels at desktop DPR 2 and odd-width DPR 1.5.
- 390px viewport loads without page errors, but the existing desktop picker/panel layout leaves insufficient timeline space. Mobile usability is not fixed by this performance pass.

## Remaining Work

- Profile zoom's Canvas2D drawing and automation shading separately on the desktop shell. The interpreter is faster, but full rasterization still exceeds the frame budget.
- Evaluate a shared GPU-backed timeline renderer or reusable waveform geometry before adding more bitmap caches. Avoid one WebGL context per slot.
- Measure playback-follow, routines larger than seven slots, cold-open network/decode latency and high-rate pointer bursts separately.

## Seven-Track Zoom Follow-up

Fixture: `3729f0c6-e0df-4395-87e4-09b30667c7cf`, Runaway Train -> ENERGY (I Feel).
Comparison against the previous performance pass, production builds, Chromium,
1600 x 1000, DPR 2, 90 inputs per phase. Background renderer/timer throttling
disabled in both runs; the probe now fails explicitly if animation frames stop.

| Metric | Previous Pass | Updated |
| --- | ---: | ---: |
| Zoom frame p50 | 58.4 ms | 22.5 ms |
| Zoom frame p95 | 66.9 ms | 25.4 ms |
| Zoom frames over 34 ms | 90 / 90 | 0 / 90 |
| Pan frame p95 | 28.4 ms | 13.1 ms |
| Zoom waveform paints | 630 | 360 |
| Zoom authored-lane paints | 810 | 90 |
| Zoom recorded-strip paints | 1080 | 990 |

- Offscreen rows defer waveform and lane rasters, with a 160px visibility margin. Slot DOM and editing state stay mounted; offscreen jump-marker decorations are omitted.
- Authored lane shading is cached by envelope and color, independent of zoom. Horizontally offscreen segments and nodes skip canvas drawing.
- Recorded strips sample only their own control rather than constructing six-control mixer state per pixel.
- Plateau gradients retain their boundary stops without hundreds of identical interior stops. Collinear plateau path points are omitted; ramp and step geometry is unchanged.
- The playhead no longer reads layout immediately after writing its transform.
- No scaled preview, reduced waveform sampling density, or deferred final-detail pass.

The seven-track desktop case still misses the 17 ms p95 target. At 1001px width /
DPR 1.5, zoom p50/p95 was 16.1/18.5 ms. The two-track regression case was
15.6/17.2 ms. These are input-to-next-rAF timings, not presentation latency.

```sh
uv run scripts/debug/editor_perf.py --url http://localhost:<preview-port> --backend http://localhost:<backend-port> --routine 3729f0c6-e0df-4395-87e4-09b30667c7cf --max-pan-paints 20 --max-frame-ms 35 --scroll-check --interactions
```

Verification: 666 frontend tests passed, one corpus test skipped; build, Ruff and
single Alembic head passed. Browser checks verified last-row repaint after an
offscreen zoom and byte-identical waveform restoration after native drag/undo,
at DPR 2 and odd-width DPR 1.5. The pair-editor regression probe also passed.
