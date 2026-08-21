# g15-schlieren

Candidate: g15-schlieren   Kind: novel (feedback-space optics lens)
Parents: g00-voyage (score 9 — the aberration-fluid signature: chromatic
shear inside the feedback resampler, unsharp tap, soft knee) as the OPTICS
prior; no medium inheritance.

Human notes in play: "a reeeeealy cool effect" (the aberration fluid —
build ON feedback-space optics, don't copy the shear); MEDIUM DIVERSITY
(no advected fine-dust); DUST FATIGUE (caustics/shimmer/iridescence are
the approved mid/high vocabularies).

Falsifiable question: can SELF-REFRACTION — the field's own luminance
gradient acting as an index-of-refraction field inside the resample loop —
plus rainbow-schlieren rim rendering (hue = gradient direction, brightness
= gradient magnitude) read as a living thermal-optics instrument rather
than another advected wash?

Instruction: a rainbow schlieren furnace. The feedback field is a hot-gas
density field: buoyant advection (bright = hot = rises, churned by fbm),
and each frame the resample coordinate is BENT along the field's own
luminance gradient (self-lensing — plumes visibly refract everything
behind them). The chromatic split happens ALONG THE GRADIENT (not radius)
— the family signature steered by the field itself. Display adds
knife-edge rainbow rims: hue from atan(grad), brightness from |grad|, so
the flow's OPTICS are the picture. Injections: a bass burner mound at the
bottom (solid response), kick = thermal plume at a genome-hashed bottom
position, snare = side puffs, highs = iridescence gain on the rims (no new
powder). Buildup: rise accelerates + rims cool; drop: burner roars, riding
max(drop, energy).

Invariants: contraction (decay < 1, rim add bounded, grade cap 0.99,
chroma-preserving soft knee); rims gated by field gradient so silence
decays to black; photosafety (plumes/puffs localized, no full-field
flash); motion (rise/churn rates on bandsSlow).

Degrees of freedom (params): rim gain (iridescence), persistence, rise
speed, burner heat.

Assigned tech: per-band impulses, regime (buildup/drop/sustained),
centroid (rim hue bias), bandsSlow, dominantChannel + trackId genome
(hue anchor + plume positions).

Anti-resemblance: not voyage's radial aberration (gradient-steered, no
galaxy/starfield); no dust/powder medium; not materia relief (this renders
GRADIENTS of a fluid, not lit terrain).

Contract: default-export VisualizerPreset; GL via createGlRenderer
(context-loss safe); GLSL ES 1.0, no backticks in GLSL.
File: g15-schlieren.candidate.ts.
