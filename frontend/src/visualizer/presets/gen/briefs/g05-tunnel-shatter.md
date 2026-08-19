# g05-tunnel-shatter

Candidate: g05-tunnel-shatter   Kind: tweak (element swap)
Parents: g02-tunnel-dream (1068); raid g02-tunnel-punch (1050).
Human notes in play: gen-5 directive — minor variations: element swaps;
"replace shockwave rings with screen-space cracks" adapted in-tunnel.
Instruction: CHANGE the tunnel walls into GLASS PANES. Wall segments are
tempered-glass panels; kicks send a SOLID crack pulse down the nearest
ring of panes; on a DROP the oncoming section of tunnel shatters and the
camera flies through the shard cloud (riding max(trend.drop, energy)),
re-forming over the next phrase (`beat.ladderBarIndex ?? beat.barIndex`).
Snare tinks small star-cracks (mid/high gated). Refraction, not
luminance flash — keep the dreamy glow envelope of the parent; vibrant
(never still) during buildups.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
