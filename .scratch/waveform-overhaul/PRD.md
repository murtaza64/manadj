# PRD: Waveform pipeline overhaul

Status: ready-for-agent

## Problem Statement

Waveform generation is slow: adding tracks to the Library means waiting minutes-per-track while a serial background worker decodes each file twice, runs six full-signal filter passes, and executes a pure-Python peak loop. The stored result is bulky (multi-MB JSON per Track; the majority of a 4.8 GB database) and bakes the render style into the data — band scaling and the 3-band split are frozen at Analysis time, so any aesthetic experiment requires regenerating the whole Library. The rendered Waveform itself is hard to read: additive band blending washes out into muddy mixes, making beatmatching (transients, kicks) and structure recognition (buildups, vocals, drops, intros/outros) harder than they should be. The renderer also regenerates full-track geometry on every zoom step, which scales memory with zoom × duration and forces an artificial max-zoom guard for long mixes.

## Solution

Replace the pipeline end to end:

- **Analysis** produces style-agnostic **Waveform data** (per ADR 0014): broadband peaks on a fine time grid plus 8 log-spaced band energies on a coarser grid, quantized uint8, in one versioned binary blob per Track — ~1 KB/sec of audio instead of multi-MB JSON.
- **Generation** becomes one streaming pass: ffmpeg-piped PCM consumed blockwise (constant memory for any file length, including 2-hour mixes and m4a/aac files), vectorized peak extraction, one STFT pass pooled into 8 bands — replacing six filter passes and the double decode. Runs on the in-process task system (ADR 0003) with concurrency and per-track progress.
- **Rendering** moves to a texture + fragment-shader architecture: Waveform data uploads to the GPU once; zoom, pan, and scrub are uniform changes with zero geometry regeneration; every aesthetic choice (band grouping, palette, gains, gamma, blend mode) is a shader parameter. Multiple render styles — layered-opaque (rekordbox-3Band-like), additive RGB, dominant-band, spectral-hue — become shader variants over the same data, prototyped visually before one or more ship.

## User Stories

1. As a DJ, I want newly imported Tracks to have Waveforms available in seconds rather than minutes, so that I can play new music right away.
2. As a DJ, I want kicks and transients to read as crisp, distinct columns in the Waveform, so that beatmatching by eye is easy.
3. As a DJ, I want buildups, drops, vocal sections, and intros/outros to be visually distinguishable in the Waveform, so that I can navigate song structure at a glance.
4. As a DJ, I want quiet intros and outros to remain visible rather than rendering near-flat, so that I can cue mix-in points in low-energy passages.
5. As a DJ, I want to try several Waveform render styles and pick what works for me, so that the display fits how I read music.
6. As a DJ, I want zooming and panning the Waveform to be instant at any zoom level, so that the Performance view never stutters mid-mix.
7. As a DJ, I want long files (2-hour mixes) to get Waveforms without the app running out of memory or capping zoom artificially, so that mixes are first-class citizens in the Library.
8. As a DJ, I want my m4a/aac Tracks to get Waveforms just like mp3/wav/flac, so that no part of my Library is second-class.
9. As a DJ, I want the minimap to render from the same data without extra cost, so that full-track overview stays cheap and consistent with the main Waveform.
10. As a DJ, I want to see progress while a Track's Waveform is being generated, so that a blank lane is clearly "in progress" rather than broken.
11. As a DJ, I want Waveform generation to keep up when I import many Tracks at once, so that a batch import doesn't leave the Library half-analyzed for hours.
12. As a DJ, I want the stacked Waveforms in the Performance view and the Transition editor to benefit from the same fast renderer, so that two-deck work is as smooth as single-deck.
13. As a DJ, I want beatgrid markers, Hot Cues, the Main cue, and the playhead to keep working exactly as before on the new renderer, so that the overhaul changes looks and speed, not behavior.
14. As a curator, I want the database to shrink from gigabytes of waveform JSON to megabytes of binary, so that backups and the sync-status queries stay fast.
15. As a curator, I want re-analyzing the whole Library to be a feasible one-off operation, so that future format changes aren't scary.
16. As a developer, I want render aesthetics expressed as shader parameters rather than baked into stored data, so that visual experiments never require regeneration.
17. As a developer, I want the blob format versioned in its header, so that format evolution during prototyping doesn't need schema migrations.
18. As a developer, I want the waveform worker on the shared task system, so that there is one background-work mechanism to operate and observe.
19. As a developer, I want the legacy PNG pipeline and JSON columns gone, so that there is one waveform representation to maintain.
20. As a developer, I want the Main cue stored with the Track rather than on the waveform row, so that performance data and Analysis artifacts stop being entangled.
21. As a developer, I want a prototype page that switches render styles and tunes uniforms live against real Tracks, so that aesthetic decisions are made by looking, not guessing.
22. As a developer, I want generation timing measured on real Tracks during prototyping, so that the speedup claim is verified before backend surgery.

