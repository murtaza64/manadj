# g07-voyage-prism

Candidate: g07-voyage-prism   Kind: tweak (color-system fix + variation)
Parents: g00-voyage (1044, 3/0, 6 approvals).
Human note in play (verbatim): "the palette params in voyage family dont
seem to affect the dust color (always red and blue). can we make some
variants that spice up the dust a bit?"
Diagnosis (from source, presets/voyage.ts): only the disk clouds sample
palette(); the star-scatter tint (hardcoded blue-white/warm mix, line
~125), LOW additive, charge ring (red/orange), coal heart, lens streak,
and kick shockwave are all FIXED colors — that's the eternal red/blue.
Falsifiable question: does unifying EVERY element under the traveling
palette (so the palette param finally moves the whole scene) beat the
parent's fixed accents?
Instruction: copy g00-voyage; rewire ALL hardcoded element colors to
derive from the palette system: stars tint = palette samples at
per-star hash offsets (keep brightness/size behavior), charge ring +
coal heart = palette-derived hot ramp (palette color pushed toward
white for heat), lens streak + shockwave = palette samples at wide
phase offsets. Replace the pal0-3 bank with four HIGHER-VARIETY banks
(each with genuinely distinct hue centers — include at least one
green/teal-forward and one violet/pink-forward bank). The `palette`
param must now visibly recolor dust, stars, ring, streak, and shocks
together. Drama: kick shockwave gets a complementary-color leading edge
(contrast); drop saturates and brightens the entire unified palette
(rides max(drop, energy)).
Invariants: parent geometry/motion untouched; params keep same names +
add none.
Assigned tech: as parent.
File: g07-voyage-prism.candidate.ts. Standing law: docs/visualizer-ga.md.
