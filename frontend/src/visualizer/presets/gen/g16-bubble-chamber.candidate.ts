import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const MAX_TRACKS = 16;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_decay;
uniform float u_drive;
uniform float u_hat;
uniform float u_vertexAge;
uniform float u_vertexAmp;
uniform vec2 u_vertexPos;
uniform float u_beamAge;
uniform float u_beamY;
uniform float u_hue;
uniform float u_tips[96];

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // the memory: bubbles rise slowly and shimmer as they age
  vec2 drift = vec2(sin(p.y * 9.0 + u_time * 0.6) * 0.06, -1.0) * u_dt * 22.0 / u_res.y;
  vec3 field = texture2D(u_prev, uv + drift).rgb * u_decay;

  // fresh injection: only the moving tip SEGMENTS — the trail is the feedback
  vec3 fresh = vec3(0.0);
  float px = 1.0 / u_res.y;
  for (int i = 0; i < 16; i++) {
    vec2 a = vec2(u_tips[i * 6 + 0], u_tips[i * 6 + 1]);
    vec2 b = vec2(u_tips[i * 6 + 2], u_tips[i * 6 + 3]);
    float amp = u_tips[i * 6 + 4];
    float hue = u_tips[i * 6 + 5];
    if (amp < 0.01) continue;
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    vec2 d = p - (a + ab * h);
    float g = exp(-dot(d, d) / (px * px * 18.0));
    // beaded bubbles along the stroke
    float bead = 0.75 + 0.25 * sin((a.x + a.y + h * length(ab)) * 900.0);
    fresh += hsv(vec3(hue, 0.78, 1.0)) * g * amp * bead;
  }
  // collision vertex: a localized flash with a tight halo
  vec2 vd = p - u_vertexPos;
  float vflash = exp(-dot(vd, vd) * 2200.0) * exp(-u_vertexAge * 8.0) * u_vertexAmp;
  float vhalo = exp(-dot(vd, vd) * 320.0) * exp(-u_vertexAge * 6.0) * u_vertexAmp;
  fresh += vec3(1.0, 0.97, 0.9) * vflash * 2.0 + hsv(vec3(fract(u_hue + 0.05), 0.5, 1.0)) * vhalo * 0.25;
  // bar-tick beam pulse: a dim thin particle beam entering from the left
  float beamX = -0.95 + u_beamAge * 3.4;
  float beam = exp(-pow((p.y - u_beamY) * 110.0, 2.0)) * exp(-pow((p.x - beamX) * 22.0, 2.0)) * exp(-u_beamAge * 3.0);
  fresh += hsv(vec3(fract(u_hue + 0.5), 0.6, 1.0)) * beam * 0.35;

  field += fresh * (1.0 - u_decay) * 30.0;

  // the chamber: cold deep liquid, barely lit
  vec3 ground = vec3(0.012, 0.02, 0.036) * (0.7 + 0.3 * u_drive);
  ground += hsv(vec3(fract(u_hue + 0.55), 0.7, 1.0)) * 0.012 * (1.0 - length(p) * 0.9);
  // sparse hat glints: fine microbubbles catching the flash lamps
  float mb = pow(hash(floor(p * 170.0) + floor(u_time * 3.0)), 120.0);
  ground += vec3(0.7, 0.85, 1.0) * mb * u_hat * 0.25;

  vec3 col = ground + field;
  col *= 1.0 - 0.4 * dot(p * 0.8, p * 0.8);
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

function fract(x: number): number {
  return x - Math.floor(x);
}

function dominant(frame: VisualizerFrameData) {
  return frame.decks.find((deck) => deck.channel === frame.dominantChannel) ?? null;
}

interface Track {
  /** Circle center. */
  cx: number;
  cy: number;
  /** Current radius (shrinks: energy loss spiral). */
  r: number;
  /** Current angle on the circle. */
  a: number;
  /** Angular speed sign*magnitude (charge and momentum). */
  w: number;
  /** Seconds of life left drawing. */
  life: number;
  amp: number;
  hue: number;
  /** Neutral tracks fly straight then fork. */
  forkIn: number;
  /** Previous tip (segment stamping). */
  px: number;
  py: number;
}

