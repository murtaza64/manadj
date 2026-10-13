# Session Timeline Zoom

Probe: `uv run scripts/debug/session_zoom_perf.py --url <lane-url> --require-live`.
For production builds, add `--backend <sandbox-backend-url>`. `--uuid` selects
a Session; otherwise the longest ended Session is used. API writes are intercepted.

## September 12, 2026

Chromium, 1600x1000 viewport, 90 wheel inputs per phase. Timings measure input
to the next animation-frame callback, not display presentation latency.

| Build / Session | DPR | Zoom Median | Zoom p95 | Fresh / Stretched Frames |
|---|---:|---:|---:|---:|
| Original dev / 4h16m, 249 Takes | 2 | 63.4ms | 137.1ms | 0 / 90 |
| Updated production / same Session | 2 | 16.2ms | 29.9ms | 90 / 0 |
| Updated production / same Session | 1.5 | 15.9ms | 31.3ms | 90 / 0 |

Build modes and pinch sensitivity differ between baseline and final runs;
the table is not a controlled speedup ratio. Dense overview frames can still
exceed 50ms. Idle produces no waveform paints.

- Removed zoom bitmap stretching and settle timers.
- Kept bounded canvas/SVG windows; reduced overscan and batched decorative SVG paths.
- Cached per-track waveform interpreters and per-span runs; binary-searched axis/control lookups.
- Drew audibility as one stepped silhouette. Adjacent per-pixel rectangles made
  fractional-DPR rasterization expensive, even after JavaScript had finished.
- Grid weights are relative to the lowest visible metric level and redraw during zoom.
