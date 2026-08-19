# g05-odyssey-poly

Candidate: g05-odyssey-poly   Kind: tweak (element swap)
Parents: g01-odyssey (1080, pool leader)
Human notes in play: gen-5 directive — minor variations: "replacing one
element with another, or changing a visual element".
Instruction: REPLACE the core glow with a WIREFRAME POLYHEDRON. A slowly
tumbling wireframe solid sits where the glow core was; kicks flash facets
solid (solid kick response), edge count / subdivision complexity rides
max(trend.drop, energy), phrase boundaries morph the solid (tetra →
octa → icosa across the section, use `beat.ladderBarIndex ??
beat.barIndex`). Dust, palette travel, feedback trail, horizon ring all
stay exactly as the parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/centroid/beat/decks/spectrum/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
