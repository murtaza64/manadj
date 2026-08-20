# g14-lattice-lucid — dense lattice, rebuilt legibly

Candidate: g14-lattice-lucid   Kind: novel (clean-room remake)
Parents: none (concept resurrection; fossil g01-strobe-lattice engine +
g02-lattice-dense settings read only for the autopsy)
Human notes in play: "theres potential but not usable as is"
(g02-lattice-dense, 4 approvals — the DENSE grid was liked).

## Falsifiable question
Can a dense node-and-strut lattice stay LEGIBLE — no swimming, no
full-field strobe, no spiral smear — while still hitting hard on kicks
and reading the EQ bands as distinct circuits?

## Fossil autopsy (what this remake must not repeat)
- Feedback sampled through a per-frame ROTATION (−spin·0.04) + kick push:
  the whole trail field spiraled and sheared — the swim/nausea engine.
  Dense grid (11) + long trails (1.5) amplified it.
- Raw impulse.low displaced draw AND feedback coords every kick (whole
  field jumps per hit); raw impulse.high jittered node positions.
- Quarter-turn ease tau 0.09 s ≈ an instant snap, per BAR, direction
  flipping each section.
- Full-field flash envelope (tau 0.04 s) at beat rate = a strobe.

## Concept
Same beloved ingredients — dense tri/hex lattice, glow nodes, strut
wiring, quarter-turn grammar, long ghosts — rebuilt on legible motion:
- Feedback sampling is IDENTITY (no rotation, no zoom, no kick push):
  ghosts are pure temporal decay, so trails form only where light
  actually moved. Decay short (~0.90), injection ×(1−decay).
- The lattice itself never translates per-frame with audio: scroll
  velocity rides bandsSlow through a τ≥0.3 s envelope; quarter-turns
  happen on PHRASE boundaries only (ladder-correct), eased at τ 0.35 s,
  one fixed direction per section.
- Kicks are a TRAVELING radial ring that LIGHTS the nodes it passes
  (voyage ripple idiom) + a node core pump — zero displacement.
- The strobe is replaced by a BPM-locked brightness wave sweeping across
  the lattice (beat.phase drives its position; speed is the meter, not
  energy) — localized band, never full-field.

## Band → vocabulary (distinct circuits)
- **low** → node CORE size/brightness pump (solid); impulse.low = the
  traveling lit ring.
- **mid** → strut glow: the wiring lights up, brightness rides bands.mid,
  impulse.mid sends a one-shot glint packet down a hashed strut axis.
- **high** → node TWINKLE: sparse hashed per-node sparkle gated by
  impulse.high (localized specks, not dust — dies in ~0.15 s).

## Grammar
- PHRASE (`ladderBarIndex ?? barIndex` % 4): quarter-turn (eased 0.35 s).
- SECTION (% 16): hue-midpoint inversion (the liked fossil event), with
  luminance parity — a chroma event, not a brightness flash. Wiring
  topology (tri↔hex blend) re-seeds.
- BUILDUP: struts tighten + cool, scroll slows (tense-but-alive).
- DROP (ride max(drop, energy)): density steps UP one notch (quantized),
  hue warms, node cores enlarge — held on the plateau.

## Invariants
- No per-frame audio displacement of geometry or feedback coords.
- Full-field luminance never flashes; beat wave + kick ring are localized.
- Feedback contractive: decay ≤ 0.92, injection ×(1−decay), no grades > 1.

## Assigned tech
beat phase + bpm (the sweep), ladder bar/phrase/section tiers, per-band
impulses, bandsSlow (scroll velocity), trend split (~0.35 s), centroid
(hue drift), trackId genome (basis skew, hue base, glint axes).

## Params
- `density` — cells across (6–16, default 11 — the liked density)
- `ghosts` — trail persistence (0.3–1.6, default 1)
- `sweep` — beat-wave gain (0–1.5, default 0.8)
- `wiring` — tri↔hex basis blend (0–2, default 1)
