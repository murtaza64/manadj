# g05-materia-shards

Candidate: g05-materia-shards   Kind: tweak (element swap)
Parents: g03-materia-deep (1074, #3 and surging — 24-band surface
sculpture, EQ region kills, trackId genome); raid g02-materia (1068) for
the glass↔sand material engine.
Human notes in play: gen-5 directive — minor variations: "swap snare
powder for glass shards". Snare powder is beloved — this tests the
sibling element head-to-head.
Instruction: SWAP the snare powder for GLASS SHARDS ejected from the
sculpted surface. Snare impulse cracks the 24-band relief at the loudest
spectral region and throws angular refractive shards (mid/high gated);
shards inherit the surface material (glassy when flatness low, gritty
when high) and settle back into the relief. Kick response stays SOLID
(surface pump). Everything else — spectrum sculpture, EQ region kills,
trackId genome — stays parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/centroid/spread/flatness/spectrum/beat/decks/params/
time/dt. Phrase tiers: `beat.ladderBarIndex ?? beat.barIndex`.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
