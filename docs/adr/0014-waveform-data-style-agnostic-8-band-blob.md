# Waveform data is a style-agnostic 8-band analysis artifact

Waveform generation is being overhauled (2026-07) for speed and to enable prototyping many render styles. Instead of storing 3 pre-scaled band peaks as JSON (which baked the render style into the data and required regeneration to change looks), we store a style-agnostic superset: broadband max-abs peaks on a fine grid plus 8 log-spaced band energies on a coarser grid, and make every aesthetic choice (band grouping, colors, gain curves, gamma) a render-time shader parameter.

## The format

One versioned binary blob per track, in a BLOB column on the `waveforms` table (served as immutable `application/octet-stream`):

- **Header**: format version, sample rate, duration, peak hop, band hop, band count, band edge frequencies, quantization gamma. Tunables are data, not code.
- **Peaks**: broadband max-abs per bin, hop ≈ 128 samples (~2.9 ms). Fine grid because transient sharpness (kicks, hats) is the point of this channel.
- **Band energies**: 8 bands (edges ~20/60/150/400/1k/2.5k/6k/12k/20k Hz), RMS amplitude per bin, hop ≈ 512 samples (~11.6 ms). Computed as fixed pooling matmuls over STFT magnitude spectrograms — replacing six full-signal `sosfiltfilt` passes with FFT passes.
- **Multi-resolution windows** (v2, prototyped 2026-07-04): per-band-group STFT windows — 2048 for bands 0–1 (20–150 Hz), 1024 for bands 2–4 (150 Hz–2.5 kHz), 256 for bands 5–7 (2.5 kHz+) — all on the shared hop-512 grid with shared frame centers (`f × hop + 1024`), so the blob layout is identical across versions. Rationale: onset edge sharpness in the rendered color equals the window length, and time-frequency uncertainty (Δt·Δf ≳ 1) forbids one window serving both bass measurement (~46 ms minimum) and sharp transient edges (~6 ms). A single window was tried and rejected: symmetric stamping pre-echoes onsets by half a window, and causal (end) stamping merely relocates the ramp without narrowing it. Per-band windows give each band the sharpest edge its physics allows; bass stays soft because bass is soft.
- **Quantization**: uint8 with fixed sqrt-gamma (`stored = round(amp^0.5 × 255)`), spending more codes on quiet material (intros/outros are where structure is read). ~1 KB/sec vs the old multi-MB JSON.

## Why 8 bands with these edges

Any 3-band DJ palette (rekordbox 3Band, additive RGB, dominant-band) is a grouping of *adjacent stored bands*, so the edges must include the classic DJ split points (~150–600 Hz, ~2.5–6 kHz) as boundaries. Vocals concentrate in the 400 Hz–2.5 kHz bands, making structure cues (buildups, vocal sections) directly renderable. 8 packs into two RGBA texels for texture-based rendering.

## Considered and rejected

- **Keep 3 bands**: locks the render style into the data; every palette experiment is a full-library regeneration.
- **Stored LOD tiers / min-max asymmetric peaks / float storage**: all add size to encode things that are render-time choices or invisible at display resolution.
- **Full spectrogram tier**: much bigger; the 8-band pooling covers the render styles we care about.

Changing the format later means regenerating all waveform data — cheap for one library after the pipeline speedup, but the versioned header exists so readers can survive a transition.