## Implementation Decisions

All per the grilling session of 2026-07-04 and ADR 0014.

**Waveform data format (ADR 0014)**
- One versioned binary blob per Track: header (format version, sample rate, duration, peak hop, band hop, band count, band edge frequencies, quantization gamma) + peak array + band matrix.
- Peaks: broadband max-abs per bin, hop ≈ 128 samples (~2.9 ms). Symmetric (no min/max pair).
- Band energies: 8 bands, log-spaced edges ≈ 20/60/150/400/1000/2500/6000/12000/20000 Hz, RMS amplitude per bin, hop ≈ 512 samples, computed as a fixed pooling matrix over STFT magnitudes (window ~2048).
- Quantization: uint8 with fixed sqrt-gamma (`stored = round(amp^0.5 * 255)`).
- Hops, edges, and gamma are header data, not code constants.
- No stored LOD tiers; no aesthetic scaling baked into stored values.

**Storage and API**
- Blob lives in a BLOB column on the waveforms table (deferred/targeted column loading; the JSON columns are dropped after migration).
- Served by a single endpoint as `application/octet-stream` with immutable caching + ETag; 404 until generated (existing client retry behavior stands).
- `cue_point_time` (Main cue) moves off the waveform row to the Track (or its own table) — Main cue is performance data, not Analysis output.
- PNG generation, the PNG static mount, and PNG files are removed entirely.

**Generation pipeline**
- Single decode path for all formats: ffmpeg subprocess piping f32le mono PCM; startup check that ffmpeg exists with a clear error. (Replaces librosa/audioread.)
- Blockwise streaming compute (~10 s blocks, STFT-window overlap carried between blocks): constant memory for any duration, block count yields progress percentage.
- Peaks via vectorized numpy reshape/max-abs; bands via STFT magnitude passes and pooling matmuls. No Butterworth filtering, no filtfilt, no second decode.
- **Format v2 (multi-resolution) is the shipped spec** (prototyped and adopted 2026-07-04; ADR 0014): per-band-group STFT windows 2048 / 1024 / 256 on the shared hop-512 grid with shared frame centers. v1 (single window) never ships. Prototype-measured throughput: ~500–850× realtime per track. The prototype script is the reference implementation to absorb.
- Worker migrates from the ad-hoc daemon thread to the in-process task system (ADR 0003), concurrency 2, exposing per-track progress if the task system supports it.
- The bulk-populate script is updated to emit the new format (or retired in favor of task-system backfill).

