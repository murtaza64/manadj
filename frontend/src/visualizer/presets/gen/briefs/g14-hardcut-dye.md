# g14-hardcut-dye

Candidate: g14-hardcut-dye   Kind: tweak (dust color dynamism on the hardcut line)
Parents: g09-hardcut-listen (score 3, the "really cool" music-chooses-the-bank
hardcut; engine = g07-voyage-hardcut, 4/0-class winner).

Human notes in play: "this is really cool. i wish the red and blue 'dust' was
a little more dynamic in color (in general for the voyage family)".

Falsifiable question: does making the dust hue actively TRAVEL — a music-rate
hue flow, a spatial tri-tone mask, and kick-ripple re-dyeing — cure the
"red and blue dust" stasis without disturbing the loved quantized grammar?

Instruction: copy g09-hardcut-listen verbatim (six music-chosen banks,
genome-driven structure cuts, anticipation tick, drop-on-boundary slam —
touch NONE of it). Change only the dust/nebula COLOR dynamics:
1. HUE FLOW: replace the near-static t*0.012 disk-phase drift with an
   accumulated u_hueFlow phase whose RATE rides bandsSlow.mid (+ a
   max(drop, energy) kicker) — heavy mids sweep the dust through the bank's
   full hue range in ~8s; quiet passages drift slowly. Rate on slow bands
   only (motion smoothness law).
2. TRI-TONE DUST: a slow spatial fbm mask splits the disk into 2-3
   simultaneous palette slices (+0.33/+0.66 phase offsets) so the disk is
   never a two-color wash — distinct hue regions drift through the arms.
3. RIPPLE RE-DYE: the traveling kick wavefront doesn't just light the dust
   it passes — it re-dyes it (phase shift toward the bank's far slice where
   rippleWave is high). Legible causality: kicks visibly repaint the disk.
4. The high nebula's electric tint counter-flows (-0.6 * hueFlow) so mid
   dust and high wisps visibly diverge in color.

Invariants: bank luminance parity untouched; cut grammar/timing untouched;
feedback contraction (grade cap min(x,0.99)) kept; chroma-preserving soft
knee; no new dust MEDIA (this re-colors the existing disk — dust-fatigue
rule respects existing winners).

Degrees of freedom (params): hue flow rate, dye contrast (tri-tone mask
strength), plus parent's stars/dust/persistence/speed/cutStrength.

Assigned tech: bandsSlow (hue-flow rate), centroid+flatness (bank decision,
inherited), per-band impulses (ripple re-dye), ladder tiers
(`beat.ladderBarIndex ?? beat.barIndex`), trackId genome (structure).

Anti-resemblance: not a new medium (that is g14-voyage-comets' job); no
whole-frame hue rotation (the flow lives in the dust layers, the bass
core/ring identity stays bank-anchored).

Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/centroid/spread/flatness/beat/decks/spectrum/params/
time/dt. Hard rules: self-contained file; GL via createGlRenderer; GLSL ES
1.0, no backticks in GLSL; photosensitivity floor; bright saturated colors.
File: g14-hardcut-dye.candidate.ts.
