# g14-gesture — waveform gesture, resurrection: RESPONSIVE first

Candidate: g14-gesture   Kind: novel (clean-room remake; raids
g06-calligraphy — alive at +1 — for the wantsWave plumbing)
Parents: g06-calligraphy (technique donor only: per-channel wave
uniforms, feedback page, soft knee). Fossil g03-scope-ribbon read only
for the autopsy: "not very responsive to music".

## Falsifiable question
Can a waveform preset make its RESPONSIVENESS the identity — every kick,
snare, and hat visibly owning a distinct motion verb on the stroke —
where scope-ribbon buried the wave under clock-driven coil motion?

## Fossil autopsy (what this remake must not repeat)
- scope-ribbon's visible motion was u_time-driven (coil +t·0.6, knot
  fract(t·0.25), depth taper t·0.5); the wave was a ±0.2-screen nudge
  under it. Clock terms are BANNED here: every phase is beat-locked or
  envelope-driven.
- Kick whip fired at a RANDOM position with a small local wiggle. Here
  kicks hit GLOBAL geometry deterministically.
- No trigger alignment: raw wave shimmer averaged out. Here the JS side
  runs scope's rising-edge zero-cross trigger BEFORE downsampling, so the
  trace is phase-stable and its shape reads.

## Concept
One thick luminous stroke — the triggered mono waveform — spans the
screen along a writing axis that jumps on PHRASE boundaries (calligraphy
idiom). The wave IS the geometry at full scale (the dominant element,
not a fine excursion). Motion verbs, one per band:
- **KICK (impulse.low)** → SLAM: the whole stroke's amplitude punches
  ×(1 + 1.8·env) with a ~0.15 s decay envelope, the nib thickens, and a
  shock ring stamps into the feedback page from screen center.
  Deterministic, global, every kick.
- **SNARE (impulse.mid)** → SPLIT: the stroke tears into its L/R stereo
  pair (channels diverge laterally for a ~0.4 s settle) + serrated fray
  on the edges. Stereo reality made percussive.
- **HATS (impulse.high)** → GLINTS: bright specks at the wave's crest
  points (|w| near max), dying in ~0.12 s — localized sizzle, not dust.
- A BPM-locked highlight sweeps along the stroke with beat.phase (the
  meter is visible even in sustained passages).

Feedback page: trails advected ALONG the writing axis (motion-echo of
the gesture), unsharp tap, decay ≤ 0.955, injection ×(1−decay),
chroma-preserving soft knee.

## Null-wave fallback
Without wave data the stroke synthesizes from the spectrum (sum of 3
band-weighted sines) — never blank, still band-responsive.

## Grammar
- PHRASE (`ladderBarIndex ?? barIndex` % 4): axis jump (eased 0.4 s) +
  palette phase step. SECTION (% 16): axis jumps to a fresh diagonal +
  ink bank swap (luminance parity).
- DROP (ride max(drop, energy)): stroke gains a second harmonic echo
  pair (offset copies) + warm bias, held on the plateau. BUILDUP:
  amplitude compresses toward a tense thin line, saturation up,
  never still (micro-vibrato from bands.high keeps it alive).

## Invariants
- No u_time in any motion term (only envelopes, beat.phase, integrators).
- Kick/snare/hat verbs must be visible in isolation (HUD-checkable).
- wantsWave declared; 96 samples/channel via uniform float arrays,
  constant-loop indexed (GLSL ES 1.0).

## Assigned tech
stereo wave (wantsWave — trigger + downsample + JS correlation),
per-band impulses (the three verbs), beat phase/bpm + ladder tiers,
trend split ~0.35 s, bandsSlow (advection drift), centroid (ink
temperature), trackId genome (ink phase + axis walk).

## Params
- `amp` — wave scale (0.5–2, default 1.2)
- `weight` — nib thickness (0.5–2, default 1)
- `trails` — page persistence (0.4–1.6, default 1)
- `slam` — kick punch gain (0.4–2, default 1.2)
