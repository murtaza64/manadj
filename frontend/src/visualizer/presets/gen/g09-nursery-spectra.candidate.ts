/**
 * g09-nursery-spectra (gen-9 tweak of g06-nursery): the stellar NURSERY, now
 * with a SPECTRALLY-INFORMED palette. The gas medium, protostar ignitions,
 * iridescent rim shimmer and magnetic filaments are inherited wholesale from
 * g06-nursery; only the COLOR derivation changes — the nebula now paints
 * itself from the music.
 *
 * Spectral-color vocabulary (gen-9 shared law):
 *   - GAS HUE FAMILY = a SLOW-tracked spectral centroid (~1 s EMA). Bass-heavy
 *     music drifts the gas toward an EMBER nebula (red/amber H-alpha); bright
 *     music drifts toward a BLUE-TEAL oxygen nursery. The hue center moves on
 *     musical timescales, never per-frame flicker.
 *   - PALETTE BREADTH = spread. A narrow (tonal, single-pitch) sound makes a
 *     near-monochrome gas; a wide (full-spectrum) sound gives a rich multi-hue
 *     nebula (the palette phase span opens up with spread).
 *   - SATURATION = (1 - flatness). Tonal passages stay chromatic and vivid;
 *     noisy/flat passages BLEACH the gas toward pale, ashen cloud.
 *
 * Ignitions & supernova stay music-derived:
 *   - PROTOSTAR IGNITIONS (low/kick) flare in the CURRENT hue family — a hot
 *     white core with a bloom tinted by the live gas hue, not a fixed palette.
 *   - SUPERNOVA (section boundary) recolors to the spectral COMPLEMENT of the
 *     LAST section's mean hue (a drastic, chromatic, music-derived swing: an
 *     ember section detonates into teal, a teal section into ember). The whole
 *     gas regime crossfades to the complement over ~1.2 s.
 *
 * Filament / rim shimmer highs are unchanged in mechanic; they simply read the
 * live gas hue for their tint. Feedback stays a slow emission memory only
 * (chroma-preserving soft knee, contractive: whole-field memory gain capped
 * < 1, drama in the fresh injection). NOT a feedback-warp tunnel.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const CORE_COUNT = 5;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: gas convection rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // instantaneous centroid (shimmer bias)
uniform float u_spread;     // gas breadth
uniform float u_drop;       // bass-weighted smoothed drop
uniform float u_sustain;    // sustained loudness (ride the plateau)
uniform float u_buildup;    // excitement without bass (tense compression)
uniform float u_phrase;     // 0..1 ramp within the current phrase (enrich)
uniform float u_novaMix;    // 0..1 crossfade old hue family -> complement
uniform float u_nova;       // supernova shell strength (decays)
uniform float u_novaAge;    // seconds since detonation (front radius)
uniform vec2 u_novaPos;     // detonation center (aspect-space)
uniform float u_seed;
uniform float u_density;    // param: gas density
uniform float u_filaments;  // param: filament gain
uniform float u_drift;      // param: drift speed
uniform float u_glow;       // param: emission memory (feedback gain)
// SPECTRAL COLOR STATE (derived on the JS side, slow / boundary timescales):
uniform float u_hueOld;     // gas hue family (turns) BEFORE the last supernova
uniform float u_hueNew;     // gas hue family (turns) AFTER the last supernova
uniform float u_breadth;    // palette hue-span in turns (from spread)
uniform float u_sat;        // gas saturation (from 1 - flatness)
// Live protostar cores: xy = position (aspect-space), z = age/ignition,
// w = illumination-front launch time (seconds since kick that lit it).
uniform vec3 u_cores[${CORE_COUNT}];      // xy pos, z ignition 0..1
uniform vec3 u_coreFront[${CORE_COUNT}];  // x frontAge, y frontAmp, z hue

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise with per-axis seed mixing (no diagonal moire).
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

// iq-style FBM: 5 octaves, gas volume density.
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.1, 7.3);
    amp *= 0.5;
  }
  return v;
}

// nimitz triangle noise (for filament ridges): |fract| tent.
float tri(float x) { return abs(fract(x) - 0.5); }

// HSV -> RGB (saturated, bright). Hue in turns (0..1).
vec3 hsv2rgb(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

// The live gas hue family, crossfading from the pre-supernova family to the
// post-supernova complement. Hue interpolation goes the short way around the
// wheel so the swing reads as a rotation, not a wash through gray.
float gasHueCenter() {
  float d = u_hueNew - u_hueOld;
  d -= floor(d + 0.5); // shortest signed arc in turns
  return u_hueOld + d * clamp(u_novaMix, 0.0, 1.0);
}

// The spectrally-informed gas palette. t is a travel coordinate; the hue rides
// the family center + a BREADTH-scaled excursion (narrow sound -> monochrome,
// wide -> multi-hue). Saturation from (1 - flatness). Bright, fully saturated.
vec3 gasPalette(float t) {
  float hueC = gasHueCenter();
  // Breadth opens the hue span; the travel coordinate carries the excursion.
  float hue = hueC + (t - 0.5) * u_breadth;
  // A little tonal shift so cores/lit gas warm toward white cleanly.
  float sat = clamp(u_sat, 0.12, 1.0);
  return hsv2rgb(hue, sat, 1.0);
}

// Iridescent shimmer: a thin-film spectrum from a phase; carried by highs.
vec3 iridescent(float phase) {
  return 0.55 + 0.45 * cos(TWO_PI * (phase + vec3(0.0, 0.33, 0.66)));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // Off-axis composition: origin biased left/low so the pillar field rises
  // from a corner rather than a centered mandala.
  vec2 c = (uv - vec2(0.32, 0.38)) * vec2(aspect, 1.0);
  float t = u_time * u_drift;
  vec2 px = 1.0 / u_res;

  // ---- Feedback: SLOW emission memory only. Sample the same pixel (no
  // advection warp), unsharp against a 4-tap blur so ignitions leave a
  // fading glow trail without smearing into a tunnel. Chroma-preserving.
  vec3 prev = texture2D(u_prev, uv).rgb;
  vec3 blur = (texture2D(u_prev, uv + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, uv - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, uv + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, uv - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 memory = max(vec3(0.0), prev * 1.06 - blur * 0.06);
  // Contractive: whole-field memory gain capped strictly below 1.
  float memGain = clamp(0.60 + 0.30 * u_glow, 0.0, 0.93);
  vec3 col = memory * memGain;

  // ---- GAS VOLUME: two pseudo-raymarch FBM layers with domain-warp churn
  // driven by mids (convection). Buildup COMPRESSES the gas (tighter,
  // higher contrast). Spread already widened the palette; here it also lets
  // the sampled travel coordinate roam more.
  float compress = 1.0 + 0.7 * u_buildup + 0.25 * u_phrase;
  vec2 warp = vec2(
    fbm(c * 1.6 + vec2(0.0, t * 0.18)),
    fbm(c * 1.6 + vec2(5.2, 3.1) - t * 0.14)
  ) - 0.5;
  // motion: slow bands (erratic-motion law) — gas convection rate
  float convection = (0.25 + 0.9 * u_midSlow + 0.4 * u_sustain);
  vec2 gp = c * compress + warp * convection * 0.55;

  // Layer A: broad shells of gas.
  float shell = fbm(gp * 1.5 + vec2(t * 0.05, -t * 0.03));
  // Layer B: finer pillars (stretched vertically -> pillar structure).
  float pillar = fbm(vec2(gp.x * 2.4, gp.y * 1.1) + vec2(-t * 0.04, t * 0.02));
  float gas = pow(clamp(shell * 0.6 + pillar * 0.7, 0.0, 1.4), 1.7);
  gas *= (0.5 + 1.1 * u_density);

  // Gas color travels across the spectrally-derived family. The travel
  // coordinate spans position + shell so the nebula is multi-hued when wide.
  float palT = shell * (0.6 + 0.9 * u_spread) + gp.y * 0.20 + gp.x * 0.08
    + t * 0.015;
  vec3 gasColor = gasPalette(palT);
  // Dark-sky floor: gas reads against near-black, brightens with energy.
  float gasGain = 0.10 + 0.9 * u_mid + 0.5 * u_sustain + 0.35 * u_drop;
  col += gasColor * gas * gasGain;

  // ---- IRIDESCENT RIM SHIMMER (HIGH): the gradient magnitude of the gas
  // gives cloud edges; a thin-film spectrum races along them, phase driven
  // by highs + centroid. This carries high-frequency response (no dust).
  float gx = fbm(gp * 1.5 + vec2(px.x * 40.0, 0.0)) - shell;
  float gy = fbm(gp * 1.5 + vec2(0.0, px.y * 40.0)) - shell;
  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
  float shimPhase = shell * 2.0 + u_centroid * 0.8 + t * 0.4
    + u_high * 3.0;
  vec3 rim = iridescent(shimPhase);
  float shimmer = edge * (0.4 + 0.6 * sin(t * 9.0 + shell * 30.0));
  col += rim * shimmer * (0.05 + 1.6 * u_high) * (0.4 + 0.6 * gas);

  // ---- MAGNETIC FILAMENTS (HIGH): nimitz layered sine ridges + triangle
  // noise — thin glowing threads that ripple. Diagonal across the field.
  float fil = 0.0;
  float famp = 1.0;
  vec2 fp = c * 1.0;
  for (int i = 0; i < 3; i++) {
    // ridged sine with triangle-noise perturbation.
    float ridge = fp.y * 3.0 + sin(fp.x * 4.0 + t * 1.3) * 1.2
      + tri(fp.x * 2.0 - t * 0.5) * 3.0;
    float thread = 1.0 - smoothstep(0.0, 0.10, abs(fract(ridge) - 0.5));
    fil += thread * famp;
    famp *= 0.55;
    fp = fp * 1.9 + vec2(1.7, -0.9);
    fp = mat2(0.80, -0.60, 0.60, 0.80) * fp;
  }
  fil = pow(clamp(fil, 0.0, 1.0), 1.5);
  float filRipple = 0.6 + 0.4 * sin(t * 12.0 + c.x * 20.0);
  // Filaments read the live gas family, warmed a touch toward iridescence.
  vec3 filColor = mix(iridescent(u_centroid + t * 0.15), gasPalette(0.7 + t * 0.05), 0.55);
  col += filColor * fil * filRipple * u_filaments * (0.08 + 1.7 * u_high)
    * (0.5 + 0.5 * gas);

  // ---- PROTOSTAR CORES (LOW/KICK): solid compact ignitions inside the
  // gas. Each core: a hot core + a bloom, brightening with its ignition
  // envelope. Ignitions FLARE IN THE CURRENT HUE FAMILY: a white-hot center
  // with a bloom tinted by the live gas hue (music-derived), not a fixed hue.
  for (int i = 0; i < ${CORE_COUNT}; i++) {
    vec3 core = u_cores[i];
    vec3 fr = u_coreFront[i];
    vec2 d = c - core.xy;
    float dist = length(d);
    float ignite = core.z;
    // The bloom's hue rides the current family (fr.z is a per-core travel
    // offset within the palette so cores are not all identical).
    vec3 familyHue = gasPalette(0.35 + fr.z * u_breadth);
    // Solid core: tight gaussian, white-hot center, colored bloom.
    float hot = exp(-dist * dist * (900.0 - 500.0 * ignite));
    float bloom = exp(-dist * (10.0 - 4.0 * ignite));
    vec3 coreHue = mix(LOW, vec3(1.0, 0.95, 0.85), 0.4 + 0.6 * ignite);
    coreHue = mix(coreHue, familyHue, 0.45);
    col += coreHue * hot * (0.6 + 1.6 * ignite);
    col += mix(coreHue, familyHue, 0.5) * bloom * (0.15 + 0.7 * ignite);
    // Traveling illumination front: a spherical shell expanding from the
    // core, lighting gas it passes. exp decay in age + amplitude.
    float frontR = 0.02 + fr.x * 0.85;
    float front = exp(-pow((dist - frontR) * 8.0, 2.0)) * exp(-fr.x * 2.2) * fr.y;
    col += mix(familyHue, gasColor, 0.6) * front * (0.5 + 2.0 * gas) * 1.3;
  }

  // ---- SUPERNOVA (section boundary): a shell shockwave from u_novaPos.
  // Its job is CHROMATIC — the gas family is crossfading to the spectral
  // COMPLEMENT of the last section's mean hue (handled in gasHueCenter) —
  // plus a physical shell: a bright ring lighting the freshly-recolored gas,
  // rate-limited so it is a sweep, not a full-field flash.
  if (u_nova > 0.001) {
    vec2 nd = c - u_novaPos;
    float ndist = length(nd);
    float shellR = 0.03 + u_novaAge * 1.4;
    float shellRing = exp(-pow((ndist - shellR) * 6.0, 2.0)) * u_nova;
    // The freshly-recolored palette rides the shell.
    vec3 novaHue = gasPalette(0.2 + ndist * 0.4 + t * 0.05);
    col += novaHue * shellRing * (0.8 + 1.5 * gas);
    // Faint enrichment: the shell leaves brightened gas behind it.
    float wake = smoothstep(shellR, shellR - 0.4, ndist) * u_nova * 0.15;
    col += novaHue * gas * wake;
  }

  // ---- Snare texture: a soft convection lift (NOT particles) — a brief
  // brightening of the gas convection, mid-transient owned.
  if (u_snare > 0.03) {
    col += gasColor * gas * u_snare * 0.25;
  }

  // Buildup tension: gas contrast up, overall slightly dimmed (tense-but-
  // alive, never eerily still). Drop/sustain bloom.
  col *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.06 * u_buildup;

  // Palette grade: whole frame leans to the current gas family so recolors
  // read across the field (still bounded, chroma-preserving).
  vec3 grade = gasPalette(0.5);
  col = mix(col, col * (0.45 + grade * 1.5), 0.20);

  // Photosensitivity + chroma-preserving soft knee (never per-channel).
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

interface Core {
  x: number;
  y: number;
  ignition: number;
  frontAge: number;
  frontAmp: number;
  hue: number;
}

const candidate: VisualizerPreset = {
  id: 'g09-nursery-spectra',
  name: 'g09 nursery-spectra',
  hiRes: true,
  params: [
    { id: 'density', label: 'gas density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'filaments', label: 'filament gain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'drift', label: 'drift speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'glow', label: 'emission memory', min: 0, max: 1.5, step: 0.05, default: 0.9 },
  ],
  create: () => {
    let lastTime = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSustain = 0;
    // Supernova state.
    let nova = 0;
    let novaAge = 999;
    let novaPos: [number, number] = [0, 0];
    // Phrase tracking.
    let lastBarInPhrase = -1;
    let phraseStartBar = 0;
    let lastSection = -1;

    // ---- SPECTRAL COLOR STATE ----
    // Slow-tracked centroid (~1 s EMA) -> gas hue family. Bass (low centroid)
    // maps to ember (~0.02 turns, red/amber); bright (high centroid) maps to
    // blue-teal (~0.52 turns). Held on musical timescales.
    let slowCentroid = 0.5;
    // The live hue family + the family we crossfade FROM on a supernova.
    let hueNew = 0.5; // current gas family center (turns)
    let hueOld = 0.5; // pre-supernova family (crossfade source)
    let novaMix = 1; // 0 just detonated .. 1 fully arrived at complement
    // Smoothed breadth (spread) + saturation (1 - flatness).
    let smoothBreadth = 0.3;
    let smoothSat = 0.85;
    // Running mean of the gas family hue over the CURRENT section, so the
    // supernova can jump to its spectral complement.
    let sectionHueMean = 0.5;

    const centroidToHue = (cn: number): number => {
      // Ember (0.02) at cn=0 -> blue-teal (0.52) at cn=1, smooth ramp.
      const c = Math.min(1, Math.max(0, cn));
      return 0.02 + 0.5 * c;
    };

    // The protostar core field — off-axis, seeded pseudo-randomly. Each
    // section boundary detonates the OLDEST and re-seeds one.
    const rand = (seed: number) => {
      const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const seedCore = (i: number, gen: number): Core => ({
      // Off-axis field: bias toward the rising pillar region.
      x: (rand(i * 3.7 + gen * 11.3) - 0.4) * 1.4,
      y: (rand(i * 5.1 + gen * 7.9) - 0.35) * 1.1,
      ignition: 0,
      frontAge: 999,
      frontAmp: 0,
      hue: rand(i * 2.3 + gen * 4.1),
    });
    let coreGen = 0;
    const cores: Core[] = [];
    for (let i = 0; i < CORE_COUNT; i++) cores.push(seedCore(i, 0));
    let oldestIndex = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const bands: BandLevels = frame.bands;
        const impulse: BandLevels = frame.impulse;
        const trend: EnergyTrend = frame.trend;
        const beat: BeatInfo | null = frame.beat;

        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(bands);
        // motion: slow bands (erratic-motion law)
        const motion = frame.bandsSlow ?? bands;

        // Bass-weighted smoothed DROP signal (trend has no drop field):
        // excitement gated by bass presence, ~0.35 s smoothing. Buildup =
        // excitement WITHOUT bass. Sustain rides the plateau.
        const lowPresence = Math.min(1, Math.max(0, (bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustainTarget = Math.min(1, energy * 1.4);
        smoothSustain += (sustainTarget - smoothSustain) * alpha;

        // ---- SPECTRAL COLOR: slow-track the centroid (~1 s) into a hue
        // family; smooth breadth (spread) and saturation (1 - flatness) so
        // the palette morphs on musical timescales, not per-frame flicker.
        const slowAlpha = 1 - Math.exp(-dt / 1.0);
        slowCentroid += (frame.centroid - slowCentroid) * slowAlpha;
        const paletteAlpha = 1 - Math.exp(-dt / 0.6);
        // Breadth: narrow (spread~0) -> tiny hue span; wide -> up to ~0.5 turn.
        const breadthTarget = 0.05 + 0.55 * Math.min(1, Math.max(0, frame.spread));
        smoothBreadth += (breadthTarget - smoothBreadth) * paletteAlpha;
        // Saturation: noisy (flatness high) bleaches toward pale gas.
        const satTarget = 0.25 + 0.75 * (1 - Math.min(1, Math.max(0, frame.flatness)));
        smoothSat += (satTarget - smoothSat) * paletteAlpha;

        // The current gas family center tracks the slow centroid EXCEPT while
        // a supernova crossfade is in flight (then hueNew is the complement,
        // pinned until the next boundary re-tracks it).
        const trackedHue = centroidToHue(slowCentroid);
        if (novaMix >= 1) {
          // Between supernovae, let the family drift with the slow centroid.
          hueNew += (trackedHue - hueNew) * slowAlpha;
          hueOld = hueNew;
        }

        // Running mean of the live family over this section (for the complement).
        sectionHueMean += (hueNew - sectionHueMean) * (1 - Math.exp(-dt / 2.0));

        // Phrase / section tiers off the ladder (fallback to barIndex).
        const barIndex = beat ? (beat.ladderBarIndex ?? beat.barIndex) : 0;
        const section = Math.floor(barIndex / 16);
        const barInPhrase = ((barIndex % 4) + 4) % 4;
        if (barInPhrase !== lastBarInPhrase) {
          if (barInPhrase === 0) phraseStartBar = barIndex;
          lastBarInPhrase = barInPhrase;
        }
        // Continuous phrase ramp (enrich bar by bar) using bar phase.
        const barPhase = beat ? beat.barPhase : 0;
        const phraseProgress = Math.min(1, ((barIndex - phraseStartBar) + barPhase) / 4);

        // SECTION BOUNDARY -> SUPERNOVA: detonate the oldest core, recolor to
        // the spectral COMPLEMENT of the last section's mean hue (half a turn
        // around the wheel — drastic, chromatic, music-derived).
        if (section !== lastSection) {
          if (lastSection >= 0) {
            hueOld = hueNew;
            const complement = ((sectionHueMean + 0.5) % 1 + 1) % 1;
            hueNew = complement;
            novaMix = 0; // crossfade old family -> complement over ~1.2 s
            // Reset the section running mean to the new family.
            sectionHueMean = hueNew;
            nova = 1;
            novaAge = 0;
            novaPos = [cores[oldestIndex].x, cores[oldestIndex].y];
            // Re-seed the detonated core as a new generation.
            coreGen += 1;
            cores[oldestIndex] = seedCore(oldestIndex, coreGen);
            oldestIndex = (oldestIndex + 1) % CORE_COUNT;
          }
          lastSection = section;
        }
        // Supernova crossfade settles over ~1.2 s (chromatic recolor sweep).
        novaMix = Math.min(1, novaMix + dt / 1.2);
        // Supernova shell expands and decays.
        novaAge += dt;
        nova = Math.max(0, nova - dt / 1.6);

        // Cores: ignition envelope rises with sustained lows + drop; on a
        // kick, the strongest-lit cores launch an illumination front. Drop
        // triggers MULTIPLE ignitions.
        const kick = impulse.low;
        const igniteTarget = Math.min(1, bands.low * 0.9 + smoothDrop * 0.6);
        const kickHit = kick > 0.32;
        for (let i = 0; i < CORE_COUNT; i++) {
          const co = cores[i];
          // ignition follows a smoothed target, faster on rise.
          const ia = co.ignition < igniteTarget ? 1 - Math.exp(-dt / 0.12) : 1 - Math.exp(-dt / 0.7);
          co.ignition += (igniteTarget - co.ignition) * ia;
          co.frontAge += dt;
          // On a kick, launch a front. On a drop, all cores fire; otherwise
          // a bass-strength gated subset (deterministic per-core phase).
          const coreFires =
            kickHit &&
            co.frontAge > 0.14 &&
            (smoothDrop > 0.25 || rand(i * 9.1 + Math.floor(frame.time)) < 0.45 + 0.5 * kick);
          if (coreFires) {
            co.frontAge = 0;
            co.frontAmp = Math.min(1, kick * 1.3);
          }
        }

        // Pack core uniforms (position, ignition) and front (age, amp, hue).
        const coreArr = new Float32Array(CORE_COUNT * 3);
        const frontArr = new Float32Array(CORE_COUNT * 3);
        for (let i = 0; i < CORE_COUNT; i++) {
          const co = cores[i];
          coreArr[i * 3 + 0] = co.x;
          coreArr[i * 3 + 1] = co.y;
          coreArr[i * 3 + 2] = co.ignition;
          frontArr[i * 3 + 0] = co.frontAge;
          frontArr[i * 3 + 1] = co.frontAmp;
          frontArr[i * 3 + 2] = co.hue;
        }

        return {
          u_time: frame.time,
          u_low: bands.low,
          u_mid: bands.mid,
          u_midSlow: motion.mid, // motion: slow bands (erratic-motion law)
          u_high: bands.high,
          u_kick: impulse.low,
          u_snare: impulse.mid,
          u_centroid: frame.centroid,
          u_spread: frame.spread,
          u_drop: smoothDrop,
          u_sustain: smoothSustain,
          u_buildup: smoothBuildup,
          u_phrase: phraseProgress,
          u_novaMix: novaMix,
          u_nova: nova,
          u_novaAge: novaAge,
          u_novaPos: novaPos,
          u_seed: Math.floor(frame.time * 20),
          u_density: frame.params.density ?? 1,
          u_filaments: frame.params.filaments ?? 1,
          u_drift: frame.params.drift ?? 1,
          u_glow: frame.params.glow ?? 0.9,
          u_hueOld: hueOld,
          u_hueNew: hueNew,
          u_breadth: smoothBreadth,
          u_sat: smoothSat,
          u_cores: coreArr,
          u_coreFront: frontArr,
        };
      },
    });
  },
};

export default candidate;
