# g14-voyage-comets

Candidate: g14-voyage-comets   Kind: tweak, wilder (medium replacement on the
champion engine)
Parents: g00-voyage (score 9, the champion: black-hole skeleton — charged
horizon ring, localized lens, traveling kick ripple, differential-rotation
feedback, soft knee).

Human notes in play: MEDIUM DIVERSITY ("voyage/odyssey descendants keep
inheriting the same advected fine-dust feedback medium... a wash. New
variants must REPLACE the mass/dust technique, not restyle it: ... light-
trail comets"), DUST FATIGUE (no new dust media), celestial appetite
(nebula/celestial imagery wanted).

Falsifiable question: does a DISCRETE comet swarm on real orbits — light-
trail medium from the approved replacement list — give the voyage family a
mid/high vocabulary that reads as individuals with physics instead of an
advected wash?

Instruction: keep voyage's SOLID bass identity verbatim (coal heart,
charged horizon ring, localized black-hole lens, traveling kick ripple,
kick shockwave). DELETE the entire dust medium: no spiral-lane clouds, no
fbm dust, no high-nebula wisps, no star powder. The mid/high medium is a
20-COMET SWARM orbiting the black hole:
- Orbits integrated JS-side (elliptical, Kepler-flavored: inner comets
  orbit faster), positions/brightness fed as uniform float arrays. Angular
  speed accumulates from a rate riding bandsSlow + max(drop, energy) —
  never instantaneous bands (motion smoothness law).
- Three FAMILIES with committed, distinct palette identities (anti
  blue-wash): 8 MID comets — copper/gold heads, brightness rides bands.mid;
  8 HIGH comets — small fast teal-white inner sparks, brightness rides
  bands.high; 4 GIANTS — violet-white long-period, faint until drops
  ignite them. EQ kill = that family dims out.
- Each head draws an anti-sunward ion tail spike; the feedback's
  differential rotation smears heads into true curved light trails.
- KICK: the ripple wavefront shoves comets outward as it passes (radial
  bump, ~1.2s decay) and the horizon ring does the solid work. SNARE: the
  comet nearest the core FLARES white and sheds a brief fragment.
  BUILDUP: orbits contract inward, heads cool. DROP: orbital rates lift,
  heads incandesce, giants light up — riding max(drop, energy).
- SECTION boundary (`beat.ladderBarIndex ?? beat.barIndex`, 16 bars):
  orbit geometry re-seeds from the trackId genome (new ellipse tilts/
  eccentricities — a quantized scene change). Phrase boundary: precession
  direction flips. Same song = same orbit story.

Invariants: feedback contraction (decay < 1, grade capped); chroma-
preserving soft knee; comets are DISCRETE and countable (~20, readable
individuals, never a powder); photosensitivity floor (kick lift is the
parent's transient ≤1.1× envelope; flares are localized).

Degrees of freedom (params): comet count scale, trail persistence, orbit
speed, palette identity is FIXED (committed scheme).

Assigned tech: bandsSlow (orbital rates), per-band impulses (kick shove /
snare flare), trend drop-buildup split (contract/ignite), ladder tiers +
trackId genome (section re-seed), deck state (dominant deck).

Anti-resemblance: not g06/g07-orrery (bands as nested mechanism rings —
these are free elliptical orbiters around the voyage black hole); not
g08-voyage-flock (flocking, dead) — orbits, not boids; no dust/powder.

Contract: default-export VisualizerPreset; GL via createGlRenderer
(context-loss safe); GLSL ES 1.0, no backticks in GLSL; frame fields:
bands/impulse/trend/centroid/beat/decks/params/time/dt. Hard rules:
self-contained file; bright saturated colors.
File: g14-voyage-comets.candidate.ts.
