/**
 * g14-lattice-lucid (gen-14 NOVEL — dense-lattice resurrection). Fossil
 * g01-strobe-lattice / g02-lattice-dense read only for the autopsy:
 * "theres potential but not usable as is" — the dense grid was liked, the
 * motion made it unusable (rotating feedback smear, raw-kick field jumps,
 * near-instant quarter snaps, full-field strobe).
 *
 * Rebuild on legible motion:
 * - IDENTITY feedback sampling: ghosts are pure temporal decay (no
 *   rotation/zoom/kick warp of the trail field). Contractive: decay ≤
 *   0.92, injection ×(1−decay).
 * - The lattice never moves per-frame with audio: scroll rides bandsSlow
 *   (τ 0.4 s envelope); quarter-turns land on PHRASE boundaries, eased at
 *   τ 0.35 s, one direction per section.
 * - Kick = a traveling radial ring that LIGHTS nodes it passes + node
 *   core pump. Zero displacement anywhere.
 * - The strobe is replaced by a BPM-locked brightness wave: beat.phase
 *   positions a localized band sweeping the lattice (meter-locked speed).
 * - Section = hue-midpoint inversion (luminance parity, chroma event).
 * - Drop = QUANTIZED density step up + warm hue, held on max(drop,
 *   energy); buildup tightens/cools.
 *
 * Photosafety: no full-field flash envelope exists; the sweep and kick
 * ring are localized bands.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_scale;      // cells across (eased, drop-quantized step)
uniform float u_spin;       // accumulated quarter turns (phrase, eased)
uniform float u_scroll;     // accumulated scroll (bandsSlow-integrated)
uniform float u_wiring;     // tri..hex basis blend
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_twinkle;    // impulse.high envelope (fast decay)
uniform float u_glint;      // impulse.mid strut packet envelope
uniform float u_glintSeed;  // hashed axis pick for the glint packet
uniform float u_ringAge;
uniform float u_ringAmp;
uniform float u_beatPhase;  // 0..1 meter-locked sweep position
uniform float u_sweepGain;
uniform float u_hue;        // slow hue base (genome + centroid drift)
uniform float u_invert;     // section hue inversion 0/1 (eased)
uniform float u_drop;
uniform float u_buildup;
uniform float u_decay;
uniform float u_seed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 hsl2rgb(float h, float s, float l) {
  h = fract(h);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = vec3(0.0);
  if (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + (l - c * 0.5);
}

// Lattice basis: square -> triangular skew blended by wiring.
vec2 latticeBasis(vec2 p) {
  float w = clamp(u_wiring, 0.0, 2.0);
  vec2 tri = vec2(p.x + p.y * 0.5, p.y * 0.8660254);
  return mix(p, tri, clamp(w, 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);

  // Draw-space rotation (phrase-quantized, JS-eased) + slow scroll.
  float cs = cos(u_spin);
  float sn = sin(u_spin);
  vec2 q = mat2(cs, -sn, sn, cs) * c;
  q.y += u_scroll;
  vec2 g = latticeBasis(q) * u_scale;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;

  // Per-cell identity.
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  float h1 = hash(sc);
  float h2 = hash(sc.yx + 4.7);

  // ---- Kick ring: travels outward, LIGHTS what it passes (no warp).
  float front = 0.1 + u_ringAge * 1.1;
  float ring = exp(-pow((r - front) * 7.0, 2.0)) * exp(-u_ringAge * 2.4) * u_ringAmp;

  // ---- BPM-locked sweep: a localized diagonal brightness band whose
  // position IS the beat phase (meter-locked speed, never energy).
  float sweepPos = fract((q.x + q.y) * 0.6 + 0.5);
  float sweep = exp(-pow((sweepPos - u_beatPhase) * 5.0, 2.0)) * u_sweepGain;

  // ---- Nodes: gaussian cores. Low pumps size/brightness (solid response).
  float nodeSize = 20.0 - 9.0 * clamp(u_low + 0.8 * u_kick + 0.5 * u_drop, 0.0, 1.2);
  float node = exp(-dot(f, f) * nodeSize);
  float nodeGain = 0.35 + 0.9 * u_low + 1.3 * ring + 0.5 * sweep;
  // High twinkle: sparse hashed per-node sparkle, gated by the impulse
  // envelope (localized specks, fast decay — not dust).
  float sparkleOn = step(0.82, hash(sc * 1.618 + floor(u_seed)));
  float sparkle = sparkleOn * u_twinkle * (0.5 + 0.5 * h2);

  // ---- Struts: axis + diagonal wiring. Mid lights the wiring; a
  // one-shot glint packet (impulse.mid) runs down one hashed axis family.
  float dx = abs(f.y);
  float dy = abs(f.x);
  float dd = abs(f.x + f.y) * 0.7071;
  float strutX = exp(-dx * 26.0);
  float strutY = exp(-dy * 26.0);
  float strutD = exp(-dd * 26.0) * clamp(u_wiring - 0.5, 0.0, 1.0);
  float axisPick = floor(u_glintSeed * 3.0);
  float glintStrut = axisPick < 0.5 ? strutX : (axisPick < 1.5 ? strutY : strutD);
  // Packet position sweeps the cell axis during the envelope.
  float packetPos = fract(g.x * 0.23 + g.y * 0.31);
  float packet = exp(-pow((packetPos - (1.0 - u_glint)) * 6.0, 2.0)) * u_glint;
  float strut = (strutX + strutY + strutD)
    * (0.10 + 0.55 * u_mid + 0.35 * ring + 0.3 * sweep)
    * (1.0 - 0.35 * u_buildup);
  float glint = glintStrut * packet * 1.4;

  // ---- Color: hue travels slowly across the lattice; struts offset +30°;
  // section inversion mirrors hues around the midpoint (chroma event).
  float hueBase = u_hue + h1 * 0.06 + (q.x + q.y) * 0.03 + 0.06 * u_drop;
  float hueNode = mix(hueBase, hueBase + 0.5, u_invert);
  float hueStrut = hueNode + 0.083;
  float sat = 0.95 - 0.25 * u_buildup;
  vec3 nodeCol = hsl2rgb(hueNode, sat, 0.55) * (node * nodeGain + sparkle * node * 2.2);
  vec3 strutCol = hsl2rgb(hueStrut, sat, 0.5) * (strut + glint);

  vec3 fresh = nodeCol + strutCol;

  // ---- Ghosts: IDENTITY-sampled feedback — pure temporal decay, no
  // rotation/zoom/kick warp of the trail field (the fossil's swim engine).
  vec3 ghost = texture2D(u_prev, uv).rgb * u_decay;
  vec3 col = ghost + fresh * (1.0 - u_decay) * 3.4;

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** splitmix32-style scalar hash → stable [0,1). */
function splitmix(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

const candidate: VisualizerPreset = {
  id: 'g14-lattice-lucid',
  name: 'g14 lattice-lucid',
  hiRes: true,
  params: [
    { id: 'density', label: 'cells across', min: 6, max: 16, step: 0.5, default: 11 },
    { id: 'ghosts', label: 'trail persistence', min: 0.3, max: 1.6, step: 0.05, default: 1 },
    { id: 'sweep', label: 'beat sweep', min: 0, max: 1.5, step: 0.05, default: 0.8 },
    { id: 'wiring', label: 'wiring (square→tri+diag)', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let spinTarget = 0;
    let spinNow = 0;
    let spinDir = 1;
    let scroll = 0;
    let scrollVel = 0;
    let lastPhrase = -1;
    let lastSection = -1;
    let invertTarget = 0;
    let invertNow = 0;
    let ringAge = 999;
    let ringAmp = 0;
    let twinkle = 0;
    let glint = 0;
    let glintSeed = 0.2;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let hue = 0.6;
    let densityStep = 0;   // drop-quantized density notch (0 or 1)
    let scaleNow = 11;
    let genomeKey = -1;
    let hueBase = 0.6;
    let gridlessClock = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0.0001, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // Genome: hue base per dominant trackId.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }
        const key = dom?.trackId ?? 0;
        if (key !== genomeKey) {
          genomeKey = key;
          hueBase = splitmix(key) ;
        }

        // Trend split (~0.35 s, kit law).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const motion = frame.bandsSlow ?? frame.bands;
        const energyNow = (frame.bands.low + frame.bands.mid + frame.bands.high) / 3;
        const lift = Math.max(smoothDrop, Math.min(1, energyNow * 1.4));

        // Bar clock (ladder-correct; gridless fallback 2 s bars).
        let bar: number;
        let beatPhase: number;
        if (frame.beat) {
          bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          beatPhase = frame.beat.phase;
        } else {
          gridlessClock += dt;
          bar = Math.floor(gridlessClock / 2);
          beatPhase = (gridlessClock * 2) % 1;
        }
        const phrase = Math.floor(bar / 4);
        const section = Math.floor(bar / 16);
        if (phrase !== lastPhrase && lastPhrase >= 0) {
          spinTarget += spinDir * Math.PI * 0.5;   // quarter turn, eased below
        }
        lastPhrase = phrase;
        if (section !== lastSection && lastSection >= 0) {
          invertTarget = 1 - invertTarget;          // hue inversion (chroma event)
          spinDir = splitmix(section * 31 + 7) < 0.5 ? -1 : 1;
        }
        lastSection = section;

        // Quarter-turn ease τ 0.35 s (the fossil snapped at 0.09 s).
        spinNow += (spinTarget - spinNow) * (1 - Math.exp(-dt / 0.35));
        invertNow += (invertTarget - invertNow) * (1 - Math.exp(-dt / 0.6));

        // Scroll velocity: bandsSlow through a τ 0.4 s envelope; buildups slow.
        const velTarget = (0.008 + 0.03 * motion.mid) * (1 - 0.5 * smoothBuildup);
        scrollVel += (velTarget - scrollVel) * (1 - Math.exp(-dt / 0.4));
        scroll = (scroll + scrollVel * dt) % 1000;

        // Kick ring (light, not displacement).
        ringAge += dt;
        if (frame.impulse.low > 0.35 && ringAge > 0.12) {
          ringAge = 0;
          ringAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        // High twinkle: fast envelope (~0.15 s), localized specks.
        twinkle = Math.max(twinkle * Math.exp(-dt / 0.15), Math.min(1, frame.impulse.high * 1.2));
        // Mid glint packet: one-shot ~0.35 s run down a hashed axis.
        glint = glint * Math.exp(-dt / 0.35);
        if (frame.impulse.mid > 0.4 && glint < 0.25) {
          glint = Math.min(1, frame.impulse.mid);
          glintSeed = splitmix(Math.floor(frame.time * 37));
        }

        // Drop: quantized density notch, held on the plateau.
        densityStep += ((lift > 0.55 ? 1 : 0) - densityStep) * (1 - Math.exp(-dt / 0.5));
        const scaleTarget = (frame.params.density ?? 11) * (1 + 0.18 * densityStep);
        scaleNow += (scaleTarget - scaleNow) * (1 - Math.exp(-dt / 0.5));

        // Hue: slow centroid drift around the genome base.
        hue += (hueBase + (frame.centroid - 0.5) * 0.25 - hue) * (1 - Math.exp(-dt / 2.0));

        // Ghosts: contractive, short (decay ≤ 0.92 at max persistence).
        const ghosts = frame.params.ghosts ?? 1;
        const decay = Math.min(0.92, 1 - 0.10 / ghosts);

        return {
          u_scale: scaleNow,
          u_spin: spinNow,
          u_scroll: scroll,
          u_wiring: frame.params.wiring ?? 1,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_twinkle: twinkle,
          u_glint: glint,
          u_glintSeed: glintSeed,
          u_ringAge: ringAge,
          u_ringAmp: ringAmp,
          u_beatPhase: beatPhase,
          u_sweepGain: (frame.params.sweep ?? 0.8) * (0.5 + 0.5 * lift),
          u_hue: hue,
          u_invert: invertNow,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_decay: decay,
          u_seed: 7.31 + (genomeKey % 97),
        };
      },
    });
  },
};

export default candidate;
