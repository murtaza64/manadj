# Visualizer genetic evolution — orchestrator kit

Guided evolution of visualizer presets: agents mutate full-source preset
modules, the human judges head-to-head in the arena, the orchestrating
agent breeds. Design decisions: issue
`realtime-visualization/06-genetic-preset-arena`.

## Pieces

- **Candidates**: `frontend/src/visualizer/presets/gen/gNN-<slug>.candidate.ts`
  — self-contained, default-export a `VisualizerPreset` (frozen contract:
  `presets/types.ts` VisualizerFrameData; helpers importable: `glPreset`,
  `../style`, `../bands`, waveform colors, deck colors). Filename stem is
  the identity everywhere.
- **Manifest**: `gen/genepool.json` — orchestrator-owned. Per candidate:
  `generation, parents[], kind (seed|tweak|combine|novel), brief, rating,
  status (alive|dead|promoted), notes[]` (folded from events).
- **Events**: `gen/events.jsonl` — arena-appended, append-only
  (vote/note/promote/error). Backend: `/api/ga/state`, `/api/ga/events`
  (backend/routers/visualizer_ga.py). NEVER write events; fold them.
- **Arena**: viz window at `/visualizer?arena=1`. Split-screen pair off
  the live feed; hotkeys ←/→/↓/↑/space/f/t/[/]. Crashing or unloadable
  candidates auto-lose + get error events.
- **Briefs**: `gen/briefs/gNN-<slug>.md` — the creative instruction a
  generation agent received (written by the orchestrator, kept for
  lineage/handoff).

## The breeding loop (orchestrator, on demand)

1. `GET /api/ga/state` (or read the files). Fold events newer than the
   manifest's `foldedThrough` timestamp (Elo semantics v2, human-approved
   2026-08-18; full log refolded once at adoption):
   - SOLO REVIEW (primary judging mode since 2026-08-18, human ask):
     `type: solo` events — `target` + `outcome: like|dislike|neutral` +
     `paramsA` snapshot — recorded from the MAIN viz window during
     normal DJ use (hotkeys g/b/m, t note, n next; auto-cycle mode `c`:
     45s timer or 128-beats-after-drop; scheduler = least-reviewed
     first). Fold: like → `approvals`+1, dislike → `rejections`+1,
     neutral → seen only. Death: dislikes kill a candidate only when it
     has ≥2 rejections and zero approvals AND zero forced-choice wins
     (solo verdicts are cheaper than arena both_bad — one bad first
     impression must not kill). Head-to-head arena votes still fold per
     the rules below when the human uses the arena.
   - Only FORCED-CHOICE outcomes (`a`/`b`) move rating: Elo K=32,
     expected score standard logistic (400).
   - `both_good`/`both_bad` are absolute labels: increment `approvals`/
     `rejections` on both candidates, no rating transfer. `both_bad`
     kills candidates with zero forced-choice wins (status `dead`).
   - `error`: status `dead`, keep file (fossil). `promote`: see
     promotion. Attach notes to their candidates (`pair:` notes to both).
   - Manifest per-candidate tallies: `wins/losses/approvals/rejections/
     oppCount` (distinct opponents — parenthood floor is oppCount ≥ 3).
   - SCORING v3 (human-approved 2026-08-18, thumbs-native): `score =
     (wins + approvals) - (losses + rejections)` — the primary ranking;
     legacy Elo `rating` is retained only as a tiebreaker. ALL presets
     are equal: the curated set participates as its g00-* seeds, there
     is no first-class tier; the switcher shows one score-sorted list.
