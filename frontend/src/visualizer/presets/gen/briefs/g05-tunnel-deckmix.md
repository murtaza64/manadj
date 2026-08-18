# g05-tunnel-deckmix

Candidate: g05-tunnel-deckmix   Kind: tweak (element swap)
Parents: g02-tunnel-dream (1068 — the dreamy tunnel tuning the human
kept); raid g02-tunnel-punch (1050) for its harder kick vocabulary if
useful.
Human notes in play: gen-5 directive — minor variations: "swap palette
engine for deck-mix colors".
Instruction: SWAP the tunnel's palette engine for DECK-MIX COLORS. Deck
identity hues paint the tunnel: the incoming deck's color emerges from
the far end and TRAVELS toward the viewer as its level/fader rises, so a
mix visibly flows down the tunnel. EQ kills mute that deck's color band;
doubles snap both hues into interleaved rings. Keep wide in-hue phase
span so walls never go flat monochrome. Motion, dreaminess, kick
response stay parent.
Contract: default-export VisualizerPreset; frame fields:
bands/impulse/trend/beat/decks (levels/EQ/fader/doubles)/params/time/dt.
Hard rules: self-contained file, relative imports from presets/gen/;
createGlRenderer; GLSL ES 1.0; chroma-preserving soft knee; no backticks
inside GLSL template literals; u_-array uniforms sized exactly as
declared; photosensitivity floor; bright saturated colors; touch nothing
but your own file; verify with `cd frontend && npm run build`.
