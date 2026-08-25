# g07-hypno

Candidate: g07-hypno   Kind: novel
Parents: none (human ask: "spirals are also cool, see hypnotic spiral
work in ~/spiral-vr" — reference implementation
~/spiral-vr/generate.py, readable; its math is summarized here).
Focus: reactivity, dramatic kicks/drops, contrast, movement.
Falsifiable question: can a hypnotic-spiral engine be made genuinely
MUSICAL (beat-locked, kick-dramatic) without losing the hypnotic pull?
Reference math (from generate.py): pattern field = arms*theta +
twist*log(r), banded by a smooth square wave; effect family = spiral
(4 arms, twist 6), tunnel (rings only), pinwheel (rays only), double
(two counter-rotating spirals MULTIPLIED = moire interference), checker
(rays x rings), mandala (static rays, bands pulse through). Analytic
antialiasing: band edge width from local frequency; where frequency
exceeds ~Nyquist fade to mid-gray (in GLSL: compute the analytic
frequency from the polar coords — no derivatives extension needed).
Instruction: a full-frame hypnotic engine, beat-locked: rotation phase
advances with beat phase (bar-rational speeds), so the spiral BREATHES
with the groove rather than spinning freely. Kick = a twist SURGE (the
spiral momentarily tightens: twist +30-50% with elastic recovery) plus
an inward zoom pulse — spacetime yanks, no flash. Snare = a
counter-phase shimmer running along band edges (mid/high gated). Bass
level = band contrast depth (heavy bass: ink-black vs blazing bands;
low bass: soft pastel-free saturated wash). Phrase = slow morph within
a family (arms/twist drift); SECTION = family change (spiral → double →
checker → pinwheel → mandala) staged as a visible re-twist, plus
palette regime change. Drop = DOUBLE mode forced: counter-rotating
moire interference at maximum contrast + fastest rational speed, riding
max(drop, energy). Colors: two-color band palettes that travel (never
plain black/white); wide phase span.
PHOTOSAFETY (critical for this one): band flicker rate must stay under
3 full-field alternations/sec at every radius — cap angular speed *
arms and zoom speed * ring frequency accordingly; the Nyquist gray-out
from the reference also prevents center flicker. No saturated-red
two-color pairs.
Assigned tech: beat phase + bpm (primary), impulses, bands.low, ladder
tiers, trend.
Anti-resemblance: not the tunnel family (no feedback warp, no depth
illusion — this is flat pattern hypnosis); no dust.
File: g07-hypno.candidate.ts. Standing law: docs/visualizer-ga.md.