2. Choose the next generation's mix (default, adjust with judgment):
   ~40% **tweak** (single parent, small: "keep everything, fix X" — mine
   the notes), ~30% **combine** (two parents' liked elements), ~30%
   **novel** (fresh idea, may raid any fossil for parts). 4–8 candidates
   per generation; parents = highest-rated alive, weighted sampling.
3. Write one brief per candidate (template below), then generate:
   spawn agents across models for diversity (GPT 5.6 sol, opus 5,
   opus 4.8, fable 5 — `es agent spawn --model …`, or in-session
   subagents when model variety isn't needed). The agent reads the brief +
   parents' source and writes ONE `.candidate.ts` file. It must not touch
   anything else.
4. Verify: `npm run build` (tsc catches contract violations); update the
   manifest (new entries, `generation` bump, `foldedThrough`); commit the
   lane change. Tell the human the arena is restocked.

## In-place refinement (human-approved 2026-08-18)

When feedback on a candidate is EXECUTION feedback (too bright, too
fast, jittery, washed out, "didn't achieve its own brief"), refine the
candidate IN PLACE — same file, same id, same rating history — and
append an orchestrator note to its manifest entry recording the revision
(date + what changed). Breeding a new gNN child is for CONCEPT changes
(different idea, different parentage) or when the human asks for
variants. Rationale: ratings and notes accumulate on the id; a rename
resets the evidence. Precedents: orrery-tick NaN fix, chameleon v2
(tonal pole = multi-hue color does the work, percussive pole =
achromatic warp/shake/tear kinetics).

## Tech coverage (marathon rule)

Every generation must COLLECTIVELY exercise the full sensing stack —
briefs name their assigned tech explicitly: band envelopes, per-band
impulses (kick/snare/hat), energy trend (drop/buildup split), spectral
centroid, 24-band spectrum, beat phase + bpm, bar/phrase/section tiers
(beat.barIndex), deck state (levels/EQ/fader/doubles), stereo wave
(wantsWave). A generation that leaves tech unused is leaving search space
unexplored.

## New tech is IN SCOPE

The frame contract is extensible during the marathon, additive-only:
a candidate may propose a new signal (e.g. stereo width, key/chroma,
onset density, per-deck impulses). Procedure: the ORCHESTRATOR implements
the seam (pure + tested in bands.ts or a sibling, shipped by the bridge,
optional in the protocol so old candidates keep working), lands it in the
lane as shared tech, then the candidate uses it. Candidates never modify
shared files themselves.

## Taste calibration (bake into every brief — hard-won, do not re-derive)

- Kicks/bass = SOLID responses (core pump, rings, lens, shockwaves);
  powder/particles are MID/HIGH-only effects. Gate any spawn by
  impulse.low (kick clicks are broadband) or it reads as "kick powder".
  Snare powder is beloved — keep it available.
- `trend.excitement` is a TRANSITION signal: it fades over a drop's
  plateau. Sustained states must ride max(drop, energy). Smooth the
  drop/buildup split (~0.35 s) or regimes flip harshly.
- Buildups: tense-but-alive, never "eerily still" (no stacked
  suppressors); overall ceiling currently tuned slightly DOWN.
- Shape carries band identity; color is FREE to travel (palettes with
  wide phase span + spatial drift, else dust goes monochrome).
- Evolution through phrases beats static loops; the biggest changes
  belong on drops and section boundaries (drop-aware genome overrides).
- MEDIUM DIVERSITY (human, 2026-08-18, with screenshot evidence): voyage/
  odyssey descendants keep inheriting the same advected fine-dust
  feedback medium and "all look pretty similar" — a wash. New variants
  in these families must REPLACE the mass/dust technique, not restyle
  it: liquid metaballs, discrete flocking swarms, drifting rigid plates,
  thick billowing ink, light-trail comets, woven nets. Each should also
  commit to a distinct palette identity (the blue-wash failure mode is
  real).
- DUST FATIGUE (human, 2026-08-18): the pool over-uses dust/powder for
  mid/high energy. New candidates should explore other mid/high
  vocabularies: filaments, lightning arcs, caustics, iridescent shimmer,
  glints, curtain ripples, fibers, crack networks. Snare powder stays
  available in existing winners; don't add new dust media.
- Celestial appetite (human, 2026-08-18): nebula/celestial imagery is
  wanted. Shadertoy technique families worth raiding: Star Nest-style
  Kali-fold starfields, iq FBM volumetric clouds/nebulae, nimitz-style
  aurora curtains (layered sine ridges + triangle-noise), raymarched
  emission volumes, gravitational-lens distortion.
- FLAT APPETITE (human, 2026-08-18, gen-10): the strong presets are all
  glowy/spacey (swirling fluids, particles, additive haze). Wanted: FLAT
  design — solid matte fills, hard edges, committed 3-5 color schemes,
  motion by transforms and color swaps, flat-shaded polygon depth
  (Vissonance tradition: Iris/Barred/HillFog/Tricentric). Less noisy ≠
  static: pops, flips, wipes, scheme swaps encouraged.
- Human appetite (2026-08-18, gen-7): CRT aesthetics (scanlines, phosphor
  triads, barrel distortion, channel-glitch transitions) and HYPNOTIC
  SPIRALS — reference implementation `~/spiral-vr/generate.py` (log-spiral
  field arms*theta + twist*log(r); counter-rotating spirals multiplied =
  moire; pinwheel/checker/mandala variants; analytic band antialiasing,
  fade to gray past Nyquist).
- Engine idioms to reuse (voyage.ts/odyssey.ts): unsharp feedback tap,
  chroma-preserving soft knee (never per-channel clamp), per-axis seed
  mixing in hashes, traveling kick ripple that LIGHTS what it passes,
  charged horizon ring (2.5 s decay), localized (not broad) lens swirl.

## Motion smoothness rule (all briefs, 2026-08-18)

VELOCITY and rate terms must never ride instantaneous levels — the
8ms-attack bands jerk with every transient and read as erratic motion
(human note; the hypno jitter was the same class). Frames now ship
`bandsSlow` (~350ms attack / ~700ms release): use
`frame.bandsSlow ?? frame.bands` for anything that moves — rotation
rates, travel speed, zoom, churn, flow — and keep instantaneous
`bands`/`impulse` for brightness, displacement punches, and spawns.
Local smoothing (τ ≥ 0.3s) is fine where a different constant is
needed; per-frame speed discontinuities are the failure.

## Feedback contraction rule (all briefs with feedback buffers)

The feedback field must stay CONTRACTIVE: never multiply the persistent
field by a sustained factor > 1 (drop/swell-scaled grades compound
frame-over-frame until the soft knee pegs the whole screen — the
chameleon-white / materia-beat-pink washouts). Cap any whole-field grade
at min(x, 0.99); put drop/buildup drama in the FRESH injection scaling,
which is bounded by (1 - decay). Related: transient accents added every
frame need either an envelope that returns to zero or (1 - decay)
normalization — a constant additive term accumulates to 1/(1-decay).
Keep bank/palette mean luminance comparable across banks (a 2x-brighter
bank reads as a periodic washout when cuts land on it).

## Hard safety rule (all briefs, non-negotiable)

Photosensitivity floor (WCAG 2.3.1): no more than 3 full-field luminance
flashes per second, never saturated-red strobing. Rate-limit any
fullscreen flash envelope; localized pulses are exempt.

## Judging aids

Debug HUD in the viz window: press `h` (grid tiers, impulses,
drop/buildup, centroid, deck levels) — useful when calibrating candidates
against what the signals actually did.

## Brief template

```
Candidate: g<NN>-<slug>   Kind: tweak|combine|novel
Parents: <ids + one-line what each is>
Human notes in play: <verbatim quotes driving this candidate>
Instruction: <the creative ask — specific for tweaks, open for novels>
Contract: default-export VisualizerPreset; frame fields available:
bands/impulse/trend/centroid/beat/decks/spectrum/wave/params/time/dt.
Hard rules: self-contained file; GL via createGlRenderer (context-loss
safe); chroma-preserving soft knee for feedback presets; no protocol or
bridge changes; bright saturated colors.
```

## Gen-2 themes (human direction, 2026-08-18)

1. **Spectral shape → visual quality**: centroid was the start; `spread`
   (how WIDE the sound is) and `flatness` (tonal vs noisy) now ship in
   frames (bands.ts, tested). Assign candidates that map them beyond hue:
   palette breadth, geometry dispersion, edge softness/blur, saturation,
   texture graininess. A tonal bassline and a noise sweep should LOOK
   like different materials.
2. **Evolution in phrases**: in-phrase continuous development (Odyssey's
   swell/twist/anticipation) applied to more scene families — nothing
   should loop statically across a phrase.
3. **Dramatic phase shifts**: section boundaries as THEATRE — scene-scale
   transformations (mode/topology/palette regime changes, inversions,
   collapses), bigger than anything mid-phrase. Odyssey's genome is the
   prior art; push it further and into other engines.

## Gen-6 idea bank (gpt-5.6-sol fresh-eyes review, 2026-08-18)

Full review: `.editspace/handoffs/2026-08-18-gpt56sol-viz-review.md`.
Concepts (each brief-ready in the review): Tectonic Mix (deck-owned
continental plates at the crossfader seam), Kinetic Loom (24 bands as
warp threads, weave topology per section), Neon Orrery (bands as nested
orbital mechanisms, springs wind with phrase), Cut-Paper Theatre (Story's
narrative in layered-silhouette language), Liquid Equalizer Foundry
(band-owned material pours into a casting mold), Stereo Calligraphy
(stereo waveform as two braided calligraphic strokes), Cathedral of
Negative Space (architecture built from darkness, no camera nausea),
Harmonic Reef (BLOCKED on chroma seam), Shadow Pinball (playful
spectrum-shaped machine per song). Earlier bank still open: Clay, Neon
Web, Signal, Mood, Anticipation, Chroma-sky (chroma seam), Harmonic
Weave.

## Policy amendments (adopted from the sol review)

- **No breeding past unjudged cohorts**: a generation's candidates need
  votes before they may parent. Gen-6 waits for g04+g05 judgments.
- **Parenthood eligibility floor**: a candidate needs ≥3 distinct
  opponents before its rating can drive parent selection; fresh 1000s
  never outrank tested survivors.
- **Diversity slots**: every generation reserves ≥2 topology-novel
  candidates (no champion source inheritance) and 1 fossil-recombination
  from an abandoned family (architecture, organic, waveform, narrative).
- **Decorrelate mutations**: within one generation, don't repeat the same
  swap vocabulary across parents (gen-5 over-spent on cracks/glass);
  vary the axis — element, engine, topology, dynamics, temporal grammar.
- **Phenotype tags**: new manifest entries carry coarse tags (topology,
  rendering family, focal layout, motion grammar, material, temporal
  grammar, signals-used); novelty pressure is applied against recent
  tags, not just parent ids.
- **Concept vs execution**: a death from a failed implementation may
  justify one clean-room remake of the concept; repeated engine-level
  failures stop consuming tweak slots.
- **Brief format**: state one falsifiable question, invariants, the 2-3
  degrees of freedom, assigned tech, and anti-resemblance constraints;
  standing law stays in this kit, not restated per brief.

## Proposed by the sol review — needs human sign-off

- ~~Elo semantics~~ ADOPTED 2026-08-18 (see fold rules above). Still
  open from that bullet: anchor-pair replay for drift; a solo-review
  round before pairwise voting.
- Pre-arena calibration pass (auto-reject blank frames, quiet-state
  glare, camera-velocity nausea, plateau collapse) before human votes.
- ~~Parameter genotype~~ ADOPTED 2026-08-18 (human ask): each solo-flow
  load presents jittered param values (soloReview.ts sampleParamValues:
  15% full-range exploratory, else gaussian around file defaults,
  σ=0.22·range); verdicts snapshot the shown values. FOLD PROCEDURE:
  for a candidate with ≥3 liked solo samples, move its FILE defaults
  (in-place refinement) toward the like-weighted mean of sampled values,
  ignoring dislike samples; note the retune in the manifest entry.
- Multi-stimulus judging (quiet/tonal, noisy buildup, drop plateau,
  sparse/vocal, transition) instead of the single reference loop.

## Tech-seam queue (sol review, priority order — all additive/optional)

1. **structure block** (SSM novelty): `novelty` (continuous), `boundaryPulse`,
   `boundaryAgeS`, `confidence`, monotonic `sectionId` — separate clock from
   ladder tiers ("music changed" vs "meter rolled over").
1b. **tonality** (human ask 2026-08-18): melodic-vs-percussive axis.
   Derivable in-preset today (flatness EMA + impulse-density window —
   g08-chameleon is the probe); promote to a shared seam if more
   candidates want it (windowed 0.5-1s, attack/release like the
   dominance stepper).
2. **chroma distribution**: 12 normalized bins + `chromaEnergy`/`chromaConfidence`
   (+`tuningOffset`), attack/release smoothing, freeze under low confidence;
   no hard key labels. Unblocks Harmonic Reef / Chroma-sky.
3. **onset events**: per-band monotonic onset ids + `onsetAgeS`/`onsetStrength`/
   `onsetDensity` — kills fragile retrigger thresholds.
4. **stereo descriptors**: `width`/`correlation`/`balance`/mid-side energies
   (shared, cheap) so spatial grammar doesn't require wantsWave.
5. **spectral motion**: band-normalized `spectralFlux`, signed centroid/spread
   velocities.
6. **relative dynamics**: track-adaptive loudness percentile, crest factor,
   transient-to-sustain ratio (freeze adaptation across deck changes).
7. **canonical regime decomposition**: shared continuous buildup/dropTransition/
   sustained/breakdown values (standardizes "ride max(drop,energy)").
8. **per-deck reactive summaries**: low/mid/high levels + impulses per deck
   (which deck produced the kick) — coarse, not 4×24 bands.
9. **provenance/quality block**: live-vs-fallback, grid confidence, analysis
   age, master-vs-dominant-deck source.

## Promotion

On a `promote` event (human hit `[`/`]`): give the candidate a proper
name, move the file into `presets/` (drop `.candidate`), register in
`presets/index.ts`, set manifest status `promoted`. Ships through normal
review like any curated preset.

## Judging reference

Default stimulus: a looped reference segment with intro/buildup/drop
(human loops it on a deck); any audio is allowed. Votes are sparse by
design — selection pressure, not exhaustive ranking.

## Handoff

Everything an orchestrator needs is this file + the manifest + briefs +
events. On session handoff: read this doc, `jj log` the lane, fold
pending events, resume at step 2.
