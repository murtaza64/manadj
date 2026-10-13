Candidate: g19-cantor-atlas   Kind: novel
Parents: none; gen-19 free ideation (subdivision-journey direction:
fractal depth as the long axis, sections flip the subdivision rule).
Human notes in play: "focus on meter and long evolution... more immediate
contrast between sections and longer periods... abstract geometric ones."
Question: Does RECURSION DEPTH work as a long axis — a lace that deepens
one level at a time across an epoch — while flipping the 3x3 void-mask
RULE at every section boundary keeps adjacent sections utterly distinct?
Instruction: GL screen-tiling 3x3 subdivision fractal (Cantor-carpet
family). Each cell subdivides; a 9-bit VOID MASK decides which sub-cells
carve out (escape → colored by escape level, 4 committed hues) and which
stay solid (recurse; deepest solid cells read as tiles with dark grout).
DEPTH follows the ladder [1,2,2,3,3,4,4,5] across the epoch's 8 sections
— minute-1 is a coarse 9-cell poster, late sections are depth-5 lace.
SECTION boundary: the mask re-rolls (new rule = instantly different
texture) + palette rotation. BAR: the COMPLEMENT level cycles — one
recursion level renders its mask inverted, and which level that is steps
per bar (hard structural churn, distributed, not a luminance flash).
EPOCH (128 bars): depth collapses back to 1, the mask table reshuffles,
palette family steps. BEAT: one top-level cell accents (chroma-only),
marching through the 9 positions. Slow domain drift (translation only)
rides bandsSlow.mid. Kick: grout widens (solid inset pump). Snare: the
complement level's escape cells brighten. Hats: grout-line glints.
Invariants: masks always keep the center solid + 5-7 solid bits (a spine
to recurse down); depth changes ONLY at section/epoch boundaries; no
zoom, no rotation; no feedback buffer; luminance parity across palettes.
Degrees of freedom: mask popcount range, grout weight, accent strength.
Assigned tech: ladderBarIndex tiers, beat counter (cell march),
per-band impulses (grout pump / level flash / glints), bandsSlow.mid
drift, centroid hue tilt, trackId genome via dominantChannel (mask table,
palette orbit, drift direction), pseudo-meter fallback.
Anti-resemblance: NOT truchet arcs, NOT julia/mandel escape-time zoom,
NOT lattice-flow, NOT flip-matrix.
Contract: default-export VisualizerPreset; GL via createGlRenderer
(context-loss safe); GLSL ES 1.0, no backticks in GLSL, uniform arrays
avoided (mask packed as a float bitfield, exp2/mod extraction).
Hard rules: self-contained file; bright saturated colors;
photosensitivity floor; motion terms ride bandsSlow.
