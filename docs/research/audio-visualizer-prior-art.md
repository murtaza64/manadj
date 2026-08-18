# Prior art: realtime audio bar visualizers (responsiveness)

Sources: cava (`cavacore.c`), audioMotion-analyzer, Rainmeter AudioLevel
(`MeasureAudioLevel.cpp`), Winamp/butterchurn, W3C Web Audio spec §1.8.6.
Gathered for realtime-visualization 01 (v1 bars felt unresponsive).

## Why bars feel dead

1. **FFT window = attack smear.** An AnalyserNode's FFT spans
   `fftSize / sampleRate` seconds: 4096 @ 48 kHz averages ~85 ms of signal —
   a kick's attack is blurred across the whole window. Punch-focused
   visualizers use 1024–2048 (21–43 ms); butterchurn (Winamp port) sets
   `smoothingTimeConstant = 0` and works from time-domain data.
2. **Music has falling spectral tilt** (~-3 to -6 dB/oct, pink-ish). Without
   compensation, bass bars slam while treble bars twitch. Every source
   applies a rising tilt: cava multiplies band EQ by `freq^0.85`
   (~+8.5 dB/decade); audioMotion offers C/468 weighting. Standard fix:
   **+3.5 to +4.5 dB/oct**.
3. **Too-wide dB range kills contrast.** Rainmeter maps a `Sensitivity`
   (~25–35 dB) window to [0,1]: `clamp01(10/S · log10(x) + 1)`; audioMotion
   defaults -85..-25 dB but pairs it with heavy smoothing. Add gamma
   (γ≈0.6, audioMotion `linearBoost` nth-root) to lift quiet detail.

## Ballistics (the consensus pipeline)

- **Attack: instant or near-instant** (cava snaps the peak; Rainmeter
  default FFT attack 300 ms is for meters, not bars — its Peak attack is
  50 ms; recommendation for bars: 8–15 ms).
- **Body release: asymmetric one-pole EMA**, 150–300 ms
  (Rainmeter: `k = exp(ln(0.01) / (fps · T_ms/1000))`;
  `level = target + k·(level - target)`, k chosen attack/decay by
  direction). Feels musical; frame-rate independent when dt-driven.
- **Peak caps: kinematic gravity** (accelerating free-fall, `v += g·dt`),
  after ~400–500 ms hold — Winamp, audioMotion (`g≈3.8k px/s²` ≈ 3.5
  screen-heights/s²), cava (fall ∝ counter²) all agree. Exponential caps
  look floaty; gravity looks physical.

## Log band construction (8+ bars)

- Geometric edges (Rainmeter/cava): `step = log2(fmax/fmin)/N`,
  `edge[i] = fmin · 2^(i·step)`. Enforce ≥1 FFT bin per band.
- Aggregation: area/power integration = stable; max-of-bins = punchier.
- **Monstercat spatial spread** (cava, Rainmeter skins): each bar lifts
  neighbors — `bars[m] = max(bars[m], bars[z] / factor^|z-m|)`,
  factor ≈ 1.5–2 — so a hit reads as a shape, not an isolated spike.

## Vissonance (github.com/tariqksoliman/Vissonance) — visual style

Three.js visualizer with seven presets (Iris, Barred, Fracture, HillFog,
Silk, Siphon, Tricentric). Read for aesthetics rather than DSP:

- **Loudness-driven global hue** (its signature): everything colors from
  `h = 250 − loudness·k` — deep blue quiet → violet → magenta/red loud.
  One coherent color story per frame beats static palettes.
- **Depth**: perspective recession with depth-based brightness fade
  (Iris's cone of spokes, Fracture's scrolling ribbon stack, Tricentric's
  triangle tunnel, Siphon's interior tube).
- **Scene motion ∝ energy**: camera roll / scroll speed rises with
  loudness (`rotation += (avg/8192+1)² − 1`) — the frame breathes.
- **Contrast exponents**: per-bar `pow(v/255, exp)` with exp 5 (bass) → 3
  (treble) — heavy expansion that doubles as spectral tilt.
- **Preset blending prior art**: butterchurn/Milkdrop "morphing" between
  presets is render-both-and-blend over seconds, not parametric morphing.

Applied: `visualizer/style.ts` (`energyOf`, `energyHue`) colors Radial,
Mirror, Waves, Tunnel, Pulse, Trigon, Terrain, Siphon, Fracture, Silk;
ports: Trigon ← Tricentric, Terrain ← HillFog, Fracture ← Fracture
(mirrored floor/ceiling, loudness camera roll, gap closing), Siphon ←
Siphon (tube of spectrum rings, INVERTED loudness breathing,
complementary background), Silk ← Silk (band-driven drift trails, 4-way
mirror; black stage instead of their white), Radial ← Iris
(hub-breathing + outward fade); preset switches cross-morph additively
over 0.8 s (VisualizerApp layer compositor). Band-identity presets
(Bars, Spectrum, LED, Nebula) use the waveform's ADDITIVE_COLORS
red/green/blue as low/mid/high. Plasma is the first WebGL preset
(fullscreen fragment shader on a private GL canvas blitted into its
layer; context-loss parking).

## Applied in manadj (visualizer/bands.ts)

fftSize 2048, analyser smoothing 0; +4.5 dB/oct tilt referenced to 500 Hz
applied per-bin; normalization window -48..-12 dB with γ = 0.6; attack
8 ms / release 160 ms asymmetric EMA; bars presets use gravity peak caps;
8-band preset uses geometric edges 40 Hz → 16 kHz with monstercat spread.
