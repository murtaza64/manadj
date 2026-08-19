Candidate: g13-skyline   Kind: novel
Territory: URBAN / MECHANICAL / HUMAN-MADE
Parents: none (fresh idea). Draws the FLAT-design canvas-2D discipline from
g10-poster (solid matte fills, hard edges, committed schemes, no feedback);
draws quantized grid grammar from the mirror/materia-metric lineage.

Human notes in play (verbatim):
- "FLAT design — solid matte fills, hard edges, committed 3-5 color schemes,
  motion by transforms and color swaps, flat-shaded polygon depth ... Less
  noisy != static: pops, flips, wipes, scheme swaps encouraged."
- "QUANTIZED grammar: hard cuts on the metric grid, integer jumps."
- "LEGIBLE CAUSALITY: you can see WHY something moved."
- "EARNED BRIGHTNESS: dark floors, light with a cause."

Falsifiable question: does a NIGHT CITY SKYLINE — buildings as spectrum
columns, their WINDOWS as a quantized per-band light grid, traffic streaming
at the street, an elevator running the beat — read as a legible machine-made
scene where every lit window has an audible cause, or does it collapse into
generic bar-graph-with-decoration?

Concept: a flat matte skyline against a dark night sky. The lower third is
STREET (traffic light-streams). Above it, a row of BUILDING SILHOUETTES, one
per spectrum group. Each building is a hard-edged rectangle; its HEIGHT is its
band level QUANTIZED to a floor-count (integer storeys — no smooth interp of a
discrete thing). Windows are a grid of small squares inside each building;
each window is either DARK or lit with the scheme color, and the lit FRACTION
per building rides that band. Kicks throw a whole building's floor lights on
in a hard stamp; the mid snare runs a WAVE of lit windows up a building;
highs sparkle single top-floor windows (discrete, gated — not dust). A bright
ELEVATOR car runs up-and-down one building's shaft locked to the beat (a
quantized pulse that LIGHTS the floor it passes). Traffic: short bright dashes
that march along the street on the beat grid (integer lane positions), red one
way, white the other — legible one-way streams, not particles.

Band vocabulary (DISTINCT per band, no shared medium):
- LOW  = building HEIGHTS / mass (bandsSlow.low sets the tallest downtown
         core; quantized to storeys). Kick (impulse.low) = a building's whole
         ground-floor row stamps lit (hard, gated, broadband kick).
- MID  = window LIT-FRACTION climbing the towers (bandsSlow.mid); snare
         (impulse.mid) = a lit-window WAVE sweeps up one building.
- HIGH = top-floor sparkle windows (impulse.high, discrete single squares) +
         the sharpness/speed of traffic dashes.
- ELEVATOR = the beat (beat.barPhase) drives one car up its shaft; quantized
  to floors, lights each floor it stops at.

Metric grammar (quantized, hard cuts):
- BEAT: traffic dashes advance one lane cell; elevator steps a floor.
- BAR (ladderBarIndex ?? barIndex): which building is the "spotlight" tower
  (fully lit) rotates; street lane offset micro-shifts.
- PHRASE (%4): skyline RECOMPOSES — building widths/positions re-drawn from
  the genome (hard cut).
- SECTION (%16): night PALETTE swap across committed city schemes (sodium/
  neon-miami/cyberpunk/blueprint-dawn), hard cut.
- DROP: the whole city BLAZES — every building fills toward full-lit, sky
  flips to the loudest scheme tint, traffic doubles density; luminance rides
  max(drop, energy), photosafe (no full-field strobe; window flips are local).
- BUILDUP: windows FLICKER on in a tense climbing count (tense-but-alive),
  elevator hunts faster — never eerily still.

Palettes (committed, bright saturated, dark sky floor — NO pastels):
sodium-amber on indigo; miami neon (magenta/cyan/lime) on near-black; hazard
cyberpunk (hot-pink/electric-blue) on deep-purple; blueprint (cyan/white) on
navy. Sky is always a dark-but-not-void flat color; windows are the only real
brightness — earned.

Genome: dominant audible deck trackId seeds building count, per-building
widths + storey caps, the phrase recomposition sequence, and the starting
scheme — same song, same skyline. No trackId => frozen pseudo-seed from
centroid/energy/spread.

Degrees of freedom (params, 3):
- density   (window grid fineness / traffic density)
- storeys   (max building height in storeys — the skyline's aspect)
- glow-off  (kept OFF the concept: this preset is FLAT; param instead tunes
  street traffic speed)  -> named `traffic`.

Invariants / hard rules:
- Self-contained file; default-export VisualizerPreset; canvas 2D, source-over
  (NO feedback buffer, NO createGlRenderer).
- FLAT: every element is a solid matte fill or hard-edged rect; windows are
  binary lit/dark; the sky is one flat dark color. No gradients on the actors,
  no glow haze.
- Quantized: heights, elevator floors, traffic lanes, window rows are all
  INTEGER cells — never smooth-interp a discrete count.
- Kick spawns gated on impulse.low (no kick-powder); highs own the sparkle.
- bandsSlow.* for anything that MOVES/climbs (heights, lit-fraction, traffic
  speed); instantaneous bands/impulse for brightness + stamps + spawns
  (motion-smoothness law).
- beat.ladderBarIndex ?? beat.barIndex for tiers; smoothed drop/buildup split
  (~0.35 s); sustained states ride max(drop, energy).
- Photosensitivity floor: no >3 full-field luminance flashes/s; window/floor
  flips are LOCAL and exempt; the drop sky-tint change is rate-limited.

Assigned tech: 24-band spectrum (building heights + window grid), bandsSlow
(heights/lit-fraction/traffic speed), per-band impulses (kick floor-stamp,
snare window-wave, hat top-sparkle), beat phase (elevator + traffic march),
ladder bar/phrase/section tiers, trend drop/buildup split, deck trackId
genome.

Anti-resemblance: NOT warehouse (that's a strobing club room), NOT scanline/
strobe-column, NOT a plain spectrum bar graph (windows + elevator + traffic +
recomposition + quantized storeys carry a literal CITY, not bars), NOT crowd
(silhouetted people). No particle field, no fluid, no feedback.
