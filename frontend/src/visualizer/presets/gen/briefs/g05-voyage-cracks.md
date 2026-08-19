# g05-voyage-cracks

Candidate: g05-voyage-cracks   Kind: tweak (element swap)
Parents: g00-voyage (1079, co-leader)
Human notes in play: gen-5 directive — minor variations: "replace
shockwave rings with screen-space cracks".
Instruction: REPLACE the kick shockwave rings with SCREEN-SPACE CRACKS.
Kick = a crack web snaps open from the ripple's travel point, refracting
the starfield along its edges, healing by the next downbeat (beat
phase). Drop = full-field fracture (refraction only, no luminance flash)
healing over a phrase (`beat.ladderBarIndex ?? beat.barIndex`), riding
max(trend.drop, energy). Vibrant buildups: cracks glow warmer as buildup
tension rises (never dim/still). All other voyage elements stay parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
