# g05-voyage-deckmix

Candidate: g05-voyage-deckmix   Kind: tweak (element swap)
Parents: g00-voyage (1079, co-leader — ember starfield voyage: unsharp
feedback tap, traveling kick ripple that lights what it passes, charged
horizon ring, localized lens swirl)
Human notes in play: gen-5 directive — minor variations: "swap palette
engine for deck-mix colors".
Instruction: SWAP the palette engine for DECK-MIX COLORS. Each audible
deck contributes its identity hue (deck colors helper); the blend follows
deck levels/fader so a transition literally TRAVELS the color of the
scene from outgoing deck to incoming deck. Doubles/EQ kills shift the
mix. Keep wide phase span within each deck hue (shades/tints drift
spatially) so dust never goes monochrome. Everything else — motion,
ripple, ring, swell — stays exactly the parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/decks (levels/EQ/fader/doubles)/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
