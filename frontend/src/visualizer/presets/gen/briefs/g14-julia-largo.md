# g14-julia-largo — Julia fractal, third resurrection: slow, phrase-locked

Candidate: g14-julia-largo   Kind: novel (clean-room remake)
Parents: none (concept resurrection; fossils g02-julia, g03-julia-lumen,
g04-julia-glacial read only for the autopsy)
Human notes in play: "really cool idea still, just too fast to read as
musical" (g02/g03), "blank much of the time" (g02).

## Falsifiable question
Can a Julia set read as MUSICAL — held still within a bar, stepping its
anatomy only on bar boundaries, never blank — instead of a continuously
morphing screensaver?

## Fossil autopsy (what this remake must not repeat)
- C never rested: per-frame eased targets that themselves moved every
  frame (drift phase, centroid θ wobble ×0.9 on the C circle) — a
  continuous morph, no held poses.
- g04's per-bar steps were a RANDOM-signed jitter walk with wall-clock
  trap/rot/shimmer terms still ticking; quantization never produced
  stillness.
- Blankness: C radius stacked out to ~0.94 (Cantor-dust territory),
  escape radius varied with spread, brightness multiplied by energy with
  no floor, exterior unlit in g02.

## Concept
C lives on a PRE-VERIFIED dense locus: the main-cardioid boundary
`c(θ) = m/2 − m²/4, m = 0.985·e^{iθ}` (just inside → always connected,
near-parabolic, maximal filigree) and the period-2 disk
`c = −1 + 0.24·e^{iφ}`. C CANNOT leave the connected locus by
construction. It advances by one genome-fixed MONOTONE θ step per bar
(no random signs), eased with τ ≈ 0.25 s — a quick legible statement,
then HELD STILL for the rest of the bar. Phrase bars take a 4× step;
section bars swap family (cardioid ↔ period-2) and palette bank. All
wall-clock clocks are FROZEN: the trap point and frame rotation are
bar-quantized constants (eased on the same step), zoom is a genome
constant with only a tiny bandsSlow breath. Between steps the image is
STILL; the music moves only light.

Never blank: every escaped pixel gets smooth-iteration (nu) banded
palette color; interior gets orbit-trap glow (point + line trap); an
additive luminance floor is applied BEFORE any energy scaling.

## Band → vocabulary
- **low / impulse.low (kick)** → interior trap glow bloom + a radial
  light ring traveling outward from the origin, COLORING only — zero
  displacement, zero zoom punch. Whole-frame lift capped at ×1.08.
- **mid** → trap radius breathing (small, ±20%) + band contrast;
  impulse.mid = trap flash toward white.
- **high / impulse.high** → fine shimmer on the exterior nu-band edges
  (high-frequency, localized to band boundaries — not full-field).
- **drop (smoothed, ride max(drop, energy))** → warm palette bias +
  saturation lift + trap bloom. **buildup** → trap radius tightens, cool
  bias, mild dim (bounded, never still-dark).

## Degrees of freedom
1. θ step size per bar (genome; pace param scales it).
2. Trap geometry (point radius + line trap weights, genome-seeded).
3. Palette banks (4 iq-cosine families, section-stepped, luminance-parity).

## Invariants
- C on the locus, monotone bar steps via
  `beat.ladderBarIndex ?? beat.barIndex`; gridless fallback = one step
  per 2 s.
- No feedback buffer (pure stateless shader — no contraction risk).
- Additive floor ≥ 0.16 before energy multiplication; screen never blank.
- No continuous wall-clock motion anywhere.

## Assigned tech
beat bar/phrase/section tiers (ladder-correct), per-band impulses,
trend drop/buildup split (~0.35 s smoothing), bandsSlow (zoom breath),
centroid (palette temperature), trackId genome (θ walk + traps + banks).

## Anti-resemblance
No feedback advection, no dust, no spirals-by-rotation; the identity is
QUANTIZED STILLNESS — closest pool grammar is voyage-hardcut's cuts, but
here applied to fractal anatomy, not camera.

## Params
- `pace` — bar-step size multiplier (0.3–2, default 1)
- `zoom` — framing (0.7–1.6, default 1)
- `glow` — trap gain (0.4–1.8, default 1)
- `bands` — exterior band density (0.5–2, default 1)
