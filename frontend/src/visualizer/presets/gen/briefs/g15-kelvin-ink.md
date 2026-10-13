# g15-kelvin-ink

Candidate: g15-kelvin-ink   Kind: novel (fluids/flow lens, VFX-first)
Parents: g01-ink-vortex (advected ink), voyage (aberration fluid — the
chromatic shear tap, here generalized from radial to flow-space).

Human notes in play: aberration fluid = signature family, build ON it;
ink family loved; smoke/ink must keep EDGES; deck-aware presets are an
under-explored tech axis.

Falsifiable question: does a Kelvin–Helmholtz vortex sheet — two
counter-flowing dye streams whose interface rolls up into billows, with
chromatic aberration sheared along the LOCAL flow direction — produce the
aberration-fluid magic in a directional, deck-owned composition?

Instruction: two horizontal streams fill the frame: the TOP stream flows
right, the BOTTOM flows left, each dyed one color of a committed
per-track duo (dominantChannel trackId genome). Stream speeds ride the
two loudest decks' audible levels (fallback: bandsSlow split) — beatmatch
becomes visible shear. The feedback pass advects along this velocity
field; a chain of CPU-tracked vortices rides the interface, each adding
localized rotation, so the shear layer rolls into growing billows —
strong shear (a drop) winds them into full spirals. Dye is injected as
thin filaments at each stream's inflow edge and a glowing meniscus line
traces the interface. THE SIGNATURE MOVE: the R/B feedback taps split
along the local velocity direction (not radially) with magnitude riding
kick + drop — the aberration fluid flows WITH the streams. Unsharp tap
keeps billow edges crisp. Kicks send a pressure bulge traveling along
the interface that kinks it and LIGHTS the dye it passes; snare = a
sharp dye flick off the nearest billow crest. Section boundary (ladder
%16): the streams REVERSE (eased over ~1.5s) — the whole sheet unwinds
and rewinds the other way.

Invariants: feedback contraction (decay < 1, injections scaled by
1 − decay); motion smoothness (stream speeds on deck levels smoothed
~0.4s + bandsSlow; vortex strength eased); kick = solid bulge; photosafe;
duo palettes luminance-matched.

Degrees of freedom (params): shear gain, billow scale, dye density,
persistence.

Assigned tech: decks (stream ownership — levels drive shear),
dominantChannel trackId genome (duo palette), impulse.low/mid (bulge,
flick), regime/trend (billow wind-up), ladder tiers (section reversal),
bandsSlow (fallback speeds).

Anti-resemblance: no radial/galaxy layout, no central vortex (that is
ink-vortex); composition is a horizontal SHEET; no dust.

Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/regime/beat/decks/dominantChannel/params/time/dt.
Hard rules: self-contained; GL via createGlRenderer; GLSL ES 1.0, no
backticks in GLSL; chroma-preserving soft knee; bright saturated colors.
File: g15-kelvin-ink.candidate.ts.
