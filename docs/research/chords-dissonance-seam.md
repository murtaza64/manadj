# Chords/dissonance sensing: the chroma seam, spiked

Research + spike for #79 ("explore chords/dissonance; the kit's queued chroma-distribution seam + a dissonance/consonance scalar; unblocks Harmonic Reef"). Selected from the backlog game 2026-11-18. Findings below come from reading the actual code and running a synthetic-chord spike; no user audio touched, nothing implemented in the app.

## What already exists (the spike does not start from zero)

- **Offline harmony pipeline** (chord-match #387/#388, landed): `backend/harmony.py` computes per-bar 12-bin chroma (a numpy HPCP port, frame 8192 / hop 4096, stem-informed), finds the drop, folds it into an 8-bar chord loop with a movement scalar; `frontend/src/follow/chordMatch.ts` compares loops by rotation-maxed cosine. This proves manaDJ can extract trustworthy chroma from real tracks, offline, at analysis time.
- **Live viz seams**: `frontend/src/visualizer/bands.ts` and siblings (beat, regime, dominance, centroid/spread/flatness) are pure, tested TS modules shaping the master-bus FFT spectrum the Mixer already publishes; `VisualizerBridge.tsx` broadcasts frames. A chroma seam is exactly one more of these: spectrum in, shaped signal out, no AudioContext, no React.
- **Queued consumers**: the gen briefs already include chroma concepts (g09 materia-chroma, g09 tunnel-chroma); #79 names Harmonic Reef as the target preset family.
- **Prior art**: docs/research/audio-visualizer-prior-art.md (bands seam's grounding); Sethares/Plomp-Levelt roughness for the dissonance side (below).

The gap: all existing chroma is offline per-track analysis. Nothing live senses "how consonant is the mix right now."

## The spike (synthetic, reproducible)

Twelve chords (octave, fifth, maj/min/sus/dim/aug triads, maj7, dom7, tritone and semitone dyads, 3-note cluster), each tone rendered with 6 harmonics, at two root registers (110 Hz and 440 Hz). Two candidate scalars computed from the partial sets. Chart: manadj-79-dissonance-spike.png.

**v1 failed informatively.** Raw Sethares roughness grew with note count (a major triad beat a 3-note chromatic cluster) because more partials means more clashing pairs. And a naive chroma interval-tension scalar saturated near 1.0 on everything: every chord's own overtone series activates the same pitch classes, so every chord looked equally tense.

**v2 mitigates both, on synthetic examples only:**

- *Spectral roughness per partial pair* (count-normalized Sethares): on the synthetic set, octave/fifth/dyads low, triads and sevenths mid, clusters high. Clearly register-sensitive: at 110 Hz a dom7 is roughest; at 440 Hz the semitone cluster is. Same interval, different roughness at different octaves, consistent with the psychoacoustic expectation.
- *Residual chroma tension*: chroma minus the best-fitting maj/min triad template, then interval-tension of what remains, scaled by residual energy. On the synthetic set, near-pure triads land near 0; sevenths, semitone dyads and clusters land high. This aims at "tension beyond the prevailing chord," which is arguably what a DJ cares about mid-mix.

These orderings are plausible behavior on synthetic examples, not perceptual validation. No human listening, no real tracks, no ground-truth dataset was used; treat the chord orderings in the chart as illustrative.

## Findings

1. Dissonance is register-dependent; a chroma-only scalar is blind to it. The live seam should compute roughness from spectrum peaks (register-aware), not from chroma alone.
2. Naive chroma tension is useless (saturates); the residual-after-template version orders correctly and is cheap.
3. Both scalars would want gating: on percussive or silent passages they are meaningless. Proposed gate: tonal energy fraction (harmonic peaks vs broadband), the same spectrum the bands seam already has. This gating is proposed only; the spike never exercises it (all inputs are pure tones).
4. Cost is real but bounded: peak-picking plus pairwise roughness over ~30-60 partials per frame is fine in pure TS; `backend/harmony.py` already shows the harder HPCP path is affordable offline.

## Recommended seam (spec-ready)

One new pure module `frontend/src/visualizer/chroma.ts`, mirroring the bands.ts split (pure tested seam, bridge glue):

- **chroma**: 12-bin pitch-class vector folded from the master-bus FFT magnitudes (log-frequency bin mapping, energy-weighted, the bands seam's tilt + EMA ballistics reused so motion feels identical to existing viz).
- **roughness**: Sethares per-pair roughness over the top ~30 spectral peaks, count-normalized, EMA-shaped, gated by tonal energy fraction (0 when the mix is percussion/silence).
- **tension**: residual chroma tension (best-triad removal + interval-tension table derived from idealized dyad roughness, exactly as spiked).
- Frame additions on `VisualizerFrame`: `chroma: number[12]`, `roughness: number`, `tension: number`, plus `tonal: number` (the gate) so presets can fade harmonic behavior honestly.

Validation plan when built: the spike's synthetic-chord generator becomes the vitest fixture (known chords in, expected orderings out), plus a cross-check that live chroma on a real track's drop agrees with the offline `backend/harmony.py` loop for the same audio (different frame rates, same pitch-class content).

## Not done (explicit)

- Real-track validation: every input was synthesized tones; nothing ran on library audio.
- Perceptual validation: no listening tests, no ground-truth dataset; orderings are illustrative.
- Live performance: no frame-budget or CPU measurement on the real FFT pipeline; the ~30-peak pairwise estimate is arithmetic, not measured.
- Tonal gating: proposed, never exercised.
- No app code was written or changed.

## What this unblocks

- Harmonic Reef and the queued chroma briefs get their signal.
- Later, outside viz: a live "these two decks clash" indicator is the tension scalar applied per deck-pair (master-bus roughness already approximates it during blends); Follow's chord-match (#388) is the offline counterpart. Not part of this ticket, but the seam is the shared foundation.

## Port

Now: the seam is frontend TS consumed by the shared preset runtime, so desktop and Android (which renders the same presets in its bundled WebView viz) get it together. No platform-specific work expected; Android confirms with its own visual pass when presets land.

## Sources

- Code: backend/harmony.py (HPCP offline chroma, MOVEMENT_MIN), backend/routers/harmony.py, frontend/src/follow/chordMatch.ts (#388), frontend/src/visualizer/bands.ts + useVisualizerFeed.ts + VisualizerBridge.tsx (seam architecture), tests/test_harmony.py.
- Issues: #79 (this spike), #387/#388 (chord-match pipeline), #391 (its Android port), #135 (viz gen marathon, viz-presets lane).
- Docs: docs/research/audio-visualizer-prior-art.md, docs/visualizer-ga.md.
- Dissonance model: Sethares, "Tuning, Timbre, Spectrum, Scale" (Plomp-Levelt roughness curve; parameters as implemented in the spike: dissmeasure with s(x)=0.24/(0.0207f+18.96), exp(-3.5x)-exp(-5.75x)).
- Spike: synthetic only (generated tones, 6 harmonics, 12 chords, 2 registers); reproducible scripts (v1 failed variant + v2) and chart attached to the delivery message; no library audio used.
