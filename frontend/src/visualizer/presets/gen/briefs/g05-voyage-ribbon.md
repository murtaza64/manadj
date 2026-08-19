# g05-voyage-ribbon

Candidate: g05-voyage-ribbon   Kind: tweak (element swap, raids
g01-ink-vortex)
Parents: g00-voyage (1079, co-leader); raid g01-ink-vortex (1043) for its
live-waveform luminous filament technique (wantsWave).
Human notes in play: gen-5 directive — minor variations: replace one
element with another.
Instruction: SWAP the ember dust medium for a LIVE-WAVEFORM FILAMENT
RIBBON. The stereo waveform (set `wantsWave`) becomes a luminous ribbon
orbiting/threading the voyage space, advected by the same flow the dust
used; snare/hat impulses kink and spark it (mid/high only). Kick response
stays SOLID (traveling ripple + core pump untouched — the ribbon is lit
by the passing ripple). Palette travel, horizon ring, phrase swell stay
parent.
Contract: default-export VisualizerPreset with `wantsWave: true`; frame
fields: bands/impulse/trend/beat/wave/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
