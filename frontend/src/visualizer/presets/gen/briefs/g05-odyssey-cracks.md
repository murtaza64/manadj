# g05-odyssey-cracks

Candidate: g05-odyssey-cracks   Kind: tweak (element swap)
Parents: g01-odyssey (1080, pool leader)
Human notes in play: gen-5 directive — minor variations. Prior voyage-
family note: "do something different with the spinning tri-segment ring"
(solar-crown answered with prominences; this is a different answer).
Instruction: REPLACE the kick shockwave rings / ring element with
SCREEN-SPACE CRACKS. Kicks strike the screen like tempered glass: a
radial crack web grows from a travel point (not always center), refracts
the scene along crack edges, and HEALS over the bar (fully healed by the
next downbeat; use beat phase). Drops escalate: full-screen fracture that
heals over a phrase (`beat.ladderBarIndex ?? beat.barIndex`), riding
max(trend.drop, energy). Localized effect — not a luminance flash, so
photosafe by construction; keep it that way. Everything else stays parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/decks/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
