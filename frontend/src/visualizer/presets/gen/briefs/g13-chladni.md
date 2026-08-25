# g13-chladni — cymatics / standing-wave nodal figures

Candidate: g13-chladni   Kind: novel
Territory: NATURAL PHENOMENA & PHYSICS — resonance / cymatics / standing
waves. Not in the pool; honors anti-resemblance (no spirals, no tunnels,
no FBM, no ribbons, no metaballs, no Vissonance flat geometry families —
this is a NODAL-FIELD medium, not iris/barred/tricentric/poster/hillfog).
Satisfies the FLAT appetite: solid matte fills, hard edges, committed
scheme, motion by transforms + scheme swaps + mode flips.

## Falsifiable question
Can a Chladni-plate nodal figure — sand collecting on the zero-lines of a
vibrating square plate — make a FLAT, hard-edged, legible visual whose
STRUCTURE changes on quantized mode flips (kick = snap to a new resonant
mode), reading as a real physical phenomenon rather than a noisy field?

## Concept
A square plate driven at a resonant frequency forms standing waves; sand
migrates OFF the antinodes and PILES on the nodal lines (where amplitude
is zero). The classic Chladni figure is `cos(mπx)cos(nπy) −
cos(nπx)cos(mπy) ≈ 0` for integer mode numbers (m,n). Rendering: compute
this field per pixel-cell, draw the plate as a SOLID matte fill, and paint
the sand as bright grains BANDED tightly around the nodal zero-set (a hard
threshold on |field| — flat, crisp, no glow). Between nodal lines the plate
is its dark matte color: earned brightness, dark floor.

This is FLAT by construction: the sand is a committed accent color, the
plate a committed dark fill, nodal lines are hard-edged. Motion is the
plate resonating (a small quantized amplitude tremor) and — the theatre —
MODE FLIPS: the (m,n) pair changes in integer jumps, snapping the whole
figure to a new topology (voyage-hardcut quantized grammar). Sand
re-settles with a short migration animation (grains slide toward the new
nodal set), the one place smoothness is allowed.

Canvas 2D (crisp fills, flat shading). Field evaluated on a coarse grid
(cells, not per-pixel), sand drawn as small squares where the field
crosses zero within a threshold that widens with drive energy (a loud
plate throws MORE sand onto the lines).

## Band → vocabulary (DISTINCT per band)
- **low (bass)** → primary mode number `m` and plate DRIVE amplitude. Bass
  level sets how hard the plate is driven → sand-line thickness / how much
  sand is thrown. `impulse.low` (kick) SNAPS `m` to a new integer (hard
  mode flip — the scene-scale event). Gate flips on impulse.low so it's a
  solid response, never kick powder.
- **mid** → secondary mode number `n` and NODAL-LINE thickness. `impulse.mid`
  (snare) jitters `n` by ±1 for one settle (a topology tremor) and flashes
  the sand accent brighter for that beat.
- **high** → GRAIN SHIMMER: `impulse.high` (hats) sprays a fine scatter of
  loose grains that haven't settled yet — sharp bright specks along the
  antinodes that die in a frame (not persistent dust; a sizzle).

## Kick / drop / buildup grammar
- **KICK** (impulse.low): snap `m` to next mode in a quantized sequence
  (splitmix genome order) → whole figure re-topologizes; sand re-migrates.
- **SNARE** (impulse.mid): `n` tremor ±1 + accent-brighten one settle.
- **BUILDUP** (trend.excitement): drive climbs — sand lines THICKEN and the
  plate tremor amplitude rises; mode numbers creep UP (higher-order, denser
  figures). Tense-but-alive, never still.
- **DROP** (smoothed max(drop,energy)): high-order mode (dense lattice of
  nodal lines), plate goes to a fast quantized tremor, scheme INVERTS
  (sand⇄plate colors swap) for the plateau, held on max(drop,energy).
- **PHRASE / SECTION** (beat.ladderBarIndex ?? barIndex): plate quarter-turn
  rotation snaps on phrase (hard cut, quantized 90°); the 3-color scheme
  (plate / sand / accent) hard-swaps on section (chroma event, luminance
  parity across schemes → photosafe).

## Palette policy
Committed FLAT 3-color schemes (dark plate, bright sand, accent), bright
and fully saturated (project taste, NO pastels), luminance-comparable
across schemes so section swaps and drop inversions read as chroma events
not brightness flashes. trackId genome fixes the scheme walk order (same
song → same sequence). `source-over` only; no additive/glow/feedback.

## Photosafety
No feedback field, no additive haze. Section scheme swaps and drop
inversions are chroma events with matched mean luminance (not full-field
brightness flashes). Mode flips are geometry changes (nodal set re-draws),
not luminance flashes. No saturated-red strobing. Grain shimmer is
localized speckle → exempt.

## Assigned tech
24-band spectrum + bandsSlow (drive envelopes; PRIMARY structure from
per-band impulses), per-band impulses (kick mode-flip / snare tremor /
hat shimmer), trend drop/buildup split (smoothed ~0.35s), beat + ladder
tiers (phrase rotation, section scheme swap, drop plateau), trackId genome
(mode sequence + scheme order), centroid (accent hue bias). Canvas 2D flat.

## Params (3–5)
- `grid` — nodal field resolution / cell size (0.6–1.6, default 1.0)
- `sand` — nodal-line thickness / sand throw (0.5–1.6, default 1.0)
- `modeBase` — resting mode-number floor (1–4, default 2)
- `tremor` — plate resonance tremor amplitude (0–1.4, default 0.8)
