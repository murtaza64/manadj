/**
 * "g07 voyage-inferno" — a COMMITTED molten variation of the pool leader
 * (Voyage, 1044). Parent motion engine untouched; palette + impulse
 * rendering only.
 *
 * Palette identity (single, committed — trades voyage's traveling breadth
 * for drama): a near-black char floor, a deep-crimson undertow, molten
 * orange currents, and white-gold peaks. Contrast is the point — most of
 * the frame stays dark; ENERGY earns brightness.
 *
 * Impulse rendering:
 *   - kick ripple  → a MAGMA SURGE FRONT: the traveling wavefront lights
 *     what it passes white-hot and leaves a cooler crimson trail behind.
 *   - snare        → brief SPARK ARCS (thin radiating filaments, NOT dust —
 *     dust-fatigue rule). Snare powder is removed.
 *   - buildup      → the undertow RISES and reddens the horizon (tense,
 *     alive, never red-strobing).
 *   - drop         → the whole field goes molten (rides max(drop, energy))
 *     with slow white-gold convection through the plateau.
 *
 * Photosensitivity (WCAG 2.3.1): the palette is hot but transitions are
 * smooth; the whole-frame kick lift is rate-limited and small, and there is
 * no saturated-red fullscreen flashing.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

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
uniform float u_centroid;
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_palette;    // committed: only a subtle heat bias
uniform float u_charge;
uniform float u_spawnSnare;

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

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

// THE MOLTEN RAMP — a single committed blackbody-ish palette. h in 0..1:
//   0.0 char floor (near black) → 0.35 crimson undertow → 0.65 molten
//   orange → 1.0 white-gold peak. Piecewise mixes keep the crimson deep and
//   the peak white-gold (not yellow-green). This is the whole identity.
vec3 magma(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 char0 = vec3(0.02, 0.005, 0.004);
  vec3 crimson = vec3(0.42, 0.03, 0.03);
  vec3 orange = vec3(1.0, 0.35, 0.05);
  vec3 gold = vec3(1.0, 0.78, 0.30);
  vec3 white = vec3(1.0, 0.96, 0.86);
  vec3 c = mix(char0, crimson, smoothstep(0.0, 0.35, h));
  c = mix(c, orange, smoothstep(0.30, 0.65, h));
  c = mix(c, gold, smoothstep(0.60, 0.85, h));
  c = mix(c, white, smoothstep(0.85, 1.0, h));
  return c;
}

// The scene's "palette(t)" hook, kept so the parent's call sites are
// unchanged — but here it maps a phase into a molten hue band. Undertow
// rises with the buildup (reddening) and the drop warms toward gold. The
// palette slider is a small committed heat bias (identity stays molten).
vec3 palette(float t) {
  float phase = fract(t);
  // A moderate mid-band by default so dust reads as orange currents, lifted
  // toward gold on the drop, pulled toward crimson undertow on a buildup.
  float heat = 0.45 + 0.28 * u_drop - 0.14 * u_buildup
    + 0.05 * (u_palette - 1.0)
    + 0.12 * sin(6.28318 * phase);
  return magma(heat);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity waves in deep crimson undertow, whitening under a kick.
  fresh += magma(0.30 + 0.4 * u_kick) * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;

  // THE HORIZON RING — the undertow. Buildup RAISES and reddens it (the
  // tense rise before the drop); kick + charge run it white-hot. All molten.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // heat: crimson at rest, orange with bass, white-hot with charge/kick.
  float ringHeat = 0.32 + 0.20 * u_buildup + 0.30 * bassOn
    + 0.45 * u_kick + 0.35 * clamp(u_charge, 0.0, 1.0);
  vec3 chargeColor = magma(ringHeat);
  // Buildup glow gain: the undertow rises (tense, alive) but stays smooth.
  fresh += chargeColor * ringGlow
    * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge + 0.5 * u_buildup);
  fresh += mix(chargeColor, vec3(1.0, 0.96, 0.86), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);

  // THE CHAR HEART — near-black at rest (char floor), whitening only under a
  // kick. This is the contrast anchor: the center stays dark, energy earns
  // the white-gold flare.
  fresh += magma(0.08 + 0.8 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += magma(0.22 + 0.3 * u_low) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);

  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);

  // Anamorphic lens streak — molten gold core accent.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += magma(0.62 + 0.25 * u_kick) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // The disk: spiral lanes + clouds as molten ORANGE CURRENTS. The magma
  // height is driven by the cloud field so the currents self-shade from
  // crimson lows to gold highs — molten convection.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Convection height: base warmth + slow white-gold convection during the
  // drop plateau (rides max(drop, sustain) — u_sustain feeds via lift).
  float lift = max(u_drop, u_sustain);
  float convect = 0.10 * lift * (0.5 + 0.5 * sin(ang * 2.0 - t * 0.5 + r * 4.0));
  float diskHeat = 0.30 + 0.55 * cloudField + 0.20 * lift + convect;
  vec3 diskColor = magma(diskHeat);
  // MAGMA SURGE FRONT: the traveling wavefront lights the dust it passes
  // white-hot (reverb boosts brightness AND pushes the local heat up),
  // leaving a cooler crimson trail behind (the field cools as the ripple
  // ages via exp(-u_rippleAge) already baked into rippleWave).
  float reverb = 1.0 + 2.6 * rippleWave;
  vec3 surge = magma(min(1.0, diskHeat + 0.6 * rippleWave));
  float midGate = smoothstep(0.04, 0.3, u_mid);
  vec3 currentCol = mix(diskColor, surge, clamp(2.0 * rippleWave, 0.0, 1.0));
  fresh += currentCol * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += currentCol * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;

  // HIGH shimmer — fine gold sparks in the currents (kept, but molten, not
  // electric-blue). Distinct fast flicker, finer scale.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 emberHigh = magma(0.68 + 0.25 * wisp);
  fresh += emberHigh * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient PUFFS — molten embers stamped into the feedback.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += magma(0.60) * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Molten shock: white-gold body, crimson-orange trailing ring.
    sky += magma(0.75 + 0.2 * u_kick) * shock * u_kick * (1.05 + 0.7 * u_drop);
    // Whole-frame punch — SMALL and rate-limited (photosensitivity): a
    // gentle lift, never a saturated-red strobe.
    sky *= 1.0 + 0.06 * u_kick;
  }

  // SNARE = SPARK ARCS (filaments, not dust). Thin radiating gold filaments
  // in a ring at r~0.3, angularly gated to a few bright strands that jitter
  // with the seed — a brief crackle, not a powder cloud.
  if (u_snare > 0.03) {
    float ringBand = exp(-pow((r - 0.3) * 26.0, 2.0));
    // A handful of sharp angular strands (high harmonic + steep power).
    float strands = pow(0.5 + 0.5 * sin(ang * 11.0 + u_seed * 6.0 + t * 2.0), 14.0);
    // Fine filament texture along the arc so each strand reads as a spark.
    float fil = pow(0.5 + 0.5 * sin(ang * 47.0 + u_seed * 3.1 + r * 30.0), 6.0);
    float arc = ringBand * strands * (0.4 + 0.6 * fil);
    sky += magma(0.80) * arc * u_snare * 1.1;
  }

  // Snare POWDER removed (dust-fatigue): only the surge/arcs carry the
  // mid/high transients now.

  // Film grain — fine, a touch louder through the drop.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Molten grade: the whole frame leans into the palette hue.
  vec3 grade = magma(0.40 + 0.25 * lift);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // DROP blooms molten (rides max(drop, energy)); buildups dim slightly but
  // stay alive (the horizon rise above keeps them tense, not still).
  sky *= 0.70 + 0.48 * lift - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const voyageInfernoPreset: VisualizerPreset = {
  id: 'g07-voyage-inferno',
  name: 'g07 Voyage Inferno',
  hiRes: true,
  params: [
    { id: 'stars', label: 'spark density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'current amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'heat bias', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
        };
      },
    });
  },
};

const candidate: VisualizerPreset = voyageInfernoPreset;
export default candidate;
