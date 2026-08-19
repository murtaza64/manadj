/**
 * "g02 verdant" (genetic arena, generation 02 — novel, song-genome family):
 * a LIVING flora/coral system that grows out of the feedback buffer. The
 * frame's genome picks the SPECIES — the dominant deck's trackId hashes into
 * a branching angle, a symmetry count, a palette family and a growth chirality;
 * the slow spectral stats push it toward petals (smooth/tonal) or spines
 * (noisy/flat), and avg spread sets the branching density (sparse succulent ↔
 * dense fern). bpm sets the growth-pulse cadence so 174 pushes tendrils at a
 * different rhythm than 122.
 *
 * The organism lives in u_prev: each frame ADVECTS the accumulated growth
 * outward along the branch field (a curl of radial creep + angular twist), so
 * pigment doesn't translate — it grows, like a time-lapse of a vine. Fresh
 * growth is stamped at the living FRONTIER (the bright rim of what already
 * exists), never at fixed positions, so nothing loops: phase-desynchronized
 * growth oscillators (each symmetry arm carries its own irrational phase) keep
 * the plant perpetually unfolding.
 *
 * Musical life:
 *  - PHRASES grow the organism — the growth radius swells across the 4-bar
 *    phrase, with a last-bar BUD-SWELL anticipation that tightens and brightens
 *    the frontier before it bursts.
 *  - SECTIONS bloom/molt: every 16 bars the species partially re-hashes
 *    (a molt) — palette regime, branch angle and chirality lurch.
 *  - TRACK CHANGE = germination: the old organism dissolves (advection creep
 *    slams inward, decay drops) and a NEW species germinates from a seed point
 *    over ~2 s — the whole re-genesis is the spectacle.
 *  - DROPS: a full-field BLOOM burst (every arm flowers at once) + a SOLID
 *    root-pulse from the core (kick/bass land as structure, not sparkle).
 *  - BUILDUPS: accelerating growth cadence + a saturation surge — tense AND
 *    vibrant, colors ramp hot, tendrils quicken, tension rings accumulate.
 *  - KICKS: a traveling wave rides UP the stems (a bright pulse that climbs
 *    the branch field and lights the medium it passes).
 *  - SNARE POWDER: spores/pollen — fine drifting specks in the canopy.
 *
 * Assigned tech (marathon coverage): deck state (trackId genome + rebirth),
 * bpm growth cadence, phrase/section tiers (beat.barIndex), spectral
 * spread/flatness → species material, drop/buildup split, per-band impulses.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

/** Positive modulo — barIndex can be negative before the first downbeat. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** splitmix32-style integer hash → stable [0,1). Same trackId ⇒ same look. */
function hash01(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/**
 * Six stable genome scalars in [0,1] derived from an integer seed. Same
 * trackId ⇒ same organism, every play. The `salt` lets a section MOLT re-hash
 * a subset without a full rebirth.
 */
function genomeFrom(seed: number): number[] {
  const g: number[] = [];
  for (let i = 0; i < 6; i++) g.push(hash01(seed + i * 0x9e3779b9));
  return g;
}

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_energy;
uniform float u_decay;

// --- genome (structural, from trackId hash + slow stats) ---
uniform float u_symmetry;    // 3..9 growth arms
uniform float u_branchAngle; // base branch spread
uniform float u_density;     // branching density (avg spread)
uniform float u_spine;       // 0 = petals (tonal), 1 = spines (noisy/flat)
uniform float u_chirality;   // -1..1 growth twist handedness
uniform float u_palette;     // 0..3 palette family blend
uniform float u_material;    // flatness-driven edge softness/grain

// --- continuous genome ---
uniform float u_cadence;     // bpm-scaled growth-pulse rate
uniform float u_temp;        // centroid → palette temperature

// --- evolution / tiers ---
uniform float u_phrase;      // 0..1 within the 4-bar phrase
uniform float u_budSwell;    // last-bar anticipation, 0..1
uniform float u_section;     // 0..1 within the 16-bar section
uniform float u_molt;        // section-boundary molt flash, 0..1
uniform float u_germinate;   // track-change germination, 0..1 (1 = fresh seed)

// --- live ---
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // traveling stem wave trigger strength
uniform float u_kickAge;     // seconds since the last strong kick
uniform float u_snare;       // spore gain
uniform float u_drop;        // bloom burst + root pulse
uniform float u_buildup;     // accelerating growth + saturation surge
uniform float u_charge;      // accumulated kick energy at the root
uniform float u_seed;        // per-frame jitter seed
uniform vec2 u_spore[10];    // spore positions (canopy)

const float PI = 3.14159265;
const float TWO_PI = 6.28318530;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(19.1, 7.3);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palettes: four verdant/coral families that TRAVEL (phase rides
// time + centroid). 0 spring-moss, 1 coral-reef, 2 orchid-bloom, 3 autumn-fire.
vec3 pal0(float t) { return vec3(0.20, 0.42, 0.22) + vec3(0.28, 0.42, 0.24) * cos(TWO_PI * (vec3(0.9, 1.0, 0.7) * t + vec3(0.2, 0.05, 0.35))); }
vec3 pal1(float t) { return vec3(0.55, 0.30, 0.28) + vec3(0.45, 0.30, 0.30) * cos(TWO_PI * (vec3(1.0, 0.8, 0.7) * t + vec3(0.0, 0.25, 0.55))); }
vec3 pal2(float t) { return vec3(0.48, 0.24, 0.46) + vec3(0.40, 0.28, 0.44) * cos(TWO_PI * (vec3(1.0, 0.6, 1.0) * t + vec3(0.1, 0.45, 0.0))); }
vec3 pal3(float t) { return vec3(0.55, 0.34, 0.16) + vec3(0.45, 0.40, 0.24) * cos(TWO_PI * (vec3(1.0, 0.85, 0.5) * t + vec3(0.0, 0.15, 0.35))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  // Buildups saturate + warm (vibrant, not dimmed); the temp genome tilts hue.
  c += vec3(0.10, 0.03, -0.04) * u_buildup + vec3(0.06, 0.0, -0.03) * (u_temp - 0.5);
  return c;
}

// Aspect-corrected field vector from center in square space.
vec2 toField(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= u_res.x / u_res.y;
  return c;
}

// Fold an angle into the genome's symmetry so every arm shares one profile
// but carries a DESYNCHRONIZED phase (irrational per-arm offset) — the plant
// never loops. Returns folded angle in [-PI/N, PI/N] and the arm index.
void foldSymmetry(float ang, float sym, out float folded, out float armId) {
  float seg = TWO_PI / sym;
  float k = floor((ang + PI) / seg);
  armId = k;
  float within = (ang + PI) - k * seg;
  folded = within - seg * 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 field = toField(uv);
  float r = length(field);
  float ang = atan(field.y, field.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  float sym = u_symmetry;

  // --- ADVECTION: growth. Pigment creeps OUTWARD along branches with a
  // chirality twist, so accumulated matter grows like a vine instead of
  // sliding. On germination the creep SLAMS inward (the old organism
  // dissolves toward the seed point).
  float grow = (0.05 + 0.14 * u_energy + 0.10 * u_phrase + 0.18 * u_drop)
    * u_cadence * (1.0 + 0.8 * u_buildup);
  float germPull = u_germinate * (0.9 + 0.6 * (1.0 - r));
  float radial = grow - germPull * 1.4;
  vec2 dir = r > 1e-4 ? field / r : vec2(0.0, 1.0);
  vec2 tangent = vec2(-dir.y, dir.x);
  float twist = u_chirality * (0.30 + 0.5 * u_mid) / (r * 4.0 + 0.5);
  // Branch-field wander: growth veers by the genome's branch angle, phrase-
  // desynchronized so the frontier keeps splitting into new tendrils.
  float wander = sin(ang * sym + t * 0.5 * u_cadence + u_chirality * 3.1)
    * u_branchAngle * (0.4 + 0.6 * u_density);
  vec2 vel = dir * radial + tangent * (twist + wander * 0.04);
  vec2 srcField = field - vel * u_dt * 3.0;
  vec2 src = vec2(srcField.x / aspect, srcField.y) + 0.5;

  // Unsharp feedback tap (anti-mush): keep stems crisp through resampling.
  vec3 prev = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Germination drops decay hard so the previous species collapses cleanly.
  float decay = u_decay - 0.35 * u_germinate;
  vec3 plant = max(vec3(0.0), prev * 1.28 - blur * 0.28) * decay;

  // --- LIVING FRONTIER: fresh growth is stamped at the bright rim of what
  // already exists, following the symmetry arms. Each arm has an irrational
  // phase so the canopy is never mirror-locked.
  float folded; float armId;
  foldSymmetry(ang, sym, folded, armId);
  float armPhase = fract(armId * 0.61803398) * TWO_PI; // golden-ratio desync
  float armOsc = 0.5 + 0.5 * sin(t * (0.6 + 0.8 * u_cadence) + armPhase);

  // The growth radius: swells across the phrase, germinates from the center.
  float reach = 0.14 + 0.30 * u_phrase + 0.22 * u_energy + 0.20 * u_drop;
  reach *= mix(0.15, 1.0, clamp(u_germinate < 0.5 ? 1.0 : (1.0 - u_germinate) * 2.0, 0.0, 1.0));
  reach *= 0.9 + 0.3 * armOsc;

  // Stem/branch profile: petals (smooth wide lobes) ↔ spines (sharp needles),
  // chosen by u_spine (flatness). The fold gives the leaf its silhouette.
  float lobe = cos(folded * (1.5 + 3.0 * u_density));
  float petal = pow(max(0.0, lobe), 2.0);
  float spine = pow(max(0.0, lobe), 12.0 + 30.0 * u_material);
  float leaf = mix(petal, spine, u_spine);

  // Branch veins along the stem — denser with avg spread.
  float veins = 0.5 + 0.5 * sin(r * (18.0 + 40.0 * u_density) - t * u_cadence * 2.0 + armPhase);
  float stem = leaf * smoothstep(reach + 0.06, reach - 0.04, r) * smoothstep(0.02, 0.08, r);
  float frontier = exp(-pow((r - reach) * (10.0 + 12.0 * u_budSwell), 2.0)) * leaf;

  // Fresh pigment: palette travels with r/arm/time/centroid (wide phase span
  // so the canopy is never monochrome). Bud-swell brightens the frontier.
  vec3 leafColor = palette(r * 0.9 + armId * 0.13 + t * 0.02 + u_temp * 0.4);
  vec3 fresh = vec3(0.0);
  float grain = mix(1.0, 0.6 + 0.8 * fbm(field * (40.0 + 60.0 * u_material) + armId), u_material);
  fresh += leafColor * stem * (0.20 + 0.9 * u_mid + 0.5 * u_energy) * (0.4 + 0.6 * veins) * grain;
  fresh += mix(leafColor, vec3(1.0), 0.4 * u_budSwell)
    * frontier * (0.5 + 1.4 * u_energy + 1.2 * u_budSwell + 1.6 * u_drop);

  // --- ROOT / CORE: SOLID low-end structure. The bass grows a pulsing root
  // ball at the seed; kicks pump its charge (ember → white-hot). Never sparkle.
  float rootWarp = u_low * (0.16 * sin(ang * 3.0 + t * 1.4) + 0.10 * sin(ang * 5.0 - t * 2.0))
    + 0.14 * u_kick * sin(ang * sym + t * 7.0);
  float rc = r * (1.0 - rootWarp * exp(-r * 4.0));
  float root = exp(-rc * rc * (200.0 - 90.0 * u_kick));
  vec3 rootColor = mix(vec3(0.35, 0.55, 0.20), vec3(0.9, 0.95, 0.5), clamp(u_charge, 0.0, 1.0));
  rootColor = mix(rootColor, vec3(1.0, 0.97, 0.85), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += rootColor * root * (0.5 + 1.4 * u_low + 1.8 * u_kick + 0.7 * u_charge);
  // Root corona ring — a growth crown that breathes with the bassline.
  float crown = exp(-pow((r - 0.06 - 0.05 * u_low) * 40.0, 2.0));
  fresh += rootColor * crown * (0.2 + 0.9 * u_low + 0.6 * u_kick);

  // --- GERMINATION seed: a bright new sprout at the center during rebirth.
  fresh += palette(u_temp + t * 0.05) * exp(-r * r * 60.0) * u_germinate * 3.0;

  plant += fresh * (1.0 - u_decay) * (3.0 + 1.5 * u_energy + 1.2 * u_drop);

  // --- KICK: a traveling wave that rides UP the stems and LIGHTS the medium.
  // The wavefront climbs the branch field from the root out to the canopy.
  float front = 0.05 + u_kickAge * (0.7 + 0.9 * u_cadence);
  float wave = exp(-pow((r - front) * 12.0, 2.0)) * exp(-u_kickAge * 2.2) * u_kick;
  plant += leafColor * wave * leaf * (1.2 + 1.0 * u_drop);
  plant *= 1.0 + 0.10 * wave; // gentle local lift where the pulse passes

  // --- DROP: full-field BLOOM burst — every arm flowers at once.
  if (u_drop > 0.02) {
    float bloomR = 0.12 + 0.28 * u_drop;
    float bloom = exp(-pow((r - bloomR) * 8.0, 2.0)) * (0.5 + 0.5 * leaf);
    plant += palette(0.3 + t * 0.02 + armId * 0.1) * bloom * u_drop * 1.6;
  }

  // --- SNARE POWDER: spores/pollen drifting in the canopy (mid/high only).
  if (u_snare > 0.02) {
    float spores = 0.0;
    for (int i = 0; i < 10; i++) {
      vec2 sp = toField(u_spore[i]);
      spores += exp(-pow(length(field - sp) * 60.0, 2.0));
    }
    vec3 pollen = mix(palette(0.7 + t * 0.03), vec3(1.0, 0.98, 0.8), 0.4);
    plant += pollen * spores * u_snare * smoothstep(0.08, 0.2, r) * 1.2;
  }

  // --- MOLT flash at section boundaries: a fast desaturating shimmer sweep
  // (localized rings, NOT a full-field strobe — photosensitivity floor).
  float molt = u_molt * exp(-pow((r - fract(t * 0.6)) * 6.0, 2.0));
  plant += palette(u_section + 0.5) * molt * 0.8;

  // --- Buildup tension rings: accumulating concentric pressure that reads
  // as energy WITHOUT releasing (distinct from the drop's bloom).
  float tension = pow(0.5 + 0.5 * sin(r * 30.0 - t * (2.0 + 4.0 * u_cadence)), 3.0);
  plant += palette(0.5 + u_temp * 0.3) * tension * exp(-r * 2.0) * u_buildup * 0.5;

  // Buildups saturate/energize (vibrant), drops bloom, quiet breathes down.
  plant *= 0.80 + 0.40 * max(u_drop, u_energy) + 0.18 * u_buildup;

  // Fine canopy grain, a touch louder through the drop (localized, not flash).
  plant += (hash(gl_FragCoord.xy + fract(t) * 173.0) - 0.5) * (0.010 + 0.016 * u_drop);

  // --- Chroma-preserving soft knee (silk lineage — never per-channel clamp).
  float m = max(plant.r, max(plant.g, plant.b));
  if (m > 0.8) {
    plant *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(plant, 0.0), 1.0);
}
`;

const SPORE_N = 10;

const g02VerdantPreset: VisualizerPreset = {
  id: 'g02-verdant',
  name: 'g02 verdant',
  hiRes: true,
  params: [
    { id: 'growth', label: 'growth rate', min: 0.4, max: 2.2, step: 0.05, default: 1 },
    { id: 'density', label: 'branch density', min: 0.2, max: 1.8, step: 0.05, default: 1 },
    { id: 'persistence', label: 'growth persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette (moss→coral→orchid→fire)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'bloom', label: 'bloom intensity', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;

    // --- genome state (rebirths on trackId change, molts on section) ---
    let currentTrackId: number | null = null;
    let genome = genomeFrom(0x5eed);
    let moltSalt = 0;
    let germinate = 0; // 1 right after a track change, decays to 0 over ~2 s

    // Structural genome, recomputed on rebirth/molt.
    let symmetry = 5;
    let branchAngle = 0.5;
    let chirality = 1;
    let paletteFamily = 1;

    // Slow stats (EMA, tau ~15 s) → continuous genome + pseudo-seed fallback.
    let emaCentroid = 0.5;
    let emaSpread = 0.5;
    let emaFlatness = 0.5;
    let statsInit = false;

    // Evolution / live state.
    let prevBarIndex: number | null = null;
    let molt = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let kickAge = 999;
    let seed = 0;

    const spores: [number, number][] = [];
    for (let i = 0; i < SPORE_N; i++) spores.push([0.5, 0.5]);
    let lastSnare = 0;

    const applyGenome = () => {
      // Salt lets a molt re-hash structure without a full rebirth.
      const g = moltSalt === 0 ? genome : genomeFrom(
        ((currentTrackId ?? Math.floor(emaCentroid * 4096)) ^ (moltSalt * 0x27d4eb2f)) >>> 0
      );
      symmetry = 3 + Math.floor(g[0] * 7); // 3..9 arms
      branchAngle = 0.3 + g[1] * 1.2;
      chirality = g[2] < 0.5 ? -1 : 1;
      // avg flatness → petals (tonal) ↔ spines (noisy); genome bias on top.
      paletteFamily = g[3] * 3;
    };
    applyGenome();

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        seed = Math.floor(frame.time * 20);

        const energy = energyOf(frame.bands);
        const kick = frame.impulse.low;
        const snare = Math.max(frame.impulse.mid, frame.impulse.high);

        // --- Slow stats (EMA, tau ~15 s) → continuous genome. ---
        const sAlpha = 1 - Math.exp(-dt / 15);
        if (!statsInit) {
          emaCentroid = frame.centroid;
          emaSpread = frame.spread;
          emaFlatness = frame.flatness;
          statsInit = true;
        } else {
          emaCentroid += (frame.centroid - emaCentroid) * sAlpha;
          emaSpread += (frame.spread - emaSpread) * sAlpha;
          emaFlatness += (frame.flatness - emaFlatness) * sAlpha;
        }

        // --- DETERMINISTIC SEED: dominant audible deck's trackId. ---
        let dominantTrackId: number | null = null;
        let bestLevel = 0;
        for (const deck of frame.decks) {
          if (deck.playing && deck.level > bestLevel && deck.trackId !== null) {
            bestLevel = deck.level;
            dominantTrackId = deck.trackId;
          }
        }

        // TRACK CHANGE = REBIRTH: stage germination over ~2 s.
        if (dominantTrackId !== null && dominantTrackId !== currentTrackId) {
          currentTrackId = dominantTrackId;
          genome = genomeFrom(dominantTrackId >>> 0);
          moltSalt = 0;
          germinate = 1;
          applyGenome();
        } else if (dominantTrackId === null && currentTrackId === null) {
          // Fallback: freeze the slow stats as a pseudo-seed once they settle.
          const pseudo = Math.floor(emaCentroid * 4096) ^ (Math.floor(emaSpread * 4096) << 6);
          genome = genomeFrom(pseudo >>> 0);
          applyGenome();
        }
        // Germination decays over ~2 s (5 e-folds → clean re-genesis).
        germinate *= Math.exp(-dt / 0.4);
        if (germinate < 0.003) germinate = 0;

        // --- Continuous genome from slow stats. ---
        // avg flatness → texture: smooth/tonal = petals (0), noisy/flat = spines.
        const spineFrac = Math.min(1, Math.max(0, (emaFlatness - 0.3) / 0.5));
        // avg spread → structural density/breadth.
        const densityGenome = (0.4 + emaSpread * 1.2) * (frame.params.density ?? 1);
        // avg centroid → palette temperature.
        const temp = emaCentroid;
        // flatness also drives edge softness/grain material.
        const material = Math.min(1, emaFlatness * 1.2);

        // bpm scales ALL motion/pattern rates (174 ≠ 122).
        const bpm = frame.beat?.bpm ?? 122;
        const cadence = (bpm / 128) * (frame.params.growth ?? 1);

        // --- Excitement split by bass presence (drop vs buildup), smoothed. ---
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // trend.excitement fades over a drop's PLATEAU — ride sustained
        // loudness so the bloom keeps flowering, not just the first seconds.
        const drop = Math.max(smoothDrop, 0.7 * sustained);

        // --- Phrase / section tiers (barIndex). ---
        const beat = frame.beat;
        let phrase = 0;
        let section = 0;
        let budSwell = 0;
        if (beat && beat.barIndex !== null) {
          if (prevBarIndex !== null && beat.barIndex !== prevBarIndex) {
            // SECTION boundary = molt: partial re-hash + flash.
            if (mod(beat.barIndex, 16) === 0) {
              moltSalt = (moltSalt + 1) & 0xff;
              applyGenome();
              molt = 1;
            }
          }
          prevBarIndex = beat.barIndex;
          const barInPhrase = mod(beat.barIndex, 4);
          phrase = (barInPhrase + beat.barPhase) / 4;
          section = (mod(beat.barIndex, 16) + beat.barPhase) / 16;
          // Last-bar BUD-SWELL anticipation: tightens/brightens the frontier
          // through the final bar of the phrase before it bursts.
          if (barInPhrase === 3) budSwell = Math.pow(beat.barPhase, 2);
        } else {
          // Gridless: free-run a slow phrase from time so growth still swells.
          phrase = (frame.time * 0.12 * cadence) % 1;
          budSwell = Math.max(0, phrase - 0.75) * 4;
        }
        molt *= Math.exp(-dt / 0.5);
        if (molt < 0.01) molt = 0;

        // --- Root charge: kicks pump it, bleeds off over ~2.5 s. ---
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + kick * 0.28);

        // --- Traveling stem wave: retrigger on strong kicks. ---
        kickAge += dt;
        if (kick > 0.35 && kickAge > 0.12) kickAge = 0;

        // --- Snare spores: reseed drifting canopy specks on fresh snares. ---
        if (snare > 0.25 && snare > lastSnare + 0.05) {
          for (const s of spores) {
            const a = Math.random() * Math.PI * 2;
            const rr = 0.16 + Math.random() * 0.30;
            s[0] = 0.5 + Math.cos(a) * rr;
            s[1] = 0.5 + Math.sin(a) * rr;
          }
        }
        lastSnare = snare;
        const sporeFlat = new Float32Array(SPORE_N * 2);
        for (let i = 0; i < SPORE_N; i++) {
          sporeFlat[i * 2] = spores[i][0];
          sporeFlat[i * 2 + 1] = spores[i][1];
        }

        // --- Persistence / decay: grow-slower persistence longer. Buildups
        // drain a touch (accelerating growth eats the frontier). ---
        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.990 - 0.006 * energy - 0.006 * buildup;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / persistence),
          u_symmetry: symmetry,
          u_branchAngle: branchAngle,
          u_density: densityGenome,
          u_spine: spineFrac,
          u_chirality: chirality,
          u_palette: (frame.params.palette ?? 1) * 0.5 + paletteFamily * 0.5,
          u_material: material,
          u_cadence: cadence,
          u_temp: temp,
          u_phrase: phrase,
          u_budSwell: budSwell,
          u_section: section,
          u_molt: molt,
          u_germinate: germinate,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: kick,
          u_kickAge: kickAge,
          u_snare: snare,
          u_drop: drop * (frame.params.bloom ?? 1),
          u_buildup: buildup,
          u_charge: charge,
          u_seed: seed,
          u_spore: sporeFlat,
        };
      },
    });
  },
};

export default g02VerdantPreset;
