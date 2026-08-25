/**
 * "g01 odyssey-drift" (candidate, tweak of Odyssey): the phrase-genome
 * engine intact — dust disk, high nebula, snare powder, charged horizon
 * ring, black-hole lens, kick ripples, chromatic aberration, unsharp
 * feedback, film grain — driven by a GENOME that mutates on metric
 * boundaries (phrase/section tiers via barIndex) and evolves continuously
 * between them.
 *
 * This is the CALM cut for deep/melodic sets:
 *   - slower default motion (flight speed / dust / chaos dialled down)
 *   - longer persistence (feedback decays slower, fresh injects softer),
 *     so trails smear into long, patient light
 *   - subtler section OMEN rings (thinner, dimmer, later)
 *   - a new 'dawn' WARP MODE joins the section cycle: instead of zooming
 *     or collapsing, the universe drifts gently UPWARD with a soft outward
 *     lift and almost no spin — a sunrise pan.
 *
 * Assigned tech: phrase/section tiers (beat.barIndex) + spectral centroid
 * (centroid tints the palette phase and the grade more than the parent).
 *
 * Warp modes blend continuously (no hard cuts):
 *   flight → collapse-infall → orbit → dawn-drift.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// fringe fix: deterministic per-track hue anchor (dust-v3 idiom). splitmix64
// style bit mix folded to [0,1) so track ids land on distinct hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};


const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;      // high-transient nebula puffs
uniform float u_spawnSnare; // snare star powder
uniform float u_zoom;
uniform float u_rotStep;    // signed (genome spin)
uniform float u_charge;     // bass-ring charge
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_palette;    // genome palette (continuous)
uniform float u_arms;       // genome arm count (eased)
uniform float u_fold;       // kaleidoscope segments (0 = unfolded)
uniform float u_horizonScale;
uniform float u_flash;      // mutation flash
uniform float u_phrase;     // phrase phase 0..1
uniform float u_section;    // section phase 0..1
uniform float u_barWave;    // bar-boundary wave age
uniform float u_beatPump;
uniform float u_dust;
uniform float u_drift;      // dawn-mode upward drift (calm pan)

const float PI = 3.141592653589793;

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
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));
  return tint * starShape(f, size) * on * bright * gain;
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  float anticipation = smoothstep(0.7, 1.0, u_phrase);

  // ---- Section fold on the warp coords: the accumulated universe folds.
  vec2 wc = c;
  if (u_fold > 0.5) {
    float fold = PI / u_fold;
    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);
    wc = vec2(cos(fa), sin(fa)) * r;
  }

  // ---- Warp: differential rotation + churn + kick ripple + lens.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.0016 + 0.014 * u_mid + 0.009 * u_buildup + 0.005 * u_phrase + 0.005 * anticipation);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.03;
  float barFront = 0.15 + u_barWave * 1.1;
  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);
  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)
    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));
  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  // Dawn drift: the whole feedback field is sampled from slightly BELOW,
  // so the accumulated light appears to rise (a slow sunrise pan). Scaled
  // by u_drift (nonzero only as the genome eases into dawn mode).
  vec2 dawn = vec2(0.0, -u_drift * (0.012 + 0.01 * u_sustain));
  vec2 src = (w + churn + ripple + dawn + dirW * barWave * 0.018 + dirW * lens * 0.045)
    / vec2(aspect, 1.0) + 0.5;

  // Aberration + unsharp feedback sample.
  vec2 ab = dirW * (0.001 + 0.003 * u_drop + 0.0022 * u_kick + 0.008 * rippleWave + 0.005 * u_flash)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Softer unsharp than the parent: calmer edges, longer smear.
  vec3 sky = max(vec3(0.0), sampled * 1.28 - blur * 0.28) * u_decay;

  // ---- Fresh layers (voyage's stack + genome/phrase evolution).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  fresh += mix(coal, vec3(0.9, 0.25, 0.12), 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)
    * u_low * (0.5 + 0.8 * u_kick);
  // Charged horizon ring (evolution: brightens through the phrase).
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float ringGain = 1.0 + 0.5 * anticipation;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;
  // Lens streak.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // Dust disk: genome arms, twist TIGHTENS through the phrase, dust
  // swells toward the boundary; bar waves light it as they pass.
  float twist = 4.5 + 2.5 * u_phrase;
  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.05 + 0.11 * u_phrase)
    + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Palette phase slides across the phrase AND the spectral centroid —
  // brighter material creeps the disk colour warmer/forward (assigned
  // tech: centroid drives the melodic colour drift).
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.55 + u_phrase * 0.35);
  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  float dustSwell = u_dust * (0.75 + 0.5 * u_phrase);
  fresh += diskColor * lanes * (0.1 + 1.05 * u_mid) * (0.5 + cloud) * dustSwell * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * dustSwell * centerDim * midGate * reverb;
  // Electric high nebula + shimmer.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.06 + 1.45 * u_high) * u_dust * reverb;
  // Section omen: a ring closing in from the screen edge over the last
  // bars. CALM cut — thinner, dimmer, and later than the parent so the
  // section change is a hint, not a warning.
  float omen = smoothstep(0.87, 1.0, u_section);
  if (omen > 0.001) {
    float omenR = 1.15 - 0.75 * omen;
    fresh += palette(0.5) * exp(-pow((r - omenR) * 34.0, 2.0)) * omen * 0.42;
  }
  // Anticipation shimmer: the last bar of a phrase flickers (gentler).
  fresh *= 1.0 + 0.08 * anticipation * sin(t * 25.0);
  // Longer persistence: inject fresh light more softly so trails dominate.
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);

  // ---- Stamps.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }
  if (u_spawnSnare > 0.003) {
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)
      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);
  }
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(coal, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }

  // Mutation flash, grain, grade, dynamics, knee.
  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.01 + 0.016 * u_drop);
  // Centroid biases the grade too: bright tracks grade warmer/lighter.
  vec3 grade = palette(0.35 + u_centroid * 0.3);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    // Chroma-preserving soft knee.
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const ARM_CYCLE = [2, 3, 5];
const FOLD_CYCLE = [0, 6, 8];
/**
 * Warp modes cycled at sections: flight → collapse → orbit → dawn-drift.
 * Dawn (mode 3) is the calm addition — near-still radial motion with a
 * gentle upward pan of the feedback field (see u_drift in the shader).
 */
