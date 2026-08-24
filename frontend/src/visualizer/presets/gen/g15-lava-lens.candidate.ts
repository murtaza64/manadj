/**
 * "g15 lava-lens" (gen-15, fluids/flow lens — novel): liquid metaballs as
 * LENSES. The house's signature aberration fluid lives inside the feedback
 * resampler; this candidate rebuilds the idea as surface-tension optics —
 * a lava-lamp of molten glass blobs, and every blob REFRACTS the previous
 * frame through its own body with chromatic dispersion (three taps at
 * different refraction strengths). Overlapping blobs compound refraction
 * frame-over-frame: the trippy engine, now with a physical body.
 *
 * The fluid: 9 CPU-integrated blobs (buoyant rise on slow energy, lateral
 * wobble, smooth-field union so touching blobs neck and merge — surface
 * tension) + 3 droplet slots (snare pinches a droplet off, it falls and
 * dies). |F−1| is the meniscus: a thin bright rim line + a moving
 * specular glint per blob.
 *
 * Music mapping:
 *   bandsSlow energy → buoyancy (the lamp heats up with the music)
 *   impulse.low      → radial kick to all blob velocities + radius pulse
 *   impulse.mid      → droplet pinch-off
 *   flatness         → FROST: noisy sound = frosted glass (jittered
 *                      refraction), tonal = crystal clear (gen-2 theme)
 *   spread           → dispersion width (wide spectrum = wide fringes)
 *   max(drop, sustained) → background glow lift (bounded)
 *   section (ladder) → polarity flip: bright-glass-on-dark ↔
 *                      dark-glass-on-glow (eased ~1.2s, photosafe)
 *
 * Contraction: the refracted prev is scaled by decay < 1 everywhere, the
 * fresh background is injected at (1 − decay)-equivalent weights, and all
 * accents (rim, specular) are bounded MIXes — nothing compounds. GLSL ES
 * 1.0, constant loops, no backticks. Chroma-preserving soft knee.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const BLOB_N = 9;
const DROP_N = 3;
const TOTAL = BLOB_N + DROP_N; // 12

/** splitmix-style bit mix folded to [0,1) — per-track genome anchor. */
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
uniform float u_decay;     // inside-glass feedback survival (< 1)
uniform float u_refr;      // refraction strength
uniform float u_disp;      // chromatic dispersion width
uniform float u_frost;     // frosted-glass jitter (flatness)
uniform float u_glow;      // drop-plateau background lift
uniform float u_kick;
uniform float u_flip;      // section polarity 0..1
uniform float u_hue;       // per-track palette anchor
uniform float u_bx[12];
uniform float u_by[12];
uniform float u_br[12];

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

vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 0.86, 0.7) * t + vec3(0.0, 0.33, 0.64) + u_hue));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Metaball field + gradient (smooth union = surface tension).
  float F = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    float rr = u_br[i];
    if (rr > 0.001) {
      vec2 bp = (vec2(u_bx[i], u_by[i]) - 0.5) * vec2(aspect, 1.0);
      vec2 d = p - bp;
      float d2 = dot(d, d) + 0.0008;
      float c = rr * rr / d2;
      F += c;
      grad += (-2.0 * c / d2) * d;
    }
  }
  float inside = smoothstep(0.95, 1.3, F);

  // ---- Refraction of the previous frame (the lens): dispersion via three
  // taps at staggered strengths; frost jitters the tap (spectral flatness).
  vec2 off = grad * (0.014 * u_refr) / (1.0 + 0.22 * F * F);
  float offLen = length(off);
  if (offLen > 0.09) off *= 0.09 / offLen;
  off += (vec2(
    noise(p * 52.0 + u_time * 2.0),
    noise(p * 52.0 + vec2(7.7, 3.9) - u_time * 2.0)
  ) - 0.5) * 0.022 * u_frost * inside;
  vec2 offUv = off / vec2(aspect, 1.0);
  float dR = 1.0 - 0.16 * u_disp;
  float dB = 1.0 + 0.2 * u_disp;
  vec3 refr = vec3(
    texture2D(u_prev, uv + offUv * dR).r,
    texture2D(u_prev, uv + offUv).g,
    texture2D(u_prev, uv + offUv * dB).b
  );
  vec3 still = texture2D(u_prev, uv).rgb;

  // ---- Fresh background: a slow molten glow (bounded, polarity-aware).
  float bgLevel = mix(0.16 + 0.16 * u_glow, 0.5 + 0.12 * u_glow, u_flip);
  vec3 bg = pal(p.y * 0.7 + fbm(p * 1.7 + u_time * 0.03) * 0.55 + u_time * 0.014) * bgLevel;

  // ---- Compose. Outside: mostly fresh background with a short ghost
  // trail. Inside: the compounding refracted field through glass tint.
  vec3 tint = mix(vec3(0.99, 0.995, 1.0), vec3(0.5, 0.55, 0.68), u_flip);
  vec3 colOut = bg * 0.45 + still * 0.55;
  vec3 colIn = refr * u_decay * tint + bg * (1.0 - u_decay) * 0.6;
  // Kick punch: transient-envelope lift inside the glass (returns to zero).
  colIn *= 1.0 + 0.14 * u_kick;
  vec3 col = mix(colOut, colIn, inside);

  // ---- Meniscus: surface-tension rim line at the F≈1 shell (bounded mix).
  float rim = exp(-pow((F - 1.07) * 7.5, 2.0));
  vec3 rimColor = pal(0.55 + u_time * 0.01) * (0.75 + 0.5 * u_kick + 0.35 * u_glow);
  col = mix(col, min(rimColor, vec3(1.2)), rim * 0.55);

  // ---- Specular glint from the field gradient (bounded mix).
  vec3 n = normalize(vec3(-grad * 0.3, 1.0));
  float spec = pow(max(dot(n, normalize(vec3(-0.35, 0.5, 0.85))), 0.0), 50.0);
  col = mix(col, vec3(1.0, 0.98, 0.94), spec * inside * 0.55);

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.8) {
    col *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

interface Blob {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
}

const g15LavaLensPreset: VisualizerPreset = {
  id: 'g15-lava-lens',
  name: 'g15 lava-lens',
  hiRes: true,
  params: [
    { id: 'scale', label: 'blob scale', min: 0.6, max: 1.6, step: 0.05, default: 1 },
    { id: 'dispersion', label: 'dispersion', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'rise', label: 'rise speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 1.4, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const blobs: Blob[] = [];
    for (let i = 0; i < BLOB_N; i++) {
      blobs.push({
        x: 0.1 + Math.random() * 0.8,
        y: Math.random(),
        r: 0.055 + Math.random() * 0.075,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
    interface Droplet {
      x: number;
      y: number;
      r: number;
      vy: number;
      life: number;
    }
    const droplets: Droplet[] = [];
    for (let i = 0; i < DROP_N; i++) droplets.push({ x: 0, y: -1, r: 0, vy: 0, life: 0 });
    const bx = new Float32Array(TOTAL);
    const by = new Float32Array(TOTAL);
    const br = new Float32Array(TOTAL);
    let kickEnv = 0;
    let kickAge = 999;
    let smoothGlow = 0;
    let flip = 0;
    let flipTarget = 0;
    let lastSection: number | null = null;
    let slowFlat = 0.3;
    let slowSpread = 0.5;
    let hue = 0;
    let hueTarget = 0;
    let lastTrack: number | null = null;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const motion = frame.bandsSlow ?? frame.bands;
        const energySlow = energyOf(motion);
        const riseParam = frame.params.rise ?? 1;
        const scale = frame.params.scale ?? 1;

        // Sustained glow: max(drop, energy) smoothed (~0.35s).
        const regime = frame.regime;
        const lift = regime
          ? Math.max(regime.sustained, regime.dropTransition)
          : Math.min(1, Math.max(frame.trend.excitement, energyOf(frame.bands) * 1.3));
        smoothGlow += (lift - smoothGlow) * (1 - Math.exp(-dt / 0.35));

        // Material identity: slow-tracked flatness (frost) + spread (dispersion).
        slowFlat += (frame.flatness - slowFlat) * (1 - Math.exp(-dt / 0.8));
        slowSpread += (frame.spread - slowSpread) * (1 - Math.exp(-dt / 0.8));

        // Kick: radial impulse to all blobs + radius pulse.
        kickAge += dt;
        const kick = frame.impulse.low;
        if (kick > 0.3 && kickAge > 0.15) {
          kickAge = 0;
          kickEnv = Math.min(1, kick * 1.2);
          for (const b of blobs) {
            const dx = b.x - 0.5;
            const dy = b.y - 0.5;
            const len = Math.hypot(dx, dy) + 1e-4;
            b.vx += (dx / len) * kick * 0.14;
            b.vy += (dy / len) * kick * 0.14;
          }
        }
        kickEnv *= Math.exp(-dt / 0.14);

        // Buoyant integration (rise on slow energy — motion law).
        const rise = (0.015 + 0.11 * energySlow) * riseParam;
        for (const b of blobs) {
          const targetVy = rise * (0.55 + 0.65 * Math.sin(b.phase + frame.time * 0.23));
          b.vy += (targetVy - b.vy) * (1 - Math.exp(-dt / 1.6));
          b.vx += Math.sin(frame.time * 0.5 + b.phase * 7.3) * 0.01 * dt;
          b.vx *= Math.exp(-dt / 1.8);
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.x < 0.04) b.x = 0.04;
          if (b.x > 0.96) b.x = 0.96;
          if (b.y > 1.2) {
            b.y = -0.2;
            b.x = 0.1 + Math.random() * 0.8;
            b.r = 0.055 + Math.random() * 0.075;
            b.vy = 0;
          }
        }

        // Snare: pinch a droplet off a random blob; it falls and dies.
        const snare = frame.impulse.mid;
        if (snare > 0.32) {
          const slot = droplets.find((d) => d.life <= 0);
          if (slot) {
            const host = blobs[Math.floor(Math.random() * BLOB_N)];
            slot.x = host.x + (Math.random() - 0.5) * 0.08;
            slot.y = host.y + host.r * 0.9;
            slot.r = 0.024 + 0.02 * Math.random();
            slot.vy = 0.1;
            slot.life = 2.6;
          }
        }
        for (const d of droplets) {
          if (d.life > 0) {
            d.life -= dt;
            d.vy -= 0.28 * dt; // gravity: the pinched droplet falls
            d.y += d.vy * dt;
            d.r *= Math.exp(-dt / 4);
            if (d.y < -0.15 || d.life <= 0) {
              d.life = 0;
              d.r = 0;
            }
          }
        }

        // Pack uniform arrays.
        const rScale = scale * (1 + 0.3 * kickEnv);
        for (let i = 0; i < BLOB_N; i++) {
          bx[i] = blobs[i].x;
          by[i] = blobs[i].y;
          br[i] = blobs[i].r * rScale;
        }
        for (let i = 0; i < DROP_N; i++) {
          bx[BLOB_N + i] = droplets[i].x;
          by[BLOB_N + i] = droplets[i].y;
          br[BLOB_N + i] = droplets[i].r * scale;
        }

        // Section polarity flip (ladder tiers), eased ~1.2s — photosafe.
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
        const section = bar !== null ? Math.floor(bar / 16) : null;
        if (section !== null) {
          if (lastSection !== null && section !== lastSection) flipTarget = flipTarget > 0.5 ? 0 : 1;
          lastSection = section;
        }
        flip += (flipTarget - flip) * (1 - Math.exp(-dt / 1.2));

        // Per-track palette anchor (dominance law), eased ~2s.
        const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
        const track = dom?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          hueTarget = splitmix01(track);
        }
        hue += (hueTarget - hue) * (1 - Math.exp(-dt / 2.0));

        const persistence = frame.params.persistence ?? 1;
        const decay = Math.min(0.985, 1 - (1 - 0.962) / persistence);

        return {
          u_time: frame.time,
          u_decay: decay,
          u_refr: 1,
          u_disp: (frame.params.dispersion ?? 1) * (0.5 + 0.9 * slowSpread),
          u_frost: Math.max(0, (slowFlat - 0.25) * 1.8),
          u_glow: smoothGlow,
          u_kick: kick,
          u_flip: flip,
          u_hue: hue,
          u_bx: bx,
          u_by: by,
          u_br: br,
        };
      },
    });
  },
};

export default g15LavaLensPreset;
