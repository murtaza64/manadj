# g05-prime-embers

Candidate: g05-prime-embers   Kind: tweak (element swap)
Parents: g02-voyage-prime (1065); raid g00-voyage (1079) for the
traveling-ripple idiom.
Human notes in play: gen-5 directive — minor variations: "replacing core
glow with" another element.
Instruction: REPLACE the core glow with a DRIFTING EMBER FIELD — no
central glow at all; instead a field of slow-drifting embers whose
brightness is EARNED: the traveling kick ripple LIGHTS the embers it
passes (they flare and cool), snare gusts scatter them (mid/high gated),
and during drops the whole field ignites riding max(trend.drop, energy).
Buildups: embers quicken and warm (tense-but-alive, never still).
Palette travel applies to ember temperature tint. Everything else stays
parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/params/time/dt. Phrase tiers:
`beat.ladderBarIndex ?? beat.barIndex`.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