const preset: VisualizerPreset = {
  id: 'g16-bubble-chamber',
  name: 'g16 bubble-chamber',
  hiRes: true,
  params: [
    { id: 'field', label: 'magnet field', min: 0.4, max: 2.2, step: 0.05, default: 1 },
    { id: 'persist', label: 'bubble persist', min: 0.5, max: 1.5, step: 0.05, default: 1 },
    { id: 'multiplicity', label: 'event size', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  ],
  create: () => {
    const tracks: Track[] = [];
    const tips = new Float32Array(MAX_TRACKS * 6);
    let vertexAge = 99;
    let vertexAmp = 0;
    let vertexPos: [number, number] = [0, 0];
    let beamAge = 99;
    let beamY = 0;
    let lastBar = -1;
    let lastSection = -1;
    let polarity = 1;
    let hue = 0.55;
    let kickGate = 0;
    let snareGate = 0;
    let rng = 1;
    const rand = () => {
      rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
      return rng / 4294967296;
    };
    const spawnCharged = (x: number, y: number, dir: number, mom: number, B: number, amp: number, h: number) => {
      if (tracks.length >= MAX_TRACKS) tracks.shift();
      // curvature radius ~ momentum / field
      const r = Math.max(0.03, (0.06 + mom * 0.5) / B);
      const charge = rand() > 0.5 ? 1 : -1;
      const side = charge * polarity;
      // circle center is perpendicular to the launch direction
      const cx = x + Math.cos(dir + (Math.PI / 2) * side) * r;
      const cy = y + Math.sin(dir + (Math.PI / 2) * side) * r;
      tracks.push({
        cx, cy, r,
        a: Math.atan2(y - cy, x - cx),
        // positive side = counterclockwise; tip velocity starts along `dir`
        w: (side * (0.45 + mom * 1.05)) / r,
        life: 0.5 + rand() * 0.9,
        amp,
        hue: fract(h + (rand() - 0.5) * 0.1),
        forkIn: 0,
        px: x, py: y,
      });
    };
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        const deck = dominant(frame);
        const key = deck?.trackId ?? 61;
        vertexAge += dt;
        beamAge += dt;
        kickGate += dt;
        snareGate += dt;
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : -1;
        if (bar !== lastBar && bar >= 0) {
          lastBar = bar;
          beamAge = 0;
          beamY = (hash01(key + bar * 7) - 0.5) * 0.8;
        }
        const section = Math.floor(Math.max(0, bar) / 16);
        if (section !== lastSection) {
          lastSection = section;
          polarity = hash01(key + section * 41) > 0.5 ? 1 : -1;
        }
        const targetHue = hash01(key) * 0.9 + frame.centroid * 0.2;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 2.5));
        const B = (frame.params.field ?? 1) * (0.7 + slow.low * 1.4);
        const spreadHue = 0.06 + frame.spread * 0.2;
        // kick: collision event at a genome lattice point
        if (frame.impulse.low > 0.32 && kickGate > 0.22) {
          kickGate = 0;
          const j = Math.floor(frame.time * 15);
          const gx = (hash01(key + j * 11) - 0.5) * 1.15;
          const gy = (hash01(key * 3 + j * 29) - 0.5) * 0.7;
          vertexAge = 0;
          vertexAmp = Math.min(1, frame.impulse.low);
          vertexPos = [gx, gy];
          const drop = frame.regime?.dropTransition ?? 0;
          const count = Math.round((4 + rand() * 3 + drop * 3) * (frame.params.multiplicity ?? 1));
          const baseDir = rand() * Math.PI * 2;
          for (let k = 0; k < count; k++) {
            const dir = baseDir + (rand() - 0.5) * 2.4 + (k / count) * Math.PI * 2 * 0.35;
            spawnCharged(gx, gy, dir, 0.15 + rand() * 0.85, B, 0.5 + vertexAmp * 0.5, hue + (rand() - 0.5) * spreadHue * 2);
          }
        }
        // snare: neutral track that forks into a charged V
        if (frame.impulse.mid > 0.38 && snareGate > 0.3) {
          snareGate = 0;
          if (tracks.length >= MAX_TRACKS) tracks.shift();
          const j = Math.floor(frame.time * 13);
          const x = (hash01(key * 7 + j * 17) - 0.5) * 1.0;
          const y = (hash01(key * 13 + j * 23) - 0.5) * 0.6;
          const r = 40;
          const a = rand() * Math.PI * 2;
          tracks.push({
            // center placed so the tip STARTS at (x, y) on a huge circle
            cx: x - Math.cos(a) * r, cy: y - Math.sin(a) * r, r, a,
            w: ((rand() > 0.5 ? 1 : -1) * 0.85) / r,
            life: 1.2, amp: Math.min(1, frame.impulse.mid) * 0.9,
            hue: fract(hue + 0.45),
            forkIn: 0.22 + rand() * 0.14,
            px: x, py: y,
          });
        }
        // hats: fingernail delta-ray curls near the action
        if (frame.impulse.high > 0.45 && tracks.length > 0 && tracks.length < MAX_TRACKS && rand() > 0.5) {
          const host = tracks[Math.floor(rand() * tracks.length)];
          const hx = host.cx + Math.cos(host.a) * host.r;
          const hy = host.cy + Math.sin(host.a) * host.r;
          if (Math.abs(hx) < 0.9 && Math.abs(hy) < 0.55) {
            spawnCharged(hx, hy, rand() * Math.PI * 2, 0.03, B * 1.5, 0.35, hue + 0.12);
          }
        }
        // integrate tips; forks spawn AFTER the loop (no mid-iteration mutation)
        const forks: Array<{ x: number; y: number; dir: number; amp: number; hue: number }> = [];
        for (let i = tracks.length - 1; i >= 0; i--) {
          const t = tracks[i];
          t.px = t.cx + Math.cos(t.a) * t.r;
          t.py = t.cy + Math.sin(t.a) * t.r;
          t.a += t.w * dt;
          if (t.forkIn > 0) {
            t.forkIn -= dt;
            if (t.forkIn <= 0) {
              const x = t.cx + Math.cos(t.a) * t.r;
              const y = t.cy + Math.sin(t.a) * t.r;
              t.life = 0;
              const dir = t.a + (Math.PI / 2) * Math.sign(t.w);
              forks.push({ x, y, dir, amp: t.amp, hue: t.hue });
            }
          } else {
            // energy loss: the spiral tightens as it slows
            t.r = Math.max(0.012, t.r * (1 - dt * 0.55));
            t.w *= 1 + dt * 0.55;
          }
          t.life -= dt;
          const x = t.cx + Math.cos(t.a) * t.r;
          const y = t.cy + Math.sin(t.a) * t.r;
          if (t.life <= 0 || Math.abs(x) > 1.2 || Math.abs(y) > 0.75) {
            tracks.splice(i, 1);
          }
        }
        for (const f of forks) {
          spawnCharged(f.x, f.y, f.dir + 0.25, 0.3 + rand() * 0.4, B, f.amp, f.hue);
          spawnCharged(f.x, f.y, f.dir - 0.25, 0.3 + rand() * 0.4, B, f.amp, fract(f.hue + 0.08));
        }
        // write the segment roster after all mutations settled
        tips.fill(0);
        for (let i = 0; i < tracks.length && i < MAX_TRACKS; i++) {
          const t = tracks[i];
          tips[i * 6 + 0] = t.px;
          tips[i * 6 + 1] = t.py;
          tips[i * 6 + 2] = t.cx + Math.cos(t.a) * t.r;
          tips[i * 6 + 3] = t.cy + Math.sin(t.a) * t.r;
          tips[i * 6 + 4] = t.amp * Math.min(1, Math.max(0, t.life) * 3);
          tips[i * 6 + 5] = t.hue;
        }
        const persist = frame.params.persist ?? 1;
        const drive = Math.min(
          1,
          Math.max(frame.regime?.sustained ?? 0, (slow.low + slow.mid + slow.high) * 0.5)
        );
        return {
          u_time: frame.time,
          u_dt: dt,
          u_decay: Math.min(0.975, 1 - (1 - 0.955) / persist),
          u_drive: drive,
          u_hat: frame.impulse.high,
          u_vertexAge: vertexAge, u_vertexAmp: vertexAmp, u_vertexPos: vertexPos,
          u_beamAge: beamAge, u_beamY: beamY,
          u_hue: hue,
          u_tips: tips,
        };
      },
    });
  },
};

export default preset;
