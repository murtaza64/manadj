Candidate: g18-countdown   Kind: novel
Parents: none; meter-as-subject free ideation (gen-18 "more focus on meter").
Human notes in play: "more focus on meter"; FLAT APPETITE (gen-10: solid
matte fills, hard edges, committed 3-5 color schemes, motion by transforms
and color swaps).
Question: Does COUNTING DOWN (bars remaining to the section boundary, not
bars elapsed) read as anticipation architecture — the whole room charging
toward zero — while staying flat and legible?
Instruction: A giant two-digit 7-segment numeral shows bars REMAINING in
the 16-bar section (16 → 1). It hard-flips on every bar boundary (integer
jump + 0.12s mechanical settle — never a continuous spin). Four beat pips
under the numeral fill ON beats; a thin rail sweeps barPhase. Final 4 bars
= ARMED state: pure color swap (no luminance jump) + four conduit segments
lighting one per remaining bar. At zero the panel fires: one rate-limited
invert flash (once per 16 bars), palette rotates from trackId + section.
Flat matte background stripes drift on bandsSlow; kick jolts the panel
(displacement, not brightness); snare sweeps a glint across the segments;
hats flicker the rail ticks.
Invariants: numeral readable at any glance; flat design — no glow fields,
no feedback, no particles; dark floor; armed-state palette keeps luminance
parity with the calm state; flash envelope rate-limited (WCAG 2.3.1).
Degrees of freedom: stripe angle/energy, jolt strength, armed hue span.
Assigned tech: regime (buildup/dropTransition feed the charge), bandsSlow
(stripe drift), impulses (jolt/glint/tick), tiers via ladderBarIndex,
trackId genome.
Anti-resemblance: no split-flap (g16-flip-matrix), no CRT phosphor mask
(g07-crt family), no orrery dials/gears, no strobe columns.
Contract: default-export VisualizerPreset; canvas 2D; frame fields:
bands/impulse/trend/regime/beat/decks/params/time/dt.
Hard rules: self-contained file; bright saturated colors; photosensitivity
floor; motion terms ride bandsSlow.
