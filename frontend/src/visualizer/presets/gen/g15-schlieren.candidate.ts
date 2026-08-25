/**
 * g15-schlieren (gen-15 NOVEL, feedback-space optics lens).
 *
 * RAINBOW SCHLIEREN FURNACE: the optic living inside the resample loop is
 * SELF-REFRACTION. The feedback field is a hot-gas density field; every
 * frame the resample coordinate is bent along the field's OWN luminance
 * gradient (bright plumes act as lenses distorting everything behind
 * them), and the chromatic split rides that gradient too — the house
 * aberration signature steered by the field itself instead of the radius.
 * Display renders the flow's OPTICS: knife-edge rainbow rims whose hue is
 * the gradient DIRECTION and whose brightness is the gradient magnitude
 * (classic rainbow-schlieren photography). The rims are stamped back into
 * the fluid, so the interference skin advects, refracts and rises with
 * the gas.
 *
 * MEDIUM: buoyant thermal plumes (fbm-churned rise), NOT advected dust —
 * mid/high vocabulary is the iridescent gradient skin (approved:
 * iridescent shimmer/caustics), no powder anywhere.
 *
 * MUSIC MAPPING:
 *   BASS     a burner mound across the bottom — the solid response; its
 *            heat column feeds the whole field.
 *   KICK     a thermal plume erupts at a genome-hashed bottom position
 *            (localized, photosafe) + a refraction surge.
 *   SNARE    twin side puffs kick in from the walls.
 *   HIGHS    iridescence gain on the schlieren rims (shimmer, not spawn).
 *   BUILDUP  rise accelerates, rims cool toward blue-violet.
 *   DROP     the burner roars white-hot, riding max(drop, energy).
 *   SECTION  (ladderBarIndex ?? barIndex, 16 bars) plume nozzle layout
 *            re-hashes; hue anchor comes from the trackId genome via
 *            frame.dominantChannel (the LAW — never per-frame argmax).
 *
 * CONTRACTION: decay < 1 always; the rim add is gated by the (decaying)
 * field gradient and scaled conservatively; whole-field grade capped at
 * 0.99; chroma-preserving soft knee at the end. Rise/churn rates ride
 * bandsSlow (erratic-motion law). GLSL ES 1.0, no backticks in GLSL.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// splitmix64-style bit mix folded to [0,1) — per-track genome hash.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

// No backticks inside this GLSL string (GLSL ES 1.0).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;       // impulse.low
uniform float u_snare;      // impulse.mid
uniform float u_rise;       // buoyancy step (bandsSlow-driven, dt-scaled)
uniform float u_churn;      // turbulence amplitude (bandsSlow-driven)
uniform float u_refract;    // self-lensing strength
uniform float u_decay;
uniform float u_rimGain;    // iridescence gain (highs + param)
uniform float u_rimCool;    // buildup: rims cool toward violet
uniform float u_hue;        // genome hue anchor + slow centroid travel (turns)
uniform float u_burner;     // bass burner heat (max(drop, energy)-ridden)
uniform float u_plumeAge;   // seconds since the last kick plume
uniform float u_plumeAmp;   // that plume's strength
uniform float u_plumeX;     // nozzle x (genome/section hashed), -0.5..0.5 aspect units
uniform float u_puffAge;    // seconds since the last snare puff
uniform float u_puffAmp;
uniform float u_drop;       // max(dropTransition, sustained) smoothed
uniform float u_buildup;

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

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Saturated hue wheel (turns) — the schlieren knife-edge rainbow.
vec3 hueWheel(float t) {
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, -0.3333, -0.6667)));
}

// Thermal body ramp: coal -> ember -> orange -> white-hot.
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.6);
  vec3 c = vec3(t * 1.6, t * t * 1.1, t * t * t * 0.85);
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Field gradient (4px stencil — wide enough that u8-texture noise
  // does not dominate the direction): the index-of-refraction field AND
  // the schlieren display, from the same four taps.
  float lR = luma(texture2D(u_prev, uv + vec2(px.x * 4.0, 0.0)).rgb);
  float lL = luma(texture2D(u_prev, uv - vec2(px.x * 4.0, 0.0)).rgb);
  float lU = luma(texture2D(u_prev, uv + vec2(0.0, px.y * 4.0)).rgb);
  float lD = luma(texture2D(u_prev, uv - vec2(0.0, px.y * 4.0)).rgb);
  vec2 grad = vec2(lR - lL, lU - lD);
  float gm = length(grad);
  vec2 gdir = gm > 1e-5 ? grad / gm : vec2(0.0);

  // ---- Advection: buoyancy (hot rises -> sample BELOW) + turbulent churn.
  vec2 churn = (vec2(
    fbm(c * 3.1 + vec2(0.0, -t * 0.35)),
    fbm(c * 3.1 + vec2(9.2, 4.4) - vec2(0.0, t * 0.28))
  ) - 0.5) * u_churn;
  // Self-refraction: bend the resample along the field's own gradient.
  // Surges briefly on the kick (the plume punches the lens).
  vec2 bend = gdir * min(gm * 6.0, 1.0) * u_refract;
  vec2 src = uv + vec2(0.0, -u_rise) + churn + bend;

  // Chromatic split ALONG THE GRADIENT — the aberration signature,
  // steered by the field itself.
  vec2 ab = gdir * (0.0012 + 0.0035 * min(gm * 8.0, 1.0) + 0.002 * u_kick)
    / vec2(aspect, 1.0);
  vec3 samp = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp against a 4-tap blur: keeps plume edges crisp through the
  // endless resampling.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 gas = max(vec3(0.0), samp * 1.15 - blur * 0.15) * u_decay;

  // ---- Rainbow schlieren rims: hue = gradient direction, applied as a
  // luminance-preserving RECOLOR of the gas at its edges — never an
  // additive term. (Two smoke runs proved any additive rim self-sustains:
  // rims create new gradients above themselves and propagate like a flame
  // front until the knee pegs the frame. A recolor is contraction by
  // construction: luma(rimColor * L) <= 0.85 L.)
  float rim = smoothstep(0.05, 0.22, gm);
  // NaN guard (orrery-tick precedent): atan(0,0) is undefined and NaN*0
  // poisons the whole feedback field — gate the angle on gm.
  float gAng = gm > 1e-5 ? atan(grad.y, grad.x) / 6.28318 : 0.0;
  vec3 rimColor = hueWheel(gAng + u_hue + 0.12 * sin(t * 0.21));
  rimColor = mix(rimColor, vec3(0.45, 0.35, 1.0), u_rimCool * 0.55);
  float gasLum = luma(gas);
  // Luma gate: dim gas keeps its thermal color (no speckle recolor of
  // near-black noise); only bright plume edges go iridescent.
  float rimBlend = min(0.85, rim * u_rimGain) * smoothstep(0.04, 0.22, gasLum);
  gas = mix(gas, rimColor * gasLum * 1.6, rimBlend);
  // Risen gas COOLS: a per-channel aging multiplier (< 1 componentwise —
  // pure contraction) reddens old gas like real embers.
  gas *= vec3(1.0, 0.994, 0.986);

  // ---- Fresh heat, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  // Bass burner: a mound across the bottom, kneaded by noise so the
  // heat column has structure. Solid response — no powder.
  float mound = exp(-pow((uv.y - 0.02) * (16.0 - 5.0 * u_low), 2.0))
    * (0.55 + 0.45 * fbm(vec2(c.x * 4.0, t * 0.6)));
  float heat = u_burner * (0.35 + 0.65 * u_low);
  fresh += thermal(heat * 1.05 + 0.25 * u_kick) * mound * heat * 1.1;
  // Kick plume: erupts from the genome nozzle, rises with age.
  if (u_plumeAmp > 0.01) {
    float py = 0.04 + u_plumeAge * (0.55 + 0.5 * u_rise * 60.0);
    vec2 pc = vec2(u_plumeX, py - 0.5) ;
    float pd = length((c - pc) * vec2(1.0, 1.6));
    float plume = exp(-pd * pd * 90.0) * exp(-u_plumeAge * 2.2) * u_plumeAmp;
    fresh += thermal(0.9 + 0.5 * u_plumeAmp) * plume * 2.6;
  }
  // Snare puffs: twin side jets.
  if (u_puffAmp > 0.01) {
    float sy = -0.12 + u_puffAge * 0.4;
    float pdL = length((c - vec2(-aspect * 0.42 + u_puffAge * 0.5, sy)) * vec2(1.4, 1.0));
    float pdR = length((c - vec2(aspect * 0.42 - u_puffAge * 0.5, sy)) * vec2(1.4, 1.0));
    float puff = (exp(-pdL * pdL * 130.0) + exp(-pdR * pdR * 130.0))
      * exp(-u_puffAge * 3.0) * u_puffAmp;
    fresh += hueWheel(u_hue + 0.45) * puff * 1.7;
  }
  // Mid shimmer: a faint caustic weave INSIDE existing gas only (mul by
  // field luma — cannot self-seed from black).
  float weave = pow(fbm(c * 6.0 + vec2(t * 0.4, -t * 0.55)), 3.0);
  fresh += hueWheel(u_hue + 0.2 + weave * 0.3) * weave * luma(gas) * u_mid * 1.1;

  gas += fresh * (1.0 - u_decay) * 3.0;

  // Drop bloom lives in the injection, not the field: cap any grade.
  float grade = min(0.86 + 0.13 * u_drop - 0.05 * u_buildup, 0.99);
  gas *= grade;

  // Fine grain so the gas never posterizes — kept below the rim threshold
  // so it cannot seed the gradient amplifier.
  gas += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.004;

  // Chroma-preserving soft knee.
  float m = max(gas.r, max(gas.g, gas.b));
  if (m > 0.8) {
    gas *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(gas, 0.0), 1.0);
}
`;

const preset: VisualizerPreset = {
  id: 'g15-schlieren',
  name: 'g15 Schlieren',
  hiRes: true,
  params: [
    { id: 'iridescence', label: 'rim iridescence', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'rise', label: 'rise speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'burner', label: 'burner heat', min: 0.2, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let plumeAge = 999;
    let plumeAmp = 0;
    let plumeX = 0;
    let puffAge = 999;
    let puffAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let slowCentroid = 0.5;
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    let lastSection = -1;
    let sectionSalt = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(1 / 240, frame.dt || 1 / 60));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const energyMotion = energyOf(motion);
        // Regime: prefer the shared decomposition; fall back to the
        // bass-split excitement smoothing (voyage precedent).
        const alpha = 1 - Math.exp(-dt / 0.35);
        if (frame.regime) {
          smoothDrop += (Math.max(frame.regime.dropTransition, frame.regime.sustained) - smoothDrop) * alpha;
          smoothBuildup += (frame.regime.buildup - smoothBuildup) * alpha;
        } else {
          const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
          smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
          smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        }
        const drive = Math.max(smoothDrop, Math.min(1, energy * 1.3));
        // Genome hue anchor via the dominantChannel LAW (never argmax).
        let domTrack: number | null = null;
        if (frame.dominantChannel) {
          const deck = frame.decks.find((d) => d.channel === frame.dominantChannel);
          if (deck && deck.trackId !== null) domTrack = deck.trackId;
        }
        if (domTrack !== null && domTrack !== lastAnchorTrack) {
          lastAnchorTrack = domTrack;
          hueAnchorTarget = splitmix01(domTrack);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // Section tier: re-salt the plume nozzle layout every 16 bars.
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        if (bar !== null) {
          const section = Math.floor(bar / 16);
          if (section !== lastSection) {
            lastSection = section;
            sectionSalt = splitmix01(section * 7919 + (lastAnchorTrack ?? 0));
          }
        }
        // Kick plume trigger (localized; retrigger-guarded).
        plumeAge += dt;
        puffAge += dt;
        if (frame.impulse.low > 0.4 && plumeAge > 0.14) {
          plumeAge = 0;
          plumeAmp = Math.min(1, frame.impulse.low * 1.15);
          const slot = splitmix01(Math.floor(frame.time * 9) + sectionSalt * 1e6);
          plumeX = (slot - 0.5) * 1.1;
        }
        if (frame.impulse.mid > 0.35 && puffAge > 0.2) {
          puffAge = 0;
          puffAmp = Math.min(1, frame.impulse.mid * 1.1);
        }
        const riseParam = frame.params.rise ?? 1;
        const persistence = frame.params.persistence ?? 1;
        // Fluid memory is shortish (dissipating gas); persistence stretches it.
        const baseDecay = 0.962 - 0.01 * smoothBuildup;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          // motion: slow bands (erratic-motion law) — buoyancy + churn rates
          u_rise: dt * (0.028 + 0.11 * energyMotion + 0.05 * smoothBuildup) * riseParam,
          u_churn: 0.0025 + 0.016 * motion.mid + 0.008 * smoothBuildup,
          u_refract: (0.006 + 0.02 * motion.low + 0.02 * frame.impulse.low) * riseParam,
          u_decay: Math.min(0.995, 1 - (1 - baseDecay) / persistence),
          u_rimGain: (0.35 + 0.95 * frame.bands.high) * (frame.params.iridescence ?? 1),
          u_rimCool: smoothBuildup,
          u_hue: ((hueAnchor + (slowCentroid - 0.5) * 0.5) % 1 + 1) % 1,
          u_burner: (0.3 + 0.9 * drive) * (frame.params.burner ?? 1),
          u_plumeAge: plumeAge,
          u_plumeAmp: plumeAmp,
          u_plumeX: plumeX,
          u_puffAge: puffAge,
          u_puffAmp: puffAmp,
          u_drop: drive,
          u_buildup: smoothBuildup,
        };
      },
    });
  },
};

export default preset;
