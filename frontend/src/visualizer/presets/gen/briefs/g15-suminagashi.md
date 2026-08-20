# g15-suminagashi

Candidate: g15-suminagashi   Kind: novel (fluids/flow lens, VFX-first)
Parents: g01-ink-vortex (+3, curl-advected ink), g08-odyssey-ink (thick
billow edges, opaque ink language).

Human notes in play: ink family beloved for "thick advected ink with sharp
billow edges"; MEDIUM DIVERSITY law — never the washy dust; smoke/ink must
keep EDGES.

Falsifiable question: does real paper-marbling grammar — pigments that
DISPLACE instead of mixing (sharp boundaries forever), kick-dropped
concentric ring stacks, bar-boundary comb rakes that feather them — read
as a gorgeous evolving artwork rather than a decaying feedback wash?

Instruction: suminagashi/ebru marbling on black water. The feedback field
IS the pigment surface. (1) Kicks drop a stack of concentric rings at a
slowly wandering point — stamped by MIX toward the pigment color (opaque
displacement, not additive glow), alternating pigment/clear like real
suminagashi. (2) On phrase boundaries (ladderBarIndex) a COMB rakes the
surface: a shear velocity field v_x(y) = A·sin(k·y + φ) (axis alternates
per phrase) drags rings into nonpareil feathering over ~1s, then stops —
the marbling grammar: stamp, rake, admire. (3) An always-on gentle curl
drift (rate on bandsSlow) keeps the surface alive between rakes.
(4) Meniscus gloss: luminance-gradient edges get a thin bright
surface-tension highlight riding highs. (5) Unsharp feedback tap keeps
boundaries razor-sharp through resampling. Snare: small pigment flicks.
Pigment set: 4 committed inks anchored per track (dominantChannel trackId
genome), pigment index advances per drop; hue travels slowly with
centroid.

Invariants: feedback contraction (stamps are bounded mixes; decay < 1);
motion smoothness (rake/drift rates on bandsSlow; comb envelope is an
event decay, not a level); kicks = SOLID ring drops (no powder); photosafe
(no full-field flash); luminance parity across pigment sets.

Degrees of freedom (params): rake strength, ring density, drift, persistence.

Assigned tech: per-band impulses (kick drops, snare flicks), ladder tiers
(phrase-boundary rakes, section = clear-water sweep), dominantChannel
trackId genome (pigment set), centroid (pigment travel), bandsSlow (drift).

Anti-resemblance: no additive glow medium, no radial galaxy layout, no
dust; the image is an opaque marbled SURFACE viewed flat-on.

Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/centroid/beat/decks/params/time/dt. Hard rules:
self-contained; GL via createGlRenderer; GLSL ES 1.0, no backticks in
GLSL; chroma-preserving soft knee; bright saturated colors.
File: g15-suminagashi.candidate.ts.
