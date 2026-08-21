# g15-lava-lens

Candidate: g15-lava-lens   Kind: novel (fluids/flow lens, VFX-first)
Parents: voyage/g02-voyage-prime (the ABERRATION FLUID — chromatic shear
inside the feedback resampler, "a reeeeealy cool effect"), medium-diversity
law's own suggestion: "liquid metaballs".

Human notes in play: the aberration fluid is the signature family — build
ON feedback-space optics, don't copy the radial split; MEDIUM DIVERSITY
demands a non-dust body.

Falsifiable question: do molten-glass metaballs acting as LENSES over the
feedback field — refracting the previous frame with chromatic dispersion —
extend the beloved aberration-fluid family into a surface-tension body
with real optical presence?

Instruction: a lava-lamp of 8-10 liquid glass blobs (CPU-integrated:
buoyant rise on slow energy, wobble, surface-tension merge via smooth
field union). The fresh background is a slow drifting palette glow (deep,
bounded). Inside the metaball surface the shader REFRACTS u_prev along
the field gradient — three taps at different strengths = chromatic
dispersion, so every blob is a living aberration lens and overlapping
blobs compound refraction frame-over-frame (the trippy engine). |F−1|
rim = meniscus: a thin bright surface-tension line + a specular dot per
blob. Kicks kick the blobs (radial velocity impulse + brief radius pulse
— solid, physical); snare pinches off a small droplet that falls and
merges back. Spectral shape → material: flatness frosts the glass
(noise-jittered refraction = frosted; tonal = crystal), spread widens
dispersion. Section boundary: polarity flip — blobs go from bright-glass-
on-dark to dark-glass-on-bright glow (eased ~1s).

Invariants: feedback contraction — refracted prev is scaled by decay
< 1 and the fresh background is injected at (1 − decay); no sustained
whole-field gain > 1; motion (rise, wobble) on bandsSlow; kick = solid
impulse; photosafe (polarity flip eased, no strobe).

Degrees of freedom (params): blob count/scale, dispersion, rise speed,
persistence.

Assigned tech: bandsSlow (buoyancy), impulse.low/mid (kick punch, droplet
pinch), flatness + spread (material identity — the gen-2 theme), regime
(drop = hot surge in blob glow), ladder tiers (section polarity flip).

Anti-resemblance: no radial aberration split (that is voyage's); no dust
or star scatter; the optics live in discrete liquid BODIES, not the whole
field.

Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/regime/flatness/spread/beat/params/time/dt. Hard
rules: self-contained; GL via createGlRenderer; GLSL ES 1.0, no backticks
in GLSL; chroma-preserving soft knee; bright saturated colors.
File: g15-lava-lens.candidate.ts.
