import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const MAX_CLUMPS = 5;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_diskFlow;
uniform float u_roll;
uniform float u_rs;
uniform float u_drag;
uniform float u_spin;
uniform float u_mass;
uniform float u_hue;
uniform float u_spread;
uniform float u_flatness;
uniform float u_arms;
uniform float u_innerR;
uniform float u_hat;
uniform float u_drive;
uniform float u_wobble;
uniform float u_jet;
uniform float u_flareAge;
uniform float u_flareAmp;
uniform float u_flareAngle;
uniform float u_clumps[15];

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// accretion disk radiance evaluated in LENSED space
vec3 disk(vec2 q) {
  float r = length(q);
  float a = atan(q.y, q.x);
  float inner = u_innerR;
  float outer = u_rs * 5.4;
  float band = smoothstep(inner, inner + 0.035, r) * (1.0 - smoothstep(outer - 0.22, outer, r));
  if (band < 0.001) return vec3(0.0);
  // log-spiral streaks, frame-dragged: winding diverges toward the horizon
  float wind = u_drag / max(r - u_rs * 0.95, 0.015);
  float streak = sin(a * u_arms + log(r) * 9.0 * u_spin - u_diskFlow * u_spin + wind);
  float streak2 = sin(a * (u_arms + 3.0) - log(r) * 14.0 * u_spin + u_diskFlow * 0.6 * u_spin - wind * 0.7);
  float grain = noise2(vec2(a * 5.0 + wind * 0.5, r * 40.0 - u_diskFlow * 0.8));
  float tex = 0.55 + 0.45 * streak * (0.6 + 0.4 * streak2);
  tex = mix(tex, tex * (0.5 + grain), u_flatness * 0.8);
  // doppler beaming: the approaching side burns brighter and bluer
  float dop = sin(a + u_roll) * u_spin;
  float beam = 1.0 + 1.7 * max(0.0, dop);
  float rad = pow(inner / r, 1.4) * 1.35;
  // hot clumps orbiting in: comet streaks that LIGHT the disk they pass
  float clump = 0.0;
  for (int i = 0; i < 5; i++) {
    float ca = u_clumps[i * 3 + 0];
    float cr = u_clumps[i * 3 + 1];
    float heat = u_clumps[i * 3 + 2];
    if (heat < 0.01) continue;
    float da = a - ca;
    da = mod(da + TAU * 0.5, TAU) - TAU * 0.5;
    // smear the heat backward along the orbit (comet tail)
    float tail = exp(-pow(da * 2.2, 2.0)) + exp(-pow((da + 0.55) * 3.5, 2.0)) * 0.4;
    clump += heat * tail * exp(-pow((r - cr) * 26.0, 2.0));
  }
  vec3 hueCool = hsv(vec3(fract(u_hue), 0.85, 1.0));
  vec3 hueHot = hsv(vec3(fract(u_hue + 0.1 + 0.16 * u_spread), 0.55, 1.0));
  vec3 col = mix(hueCool, hueHot, clamp(rad * 0.9 + max(0.0, dop) * 0.55, 0.0, 1.0));
  col *= band * tex * rad * beam * u_mass;
  col += hueHot * clump * band * 2.6;
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float cr = cos(u_roll); float sr = sin(u_roll);
  p = mat2(cr, -sr, sr, cr) * p;

  float r = length(p);
  float shadowR = u_rs * 1.42;
  // gravitational magnification: near the ring the whole disk compresses
  // against the shadow (sample radius sweeps outward as r drops)
  float bend = u_rs * u_rs * 1.4 / max(r - u_rs * 0.6, 0.03);
  // frame dragging: swirl that diverges near the horizon
  float swirl = u_drag * u_spin * 0.55 / max(r - u_rs * 0.9, 0.03);
  float ca2 = cos(swirl); float sa2 = sin(swirl);
  vec2 q = mat2(ca2, -sa2, sa2, ca2) * p;
  q = q * (1.0 + bend / max(r, 0.02));
  // inclination: the disk lives in a vertically squashed plane
  float squash = 1.35 + u_wobble * sin(u_time * 0.7);
  vec2 qd = vec2(q.x, q.y * squash);

  vec3 col = disk(qd);
  // secondary image: light wrapped over the pole — a thin echo hugging
  // the photon ring only (masked hard away from the shadow)
  vec2 q2 = qd * (u_rs * 2.55 / max(length(qd), 0.02));
  float echoMask = exp(-abs(r - u_rs * 1.42) * 26.0);
  col += disk(q2 * vec2(1.0, -1.0)) * 0.45 * echoMask;

  // lensed background haze: warps visibly into an Einstein glow
  vec2 hq = q * 1.6 + vec2(u_time * 0.008, 0.0);
  float haze = noise2(hq * 3.0) * noise2(hq * 7.0 + 11.0);
  col += hsv(vec3(fract(u_hue + 0.45), 0.7, 1.0)) * haze * 0.05 * smoothstep(shadowR, shadowR * 2.2, r);

  float pa = atan(p.y, p.x);
  // the photon ring: razor-thin, brightest object in the scene
  float ring = exp(-pow((r - shadowR) * 90.0, 2.0));
  float ringGlow = exp(-pow((r - shadowR) * 18.0, 2.0)) * 0.3;
  float dopr = 1.0 + 1.2 * max(0.0, sin(pa + u_roll) * u_spin);
  col += hsv(vec3(fract(u_hue + 0.06), 0.35, 1.0)) * (ring * 1.4 + ringGlow) * dopr * (0.55 + 0.45 * u_drive);
  // snare flare: a short arc of the ring ignites
  float fa = pa - u_flareAngle;
  fa = mod(fa + TAU * 0.5, TAU) - TAU * 0.5;
  col += vec3(1.0, 0.95, 0.85) * ring * exp(-fa * fa * 6.0) * exp(-u_flareAge * 4.5) * u_flareAmp * 2.0;
  // hat scintillation on the inner disk edge
  float twinkle = hash(vec2(floor(pa * 14.0), floor(u_time * 9.0)));
  col += hsv(vec3(fract(u_hue + 0.12), 0.4, 1.0)) * exp(-pow((r - u_innerR * 1.6) * 30.0, 2.0)) * pow(twinkle, 18.0) * u_hat * 0.8;

  // relativistic jet on the drop: bipolar beam along the spin axis
  if (u_jet > 0.003) {
    float jx = abs(p.x);
    float jbeam = exp(-jx * jx * 240.0) * smoothstep(shadowR * 0.8, shadowR * 2.4, abs(p.y));
    float jcore = exp(-jx * jx * 900.0);
    vec3 jhue = hsv(vec3(fract(u_hue + 0.5), 0.6, 1.0));
    col += jhue * (jbeam * 0.7 + jcore * 0.9) * u_jet * exp(-abs(p.y) * 1.1);
  }

  // the shadow stays BLACK
  col *= smoothstep(shadowR * 0.985, shadowR * 1.01, r);

  float m = max(col.r, max(col.g, col.b));
  if (m > 0.88) col *= (0.88 + 0.12 * (1.0 - exp(-(m - 0.88) * 3.0))) / m;
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
  id: 'g16-event-horizon',
  name: 'g16 event-horizon',
  hiRes: true,
  params: [
    { id: 'rs', label: 'horizon radius', min: 0.08, max: 0.2, step: 0.005, default: 0.13 },
    { id: 'drag', label: 'frame drag', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'massGain', label: 'disk gain', min: 0.4, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let diskFlow = 0;
    let roll = 0;
    let rollTarget = 0;
    let hue = 0.07;
    let spin = 1;
    let arms = 3;
    let lastSection = -1;
    let flareAge = 99;
    let flareAmp = 0;
    let flareAngle = 0;
    let jet = 0;
    let clumpGate = 0;
    // clumps: [angle, radius, heat] x MAX_CLUMPS
    const clumps = new Float32Array(MAX_CLUMPS * 3);
    let clumpCursor = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        const rs = frame.params.rs ?? 0.13;
        diskFlow += dt * (0.5 + slow.mid * 1.1 + slow.low * 0.4);
        clumpGate += dt;
        flareAge += dt;
        const deck = dominant(frame);
        const key = deck?.trackId ?? 88;
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
        const section = Math.floor(bar / 16);
        if (section !== lastSection) {
          lastSection = section;
          rollTarget = (hash01(key + section * 37) - 0.5) * 0.9;
          spin = hash01(key * 11 + 5) > 0.5 ? 1 : -1;
          arms = 2 + Math.floor(hash01(key + section * 71) * 3);
        }
        roll += (rollTarget - roll) * (1 - Math.exp(-dt / 2.5));
        const targetHue = hash01(key) * 0.9 + frame.centroid * 0.25;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 2));
        // Keplerian clump orbits: tighter radius = faster sweep
        for (let i = 0; i < MAX_CLUMPS; i++) {
          const rIdx = i * 3 + 1;
          const heat = clumps[i * 3 + 2];
          if (heat < 0.01) continue;
          const r = Math.max(clumps[rIdx], rs * 1.2);
          clumps[i * 3] += dt * spin * 1.8 * Math.pow(rs * 2.2 / r, 1.5);
          clumps[rIdx] -= dt * r * 0.16;
          clumps[i * 3 + 2] = clumps[rIdx] < rs * 1.5 ? heat * Math.max(0, 1 - dt * 6) : heat * Math.max(0, 1 - dt * 0.24);
        }
        if (frame.impulse.low > 0.34 && clumpGate > 0.24) {
          clumpGate = 0;
          const i = clumpCursor;
          clumpCursor = (clumpCursor + 1) % MAX_CLUMPS;
          clumps[i * 3] = hash01(key + Math.floor(frame.time * 17) * 13) * Math.PI * 2;
          clumps[i * 3 + 1] = rs * (3.4 + hash01(key * 7 + Math.floor(frame.time * 11)) * 1.1);
          clumps[i * 3 + 2] = Math.min(1, frame.impulse.low);
        }
        if (frame.impulse.mid > 0.4 && flareAge > 0.28) {
          flareAge = 0;
          flareAmp = Math.min(1, frame.impulse.mid);
          flareAngle = hash01(key * 3 + Math.floor(frame.time * 19)) * Math.PI * 2;
        }
        // drop = jet ignition, decaying over the seconds after the hit
        const dropT = frame.regime?.dropTransition ?? 0;
        const dropAge = frame.regime?.dropAgeS ?? 99;
        jet = Math.max(jet * Math.max(0, 1 - dt * 0.35), Math.min(1, dropT * 1.2) * Math.exp(-Math.max(0, dropAge) * 0.25));
        const energy = energyOf(frame.bands);
        const drive = Math.min(1, Math.max(frame.regime?.sustained ?? 0, energy * 1.35));
        const buildup = frame.regime?.buildup ?? 0;
        return {
          u_time: frame.time,
          u_diskFlow: diskFlow,
          u_roll: roll,
          u_rs: rs,
          u_drag: (frame.params.drag ?? 1) * (0.7 + slow.low * 0.6),
          u_spin: spin,
          u_mass: (frame.params.massGain ?? 1) * (0.35 + slow.low * 1.15 + 0.25 * drive),
          u_hue: hue,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_arms: arms,
          u_innerR: rs * (1.85 - buildup * 0.3),
          u_hat: frame.impulse.high,
          u_drive: drive,
          u_wobble: buildup * 0.12,
          u_jet: jet,
          u_flareAge: flareAge, u_flareAmp: flareAmp, u_flareAngle: flareAngle,
          u_clumps: clumps,
        };
      },
    });
  },
};

export default preset;
