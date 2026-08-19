# g05-materia-mercury

Candidate: g05-materia-mercury   Kind: tweak (visual-element change)
Parents: g03-materia-deep (1074); raid g02-materia (1068).
Human notes in play: gen-5 directive — minor variations: change a visual
element. Materia family wins on spectral-material identity (glass↔sand).
Instruction: CHANGE the surface material vocabulary: the 24-band relief
becomes LIQUID MERCURY. Flatness = viscosity (tonal → mirror-smooth
chrome ridges; noisy → boiling droplets), spread = ripple dispersion
(narrow sound → tight standing waves; wide → broad interference).
Kicks slam a SOLID pressure wave across the pool; snare keeps its
beloved powder (as fine mercury spray, mid/high gated). Palette still
travels — mercury tints with the traveling palette, never grayscale
chrome. EQ region kills dent the pool. Structure, genome, phrase behavior
stay parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/centroid/spread/flatness/spectrum/beat/decks/params/
time/dt. Phrase tiers: `beat.ladderBarIndex ?? beat.barIndex`.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
