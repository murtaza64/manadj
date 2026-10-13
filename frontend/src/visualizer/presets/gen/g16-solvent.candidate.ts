/**
 * g16-solvent: drop = the fluid TAKES OVER; breakdown = the tank drains.
 *
 * A crisp flat reticle (rings + spokes + a bass ring — hard edges, no
 * glow-wash) sits in a solvent tank. The aberration fluid's amount is a
 * single smoothed regime value, "flood":
 *
 * - DRAINED (breakdown/quiet): shear ~ zero, feedback memory SHORT — the
 *   screen snaps back to razor-sharp geometry within a bar. Clean image.
 * - FLOODING (buildup/rising energy): shear grows, memory lengthens,
 *   the fluid starts eating the lattice edges.
 * - FLOODED (drop): shear surges and rotates radial -> cyclonic, fresh
 *   geometry injection thins to a skeleton, and a slow hue drift stirs
 *   the fluid — the chromatic interference IS the image.
 *
 * Injection is (1 - decay)-normalized, so both poles hold comparable
 * mean luminance (no washout, no periodic dimming).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

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
uniform float u_lowSlow;   // motion-grade (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;   // motion-grade (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_flood;     // THE instrument: regime-driven fluid amount 0..1
uniform float u_swirl;     // shear direction, radians (radial -> cyclonic)
uniform float u_decay;
uniform float u_zoom;
uniform float u_spin;      // reticle rotation phase (slow-band driven)
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_hueRot;    // per-song hue anchor, TURNS
uniform float u_fringeRot; // fringe hue pair steering, TURNS
uniform float u_hueDrift;  // per-frame fluid stir, TURNS (tiny, flood-gated)
uniform float u_energy;
uniform float u_seed;
uniform float u_fluid;     // param: overall fluid scale
uniform float u_palette;

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
  for (int i = 0; i < 3; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// Acid solvent palette: committed greens/magentas/cyans, bright and
// saturated (distinct identity from the blue-wash failure mode).
vec3 palA(float t) { return vec3(0.28, 0.5, 0.2) + vec3(0.4, 0.5, 0.35) * cos(6.28318 * (vec3(1.0, 0.8, 0.9) * t + vec3(0.1, 0.35, 0.6))); }
vec3 palB(float t) { return vec3(0.5, 0.2, 0.45) + vec3(0.5, 0.35, 0.5) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.0, 0.4, 0.2))); }
vec3 palette(float t) {
  return mix(palA(t), palB(t), clamp(u_palette, 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Warp: nearly still when drained; churny when flooded.
  vec2 w = c / u_zoom;
  vec2 churn = (vec2(
    fbm(c * 3.1 + t * 0.13),
    fbm(c * 3.1 + vec2(7.7, 3.1) - t * 0.1)
  ) - 0.5) * (0.0008 + (0.016 + 0.014 * u_midSlow) * u_flood);
  float front = 0.12 + u_rippleAge * 0.95;
  float rippleWave = exp(-pow((r - front) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 src = (w + churn + dirW * rippleWave * 0.03) / vec2(aspect, 1.0) + 0.5;

  // ---- THE INSTRUMENT: shear magnitude = flood; shear DIRECTION rotates
  // from radial (gentle bleed) to cyclonic (the takeover) as flood rises.
  float scs = cos(u_swirl);
  float ssn = sin(u_swirl);
  vec2 shearDir = mat2(scs, -ssn, ssn, scs) * dirW;
  float shear = (0.0004 + 0.0125 * u_flood * u_flood + 0.004 * u_kick
    + 0.008 * rippleWave) * u_fluid;
  vec2 ab = shearDir * shear / vec2(aspect, 1.0);
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -u_fringeRot).r,
    hueRotate(tapC, -u_fringeRot).g,
    hueRotate(tapB, -u_fringeRot).b
  ), u_fringeRot));
  // Stir: tiny luminance-preserving hue drift, flood-gated — the flooded
  // fluid slowly cycles color instead of freezing on one fringe pair.
  sampled = hueRotate(sampled, u_hueDrift);
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 tank = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- The clean image: a FLAT reticle. Hard edges, committed colors.
  // Injection thins as the flood takes over (the fluid eats the image).
  float geomGain = mix(1.0, 0.28, u_flood);
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 1.8 * rippleWave;
  // Concentric rings (crisp): ring lattice breathes gently with slow lows.
  float ringDen = 5.0 + 1.2 * u_lowSlow;
  float rs = abs(fract(r * ringDen - u_spin * 0.25) - 0.5);
  float rings = smoothstep(0.055, 0.02, rs) * smoothstep(0.9, 0.5, r);
  // 12 spokes, rotating slowly (slow mids), windowed away from center.
  float sa = abs(fract(ang / 6.28318 * 12.0 + u_spin) - 0.5);
  float spokes = smoothstep(0.1, 0.035, sa) * smoothstep(0.1, 0.28, r) * smoothstep(0.85, 0.45, r);
  // Bass ring: the one thick element; kick makes it bite.
  float horizon = 0.2 + 0.07 * u_low;
  float bassRing = smoothstep(0.02, 0.008, abs(r - horizon)) * (0.4 + 1.2 * u_low + 1.6 * u_kick);
  vec3 boneA = palette(0.15 + r * 0.3);
  vec3 boneB = palette(0.62 + ang * 0.05);
  fresh += hueRotate(mix(vec3(0.95), boneA, 0.55), u_hueRot) * rings * (0.4 + 0.5 * u_mid);
  fresh += hueRotate(mix(vec3(0.9), boneB, 0.6), u_hueRot) * spokes * (0.35 + 0.5 * u_mid);
  fresh += hueRotate(mix(palette(0.05), vec3(1.0, 0.95, 0.9), 0.4 * u_kick + 0.2), u_hueRot) * bassRing;
  // Intersection glints ride the highs (localized, crisp).
  fresh += vec3(1.0) * rings * spokes * (2.5 * u_high);
  // Snare: one angular sector flashes (localized arc, not full-field).
  if (u_snare > 0.04) {
    float sector = pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 6.0);
    fresh += hueRotate(palette(0.35), u_hueRot) * sector
      * smoothstep(0.15, 0.4, r) * smoothstep(0.7, 0.4, r) * u_snare * 1.4;
  }
  fresh *= geomGain * reverb;
  // Solvent inflow shimmer: only while flooding — fresh color for the
  // fluid to shear, dies with the drain.
  float inflow = fbm(vec2(ang * 3.0 + t * 0.2, r * 6.0 - t * 0.3));
  fresh += hueRotate(palette(inflow * 1.4 + t * 0.015), u_hueRot)
    * pow(inflow, 2.2) * u_flood * (0.3 + 0.9 * u_mid) * smoothstep(0.08, 0.3, r);

  tank += fresh * (1.0 - u_decay) * (3.4 + 1.4 * u_energy);

  // Kick shock through the tank (drop-flooded kicks ripple the fluid).
  if (u_kick > 0.02) {
    float ringR = 0.08 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 42.0, 2.0));
    tank += hueRotate(mix(palette(0.05), vec3(1.0, 0.9, 0.85), 0.5), u_hueRot)
      * shock * u_kick * (0.8 + 0.8 * u_flood);
    tank *= 1.0 + 0.07 * u_kick;
  }

  tank += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.01 + 0.012 * u_flood);

  tank *= 0.76 + 0.34 * u_energy;
  float m = max(tank.r, max(tank.g, tank.b));
  if (m > 0.8) {
    tank *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(tank, 0.0), 1.0);
}
`;

function dominantDeck(frame: VisualizerFrameData) {
  return frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-solvent',
  name: 'g16 solvent',
  hiRes: true,
  params: [
    { id: 'fluid', label: 'solvent strength', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'drain', label: 'drain speed', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette (acid→orchid)', min: 0, max: 1, step: 0.05, default: 0.3 },
  ],
  create: () => {
    let flood = 0;
    let spin = 0;
    let rippleAge = 99;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastTrack: number | null = null;
    let slowCentroid = 0.5;
    let stir = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const sustained = Math.min(1, energy * 1.4);

        // ---- THE FLOOD. Prefer the shared regime decomposition; fall
        // back to the voyage-style excitement split.
        let drop: number;
        let breakdown: number;
        let sustainedRegime: number;
        if (frame.regime) {
          drop = frame.regime.dropTransition;
          breakdown = frame.regime.breakdown;
          sustainedRegime = frame.regime.sustained;
        } else {
          const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
          const a = 1 - Math.exp(-dt / 0.35);
          smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * a;
          smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * a;
          drop = smoothDrop;
          breakdown = Math.max(0, 1 - energy * 2.2);
          sustainedRegime = sustained;
        }
        const drain = frame.params.drain ?? 1;
        // Sustained states ride max(drop, energy) — excitement is a
        // transition signal (taste law). Breakdown actively drains.
        const target = Math.min(1, Math.max(0,
          Math.max(drop, 0.9 * sustainedRegime) * (1 - 0.85 * breakdown)));
        const tau = target > flood ? 0.4 : 0.7 / drain; // flood fast, drain over ~a bar
        flood += (target - flood) * (1 - Math.exp(-dt / tau));

        spin += dt * (0.01 + 0.05 * motion.mid); // motion: slow bands
        stir = (stir + dt * 0.06 * flood) % 1; // fluid hue drift accumulator
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.15);
        }

        const track = dominantDeck(frame)?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          hueAnchorTarget = splitmix01(track);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        const hueRot = ((((hueAnchor + (slowCentroid - 0.5) * 0.5) % 1) + 1) % 1);

        // Memory: short when drained (sharp snap-back), long when flooded.
        const decay = Math.min(0.995, 0.86 + 0.126 * flood);
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low,
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_flood: flood,
          u_swirl: flood * 1.25, // radial -> cyclonic takeover
          u_decay: decay,
          u_zoom: 1 + (0.02 + 0.25 * flood * Math.min(1, energyOf(motion) * 1.4)
            + 1.6 * frame.impulse.low * flood) * dt,
          u_spin: spin,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_hueRot: hueRot,
          // Fringe pair steered by spectral content (slow), widened a bit
          // by the flood itself.
          u_fringeRot: (slowCentroid - 0.5) * 0.5 + 0.12 * flood,
          u_hueDrift: dt * 0.06 * flood,
          u_energy: sustainedRegime,
          u_seed: Math.floor(frame.time * 8),
          u_fluid: frame.params.fluid ?? 1,
          u_palette: frame.params.palette ?? 0.3,
        };
      },
    });
  },
};

export default preset;