**Rendering** (prototype-validated 2026-07-04; invariants recorded in ADR 0015)
- New texture-based WebGL2 renderer in a dedicated frontend waveform module: peaks and the 8-band matrix upload as tiled data textures once per Track; a fragment shader computes each pixel column. Zoom/pan/scrub/windowing are uniforms — no geometry regeneration, no full-track geometry memory, no max-zoom guard (lift `MAX_ZOOM_FACTOR` with the swap).
- Client builds in-memory LOD pyramids on load. **Channel-true aggregation at every stage**: peaks max-max-max (envelope), bands mean-mean-mean (energy) — including per-column shader loops (hard max for peaks; box-filter mean for bands, which kills zoomed-out beat-rate aliasing). Weighted max and band point-sampling were tried and rejected.
- **Pixel-snapped view origin**: sampling quantized to whole device pixels for frame-stable peak heights while scrolling; overlays (playhead) stay smooth/unsnapped.
- **Waveform style** (glossary term): shader variant + shared typed params `{ gamma, master, gains[3], groupBounds, smooth }`. Built-in registry (winner: additive RGB "B" with tuned defaults — gains 0.7/1.05/1.5, boundaries 3/5 — plus the other proven variants at zero cost); default = B.
- **Two persisted style slots** — `full` and `minimap` — stored in localStorage as one versioned key (matching the codebase's UI-preference pattern). No DB persistence until named user presets become a product feature.
- Built behind the existing renderer-lifecycle hook interface; overlay passes (beatgrid with density culling, Main cue, Hot Cues, playhead, 2D badge/time canvas) ported from the old renderer as-is. The old geometry renderer is deleted once the new one reaches parity (beatgrid, cues, playhead, minimap mode, external display-window mode, drag/zoom + linked visible-seconds zoom, amplitude anchoring for the Transition editor's stacked halves).
- Frontend decodes the blob with a small pure decoder module (bytes → header + typed arrays), straight into GPU-uploadable arrays — no JSON parse.
- The prototype page survives the swap as the dev style-tuning surface, repointed at the production module; it is also the design prototype for a future settings-panel product feature (out of scope here).

**Sequencing**
1. ~~Offline prototype script + throwaway prototype page~~ — done (2026-07-04): format v2 validated, style B selected and tuned, renderer architecture proven, perf measured.
2. Productionize: endpoint + generation module, task-system migration, parity renderer + style system, demolitions (PNG, JSON columns, old renderer), Main cue move, full-library regeneration.

## Testing Decisions

Tests exercise module interfaces with real internals (ADR 0002); no mocking library. Two seams:

- **Backend (primary seam)**: TestClient over the waveforms router on a minimal app with the real generation module — real ffmpeg, real in-memory SQLite (alembic-migrated, per existing conftest conventions). New committed synthetic fixtures alongside the existing silence fixtures: ~2 s tones at known band frequencies (e.g. 50 Hz, 1 kHz, 8 kHz) plus an impulse click, in wav and m4a (the m4a exercises the ffmpeg decode path). Assertions on the decoded blob: header fields correct; tone energy lands in the expected band and not its neighbors; the impulse spikes the peak channel at the expected bin; blob size matches the duration/hops arithmetic. This one seam covers analysis, encoding, persistence, and serving. Prior art: existing router smoke tests and the track-metadata tests that parametrize over audio-format fixtures.
- **Frontend (pure logic)**: vitest unit tests for the blob decoder module, in the style of the existing zoom-math tests. Format agreement is locked by a backend-generated golden blob committed as a fixture.
- **Not automatically tested**: the WebGL renderer and shaders — verified visually via the prototype page, then by use.
- ADR 0002 lists "audio analysis" among fakeable seams; that carve-out targeted heavyweight analyzers. The new pipeline on 2-second fixtures is fast enough to run real, and real is what catches decode/format bugs. The ADR is not amended; this PRD records the interpretation.

## Out of Scope

- Key, BPM, and beatgrid Analysis — untouched.
- Waveform data never transfers via Sync (per glossary); no Export/Import changes.
- The known renderer limitation of honoring only the first tempo change of variable Beatgrids — carried over as-is, not fixed here.
- The perf-diff viewer's separate 2D-canvas renderer — untouched.
- Stored LOD tiers, min/max asymmetric peaks, spectrogram tiers — rejected in ADR 0014.
- Server-side render-style persistence / per-user style preferences — a follow-up once a winning style exists.
- Task-system migration of workers other than the waveform worker.

## Further Notes

- ADR 0014 (`docs/adr/0014-waveform-data-style-agnostic-8-band-blob.md`) records the data-model rationale, the multi-resolution v2 decision, and rejected alternatives. ADR 0015 (`docs/adr/0015-waveform-rendering-data-textures-shader-styles.md`) records the renderer architecture and its deliberately-surprising invariants (channel-true aggregation, pixel-snapped origin). The glossary distinguishes **Waveform data** (stored Analysis artifact), **Waveform** (a rendering of it), and **Waveform style** (a named render recipe).
- Format changes during prototyping are expected; the versioned header plus cheap regeneration make this low-cost. Bump the version byte rather than bending the format.
- A full-Library re-analysis is required at rollout (old JSON → new blobs); the invalidate/populate tooling covers it.
- Open observations carried from the prototype (its NOTES.md is absorbed here): LOD behavior on very long files is untested beyond ~10 min (PRD anticipates 2-hour mixes); sustained-zoom fps on battery/integrated GPUs unmeasured; shader-side spectral flux (12 ms frames) may want a stored onset channel (format v3) if a transient-focused style ever ships as default.