const MODE_COUNT = 4;
const DAWN_MODE = 3;

export const g01OdysseyDriftPreset: VisualizerPreset = {
  id: 'g01-odyssey-drift',
  name: 'g01 odyssey-drift',
  hiRes: true,
  params: [
    // Calm defaults for deep/melodic sets — dialled below the parent.
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 0.85 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 0.6 },
    { id: 'chaos', label: 'mutation chaos', min: 0, max: 2, step: 0.05, default: 0.65 },
  ],
  create: () => {
    // fringe fix: per-song hue anchor state (dust-v3 idiom) for u_hueRot.
    let fringeCentroid = 0.5;
    let fringeAnchor = 0;
    let fringeAnchorTarget = 0;
    let fringeAnchorTrack: number | null = null;
    let paletteTarget = Math.floor(Math.random() * 4);
    let paletteCurrent = paletteTarget;
    let armIndex = 0;
    let armsCurrent = ARM_CYCLE[0];
    let foldIndex = 0;
    let modeTarget = 0;
    let modeCurrent = 0;
    let spinDirection = 1;
    let horizonTarget = 1;
    let horizonCurrent = 1;
    let flash = 0;
    let barWaveAge = 99;
    let prevBarIndex: number | null = null;
    let charge = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let breakdownS = 0;
    let lastTime = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;
        const chaos = frame.params.chaos ?? 0.65;

        // Drop/buildup split first — the genome reads the musical state.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(smoothDrop, 0.7 * sustained);

        // DROP-AWARE genome: a landing drop forces the most energetic
        // scene NOW; sustained quiet settles into calm dawn-drift.
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 8) {
          lastDropAt = frame.time;
          modeTarget = 0;
          foldIndex = 0;
          paletteTarget = (paletteTarget + 2) % 4;
          horizonTarget = 1.2;
          flash = Math.min(1.4, 1.2 * chaos);
        }
        prevDrop = smoothDrop;
        if (energy < 0.15) breakdownS += dt;
        else breakdownS = 0;
        if (breakdownS > 2.5 && modeTarget !== DAWN_MODE) {
          modeTarget = DAWN_MODE;
          foldIndex = 0;
          flash = Math.max(flash, 0.2 * chaos);
        }

        // Genome mutations at boundaries (phrase/section tiers via barIndex).
        if (beat) {
          if (prevBarIndex !== null && beat.barIndex !== prevBarIndex) {
            barWaveAge = 0;
            const phraseBoundary = ((beat.barIndex % 4) + 4) % 4 === 0;
            const sectionBoundary = ((beat.barIndex % 16) + 16) % 16 === 0;
            if (phraseBoundary) {
              paletteTarget = (paletteTarget + 1) % 4;
              armIndex = (armIndex + 1) % ARM_CYCLE.length;
              flash = Math.max(flash, 0.5 * chaos);
            }
            if (sectionBoundary) {
              if (lift > 0.5) {
                modeTarget = 0;
                foldIndex = 1 + Math.floor(Math.random() * 2);
              } else {
                modeTarget = (modeTarget + 1) % MODE_COUNT;
                foldIndex = (foldIndex + 1) % FOLD_CYCLE.length;
              }
              spinDirection *= -1;
              horizonTarget = 1 + (Math.random() - 0.35) * 0.6 * chaos;
              flash = Math.min(1.2, 0.85 * chaos);
            }
          }
          prevBarIndex = beat.barIndex;
        } else {
          prevBarIndex = null;
        }

        // Ease the genome; run the bass systems. Slower eases than the
        // parent — the calm cut lets mutations bloom in.
        const easeSlow = 1 - Math.exp(-dt / 1.3);
        const easeFast = 1 - Math.exp(-dt / 0.6);
        paletteCurrent += (paletteTarget - paletteCurrent) * easeSlow;
        armsCurrent += (ARM_CYCLE[armIndex] - armsCurrent) * easeFast;
        modeCurrent += (modeTarget - modeCurrent) * easeSlow;
        horizonCurrent += (horizonTarget - horizonCurrent) * easeFast;
        flash = Math.max(0, flash - dt * 1.4);
        barWaveAge += dt;
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // Warp-mode blend: flight zooms out, collapse falls in, orbit
        // swirls, dawn barely moves radially and drifts upward.
        const speed = frame.params.speed ?? 0.6;
        const w0 = Math.max(0, 1 - Math.abs(modeCurrent));
        const w1 = Math.max(0, 1 - Math.abs(modeCurrent - 1));
        const w2 = Math.max(0, 1 - Math.abs(modeCurrent - 2));
        const w3 = Math.max(0, 1 - Math.abs(modeCurrent - 3));
        const phraseNow = beat
          ? ((((beat.barIndex % 4) + 4) % 4) + beat.barPhase) / 4 : 0;
        const zoomFlight =
          1 +
          (0.06 + 0.55 * lift + 3.0 * frame.impulse.low * (0.5 + 0.5 * lift)) *
            (0.85 + 0.3 * phraseNow) * speed * dt;
        const zoomCollapse = 1 - (0.035 + 0.2 * energy) * speed * dt + 2.0 * frame.impulse.low * speed * dt * 0.5;
        const zoomOrbit = 1 + 0.4 * frame.impulse.low * speed * dt;
        // Dawn: a whisper of outward lift so light unfolds skyward.
        const zoomDawn = 1 + (0.02 + 0.12 * sustained) * speed * dt;
        const rotBase = (0.04 + 0.42 * frame.bands.mid + 0.2 * sustained) * speed * dt;
        // Upward drift, active only as the genome eases into dawn mode.
        const drift = w3 * (0.6 + 0.8 * sustained) * (0.6 + 0.8 * speed);

        // Phrase/section phases (tiers via barIndex).
        const phrase = phraseNow;
        const section = beat
          ? ((((beat.barIndex % 16) + 16) % 16) + beat.barPhase) / 16 : 0;

        // fringe fix: per-song hue anchor (splitmix of the dominant deck
        // trackId, ~2s eased) + slow spectral travel -- steers the feedback
        // fringe hue (see hueRotate in the fragment).
        fringeCentroid += (frame.centroid - fringeCentroid) * (1 - Math.exp(-dt / 1.0));
        let fringeDomTrack: number | null = null;
        let fringeDomLevel = -1;
        for (const d of frame.decks) {
          if (d.level > fringeDomLevel) {
            fringeDomLevel = d.level;
            fringeDomTrack = d.trackId;
          }
        }
        if (fringeDomTrack !== null && fringeDomTrack !== fringeAnchorTrack) {
          fringeAnchorTrack = fringeDomTrack;
          fringeAnchorTarget = splitmix01(fringeDomTrack);
        }
        fringeAnchor += (fringeAnchorTarget - fringeAnchor) * (1 - Math.exp(-dt / 2.0));
        const fringeHueRot = (((fringeAnchor + (fringeCentroid - 0.5) * 0.8) % 1) + 1) % 1;
        return {
          u_hueRot: fringeHueRot,
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_centroid: frame.centroid,
          // Longer persistence than the parent: higher floor decay so
          // trails smear into patient light.
          u_decay: Math.min(0.999, 0.995 - 0.006 * energy - 0.006 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (0.4 + 0.6 * Math.max(smoothDrop, sustained))) /
              (1 + 1.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (0.5 + 0.5 * Math.max(smoothDrop, sustained))) /
              (1 + 0.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_zoom: w0 * zoomFlight + w1 * zoomCollapse + w2 * zoomOrbit + w3 * zoomDawn,
          // Dawn keeps rotation minimal; orbit still swirls hard.
          u_rotStep: spinDirection * rotBase * (1 + 2.2 * w2) * (1 - 0.7 * w3),
          u_charge: charge,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_palette: paletteCurrent,
          u_arms: armsCurrent,
          u_fold: FOLD_CYCLE[foldIndex],
          u_horizonScale: horizonCurrent,
          u_flash: flash,
          u_phrase: phrase,
          u_section: section,
          u_barWave: barWaveAge,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_dust: frame.params.dust ?? 0.85,
          u_drift: drift,
        };
      },
    });
  },
};

export default g01OdysseyDriftPreset;
