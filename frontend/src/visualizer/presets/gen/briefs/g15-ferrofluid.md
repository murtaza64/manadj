# g15-ferrofluid

Candidate: g15-ferrofluid   Kind: novel (fluids/flow lens, VFX-first)
Parents: g03-materia-deep / g05-materia-mercury (material identity, wet
specular rims, spectrum relief, pressure waves that LIGHT what they cross).

Human notes in play: materia family top-scoring ("BEAUTIFUL, i want more
from this direction"); DUST FATIGUE — mid/high vocabularies should be
glints/iridescence, not powder.

Falsifiable question: does a Rosensweig-instability ferrofluid — glossy
BLACK fluid spiking into a hexagonal lattice under bass magnetism, lit by
wet specular + thin-film iridescent rims — deliver the materia material
thrill in a genuinely fluid body?

Instruction: a dark pool of ferrofluid fills the frame. Height field =
hexagonal interference lattice (three 60°-spaced cosines) sharpened into
spikes; spike amplitude = magnetic field strength riding sustained bass
(bandsSlow.low base + impulse.low punch), so a heavy bassline pulls the
whole pool into a spike forest and a breakdown relaxes it to calm glossy
ripples. 24-band spectrum sculpts a radial relief: each ring of spikes is
gained by its band (materia lineage) — the EQ is readable in the spike
heights. Kicks launch a radial pressure wave that LIGHTS and lifts spikes
as it crosses them. Shading is the star: numeric normals, near-black base,
tight blinn-phong specular from a beat-orbiting key light (R/B split
slightly for chromatic fringe on highlights — house aberration nod),
fresnel-gated thin-film iridescence on spike flanks (palette phase =
fresnel + centroid) so every spike wears a neon rim on black. Snare =
brief glint flashes on spike tips (specular, not powder). Section
boundary (ladder): lattice re-orients (rotation snap eased ~1s).

Invariants: no feedback buffer (analytic, contraction-free); motion rates
(lattice drift, light orbit) on bandsSlow/beat only; kick = solid wave;
photosafe (specular is localized; no full-field flash); black-fluid
identity — the pool stays dark, light lives on rims/highlights.

Degrees of freedom (params): spike height, iridescence, light orbit speed,
relief gain.

Assigned tech: 24-band spectrum (relief rings), impulse.low (pressure
wave), bandsSlow.low (magnetism), regime (drop surge / breakdown calm),
beat phase (light orbit), centroid (iridescence phase).

Anti-resemblance: no additive haze, no particles, no galaxy; a single
continuous liquid BODY with physical shading.

Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/regime/centroid/spectrum/beat/params/time/dt. Hard
rules: self-contained; GL via createGlRenderer; GLSL ES 1.0, no backticks
in GLSL; bright saturated colors (on the rims).
File: g15-ferrofluid.candidate.ts.
