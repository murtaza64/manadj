import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const N = 24;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_flow;
uniform float u_ribFreq;
uniform float u_ribAngle;
uniform float u_disperse;
uniform float u_frost;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_drive;
uniform float u_hue;
uniform float u_spread;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_bulgeAge;
uniform float u_bulgeAmp;
uniform vec2 u_bulgePos;
uniform vec2 u_bodyA;
uniform vec2 u_bodyB;
uniform vec2 u_bodyC;
uniform float u_spectrum[24];

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// --- the hidden scene: three band-owned luminous bodies + spectral columns ---
vec3 scene(vec2 p) {
  vec3 col = vec3(0.012, 0.01, 0.02);
  float dA = length(p - u_bodyA);
  float dB = length(p - u_bodyB);
  float dC = length(p - u_bodyC);
  vec3 hueA = hsv(vec3(fract(u_hue), 0.95, 1.0));
  vec3 hueB = hsv(vec3(fract(u_hue + 0.13 + 0.2 * u_spread), 0.9, 1.0));
  vec3 hueC = hsv(vec3(fract(u_hue + 0.55 + 0.15 * u_spread), 0.85, 1.0));
  col += hueA * exp(-dA * dA * 7.0) * (0.35 + 1.5 * u_low);
  col += hueB * exp(-dB * dB * 16.0) * (0.25 + 1.3 * u_mid);
  col += hueC * exp(-dC * dC * 34.0) * (0.2 + 1.4 * u_high);
  // 24 soft spectral columns
  float xf = clamp((p.x * 0.5 + 0.5) * 24.0, 0.0, 23.999);
  int xi = int(floor(xf));
  float level = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i == xi) level = u_spectrum[i];
  }
  float columnGlow = smoothstep(0.9, 0.2, abs(fract(xf) - 0.5) * 2.0);
  vec3 colHue = hsv(vec3(fract(u_hue + 0.08 + xf * 0.017 * (0.5 + u_spread)), 0.85, 1.0));
  col += colHue * level * columnGlow * 0.4 * exp(-abs(p.y) * 1.4);
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // scene coordinates: x spans [-1, 1] across the sheet
  vec2 sp = vec2(p.x / aspect * 2.0, p.y * 1.6);

  // rib coordinate frame (section-driven angle, near vertical)
  vec2 rdir = vec2(cos(u_ribAngle), sin(u_ribAngle));
  vec2 rnrm = vec2(-rdir.y, rdir.x);
  float rx = dot(p, rdir);
  float ry = dot(p, rnrm);

  // snare ripple travels along the ribs, bending their phase
  float ripple = sin(ry * 9.0 - u_rippleAge * 11.0) * exp(-u_rippleAge * 2.4) * u_rippleAmp * 0.35;
  float phase = rx * u_ribFreq + ripple + u_flow * 0.06;
  float t = fract(phase);
  float w = 2.0 * t - 1.0;                    // [-1,1] across one rib
  float prof = sqrt(max(1.0 - w * w, 0.0));   // half-cylinder height
  float slope = -w / max(prof, 0.08);         // true profile gradient

  // kick pressure bulge: a circular lens gliding across the sheet
  float bd = length(p - u_bulgePos) - u_bulgeAge * 0.9;
  float bulge = exp(-bd * bd * 30.0) * exp(-u_bulgeAge * 1.6) * u_bulgeAmp;

  // refraction: offset the scene sample along the rib normal direction
  float bend = slope * (0.11 + 0.05 * u_drive) + bulge * 0.14;
  float frostJitter = (hash(gl_FragCoord.xy * 0.7 + u_time) - 0.5) * u_frost * 0.04;
  vec2 base = sp + rdir * (bend + frostJitter);
  vec2 dd = rdir * bend * u_disperse;
  vec3 refr;
  refr.r = scene(base - dd * 0.10).r;
  refr.g = scene(base).g;
  refr.b = scene(base + dd * 0.10).b;

  // glass shading: caustic focus at the rib crown, dark hard seams
  float caustic = pow(prof, 6.0) * 0.5 + pow(max(0.0, 1.0 - abs(w) * 1.15), 8.0) * 0.4;
  float seam = smoothstep(0.985, 1.0, abs(w));
  float specStripe = pow(max(0.0, sin(phase * TAU * 0.5 + 1.1)), 90.0);

  vec3 col = refr * (0.72 + caustic * (0.8 + 0.6 * u_drive));
  col += hsv(vec3(fract(u_hue + 0.4), 0.35, 1.0)) * specStripe * (0.08 + 0.25 * u_high + 0.5 * u_hat * prof);
  col += refr * bulge * 1.6;
  col *= 1.0 - seam * 0.85;
  col *= 1.0 - 0.3 * dot(p, p);

  float m = max(col.r, max(col.g, col.b));
  if (m > 0.9) col *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 3.0))) / m;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function dominant(frame: VisualizerFrameData) {
  return frame.decks.find((deck) => deck.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-reeded-glass',
  name: 'g16 reeded-glass',
  hiRes: true,
  params: [
    { id: 'ribs', label: 'rib frequency', min: 6, max: 26, step: 1, default: 14 },
    { id: 'disperse', label: 'dispersion', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'frost', label: 'frost bias', min: 0, max: 1.5, step: 0.05, default: 0.6 },
  ],
  create: () => {
    let flow = 0;
    let orbA = 0;
    let orbB = 2.1;
    let orbC = 4.4;
    let hue = 0.6;
    let ribAngle = 0.06;
    let ribAngleTarget = 0.06;
    let lastSection = -1;
    let rippleAge = 99;
    let rippleAmp = 0;
    let bulgeAge = 99;
    let bulgeAmp = 0;
    let bulgePos: [number, number] = [0, 0];
    const spectrum = new Float32Array(N);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.3 + slow.mid * 0.8);
        // the three luminous bodies orbit at slow-band speeds
        orbA += dt * (0.11 + slow.low * 0.22);
        orbB += dt * (0.17 + slow.mid * 0.34);
        orbC += dt * (0.23 + slow.high * 0.5);
        rippleAge += dt;
        bulgeAge += dt;
        const deck = dominant(frame);
        const key = deck?.trackId ?? 27;
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
        const section = Math.floor(bar / 16);
        if (section !== lastSection) {
          lastSection = section;
          ribAngleTarget = (hash01(key + section * 53) - 0.5) * 0.5;
        }
        ribAngle += (ribAngleTarget - ribAngle) * (1 - Math.exp(-dt / 0.9));
        const targetHue = hash01(key) + frame.centroid * 0.3;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 2));
        if (frame.impulse.low > 0.32 && bulgeAge > 0.2) {
          bulgeAge = 0;
          bulgeAmp = Math.min(1, frame.impulse.low);
          const j = Math.floor(frame.time * 9);
          bulgePos = [(hash01(key + j * 19) - 0.5) * 1.2, (hash01(key * 3 + j * 23) - 0.5) * 0.7];
        }
        if (frame.impulse.mid > 0.38 && rippleAge > 0.25) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.mid);
        }
        for (let i = 0; i < N; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
        const energy = energyOf(frame.bands);
        const drive = Math.min(1, Math.max(frame.regime?.sustained ?? 0, energy * 1.35));
        return {
          u_time: frame.time,
          u_flow: flow,
          u_ribFreq: frame.params.ribs ?? 14,
          u_ribAngle: ribAngle,
          u_disperse: frame.params.disperse ?? 1,
          u_frost: (frame.params.frost ?? 0.6) * frame.flatness,
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
          u_drive: drive,
          u_hue: hue,
          u_spread: frame.spread,
          u_rippleAge: rippleAge, u_rippleAmp: rippleAmp,
          u_bulgeAge: bulgeAge, u_bulgeAmp: bulgeAmp,
          u_bulgePos: bulgePos,
          u_bodyA: [Math.cos(orbA) * 0.42, Math.sin(orbA * 0.8) * 0.3 - 0.12] as [number, number],
          u_bodyB: [Math.cos(orbB) * 0.3, Math.sin(orbB * 1.1) * 0.26 + 0.05] as [number, number],
          u_bodyC: [Math.cos(orbC) * 0.5, Math.sin(orbC * 0.9) * 0.32 + 0.16] as [number, number],
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
