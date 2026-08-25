/**
 * g14-voyage-comets (gen-14 WILDER tweak of g00-voyage: MEDIUM REPLACEMENT).
 *
 * MEDIUM DIVERSITY law: voyage descendants keep inheriting the advected
 * fine-dust feedback medium — a wash. This candidate REPLACES the mass/dust
 * technique with one from the approved list: LIGHT-TRAIL COMETS.
 *
 * Falsifiable question (brief): does a DISCRETE comet swarm on real orbits
 * give the voyage family a mid/high vocabulary that reads as individuals
 * with physics instead of an advected wash?
 *
 * KEPT from the champion (solid bass identity, verbatim idioms): coal
 * heart, charged horizon ring (2.5 s charge decay), localized black-hole
 * lens, traveling kick ripple that lights/pushes what it passes, kick
 * shockwave, unsharp feedback tap, chroma-preserving soft knee, film grain.
 *
 * DELETED: spiral dust lanes, fbm clouds, high-nebula wisps, star powder —
 * the whole dust medium. No new dust (dust-fatigue law).
 *
 * THE SWARM: 20 comets, orbits integrated JS-side (Kepler-flavored
 * ellipses, sun at the focus; inner comets orbit faster), positions fed as
 * uniform float arrays. Three FAMILIES with committed palette identities
 * (anti blue-wash):
 *   8 MID comets — copper/gold heads, brightness rides bands.mid;
 *   8 HIGH comets — small fast teal-white inner sparks, ride bands.high;
 *   4 GIANTS — violet-white long-period, faint until drops ignite them.
 * Each head draws an anti-sunward ion-tail spike; the feedback's
 * differential rotation smears heads into true curved light trails.
 *
 * MUSIC MAPPING:
 *   ORBITAL RATE  accumulates from bandsSlow energy + max(drop, energy)
 *                 — never instantaneous bands (motion smoothness law).
 *   KICK          the ripple wavefront SHOVES comets outward as it passes
 *                 (radial bump synced to the shader's ripple) — the solid
 *                 response stays with the horizon ring/shockwave.
 *   SNARE         the comet nearest the core FLARES white and swells
 *                 briefly (sheds its coma) — localized, photosafe.
 *   BUILDUP       orbits contract inward, heads cool/dim.
 *   DROP          rates lift, heads incandesce, giants light up — riding
 *                 max(drop, energy).
 *   SECTION       (ladderBarIndex ?? barIndex, 16 bars) orbit geometry
 *                 re-seeds from the trackId genome — a quantized scene
 *                 change. PHRASE: precession direction flips.
 *                 Same song = same orbit story.
 *
 * Contraction: decay < 1 always; the end-grade whole-field multiplier is
 * capped at 0.99 (drop drama lives in head brightness, not field gain);
 * the kick lift is the parent's transient envelope. Heads glow with speed
 * (velocity-normalized emission) so slow near-stationary giants cannot
 * accumulate to a pegged blob. GLSL ES 1.0, no backticks in GLSL.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const N = 20; // comet count (8 mid / 8 high / 4 giants)

// No backticks inside this GLSL string (GLSL ES 1.0).
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
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_rippleAge; // seconds since the last strong kick
uniform float u_rippleAmp; // that kick's captured strength
uniform float u_sustain;   // bass-weighted sustained loudness
uniform float u_charge;    // bass-ring charge (accumulated kick energy)
// --- The swarm (JS-integrated orbits).
uniform float u_cx[${N}];  // head x (aspect world space)
uniform float u_cy[${N}];  // head y
uniform float u_cb[${N}];  // brightness (0 = inactive)
uniform float u_cw[${N}];  // white-hot flare mix 0..1
uniform float u_cf[${N}];  // family 0 mid / 1 high / 2 giant
uniform float u_csz[${N}]; // head radius (world units)

// Committed family identities (anti blue-wash): copper/gold, teal-white,
// violet-white. Bright, saturated.
const vec3 MIDC = vec3(1.0, 0.58, 0.18);
const vec3 HIGHC = vec3(0.42, 0.95, 1.0);
const vec3 GIANTC = vec3(0.72, 0.5, 1.0);

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

vec3 famColor(float f) {
  vec3 c = MIDC;
  c = f > 0.5 ? HIGHC : c;
  c = f > 1.5 ? GIANTC : c;
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp (parent): differential rotation + localized lens + traveling
  // kick ripple. This is what curves comet heads into light trails.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
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
  vec2 src = (w + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration on the ripple/drop (parent, trimmed).
  vec2 ab = dirW * (0.001 + 0.003 * u_drop + 0.003 * u_kick + 0.008 * rippleWave)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp anti-mush tap (parent) — keeps trails crisp through resampling.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Solid bass identity (parent), injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring charges copper -> white-hot (committed warm identity, matches the
  // MID comet family so the scene holds one palette).
  vec3 chargeColor = mix(MIDC * 0.85, vec3(1.0, 0.85, 0.55), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  vec3 coal = vec3(0.30, 0.08, 0.04);
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, MIDC, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // ---- THE SWARM: discrete comet heads + anti-sunward ion tails, stamped
  // as moving transients (the feedback grows their curved trails).
  vec3 swarm = vec3(0.0);
  for (int i = 0; i < ${N}; i++) {
    float b = u_cb[i];
    if (b < 0.004) continue;
    vec2 p = vec2(u_cx[i], u_cy[i]);
    vec2 d = c - p;
    float d2 = dot(d, d);
    float sz = u_csz[i];
    float head = exp(-d2 / max(sz * sz, 1e-6));
    float pr = length(p);
    vec2 outw = pr > 1e-4 ? p / pr : vec2(1.0, 0.0);
    float along = dot(d, outw);
    float perp = d.x * (-outw.y) + d.y * outw.x;
    // Ion tail: a soft spike pointing away from the core.
    float tail = exp(-perp * perp / max(sz * sz * 2.5, 1e-6))
      * exp(-max(along, 0.0) / (sz * 8.0))
      * smoothstep(-sz, sz * 0.5, along);
    vec3 col = mix(famColor(u_cf[i]), vec3(1.0), u_cw[i]);
    swarm += col * (head * 1.7 + tail * 0.45) * b;
  }
  sky += swarm;

  // ---- Kick shockwave (parent) — the ripple's visible birth.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(chargeColor, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.1 + 0.7 * u_drop);
    // Whole-frame punch: transient envelope, returns to zero (photosafe).
    sky *= 1.0 + 0.08 * u_kick;
  }

  // Film grain (parent, fine).
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.01 + 0.015 * u_drop);

  // Buildup dims/cools; drop brightness lives in the HEADS, not a field
  // gain — CONTRACTION: the whole-field factor is capped at 0.99.
  sky *= min(0.99, 0.78 + 0.21 * max(u_drop, u_sustain) - 0.06 * u_buildup);
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'swarm', label: 'comet count', min: 0.3, max: 1, step: 0.05, default: 1 },
  { id: 'trails', label: 'trail persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'orbit speed', min: 0.3, max: 2, step: 0.05, default: 1 },
];

/** splitmix32-style avalanche → a generator of stable [0,1) scalars. */
function splitmix(key: number): () => number {
  let state = (key >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

/** Dominant audible deck's trackId (highest master-audible level). */
function dominantTrackId(frame: VisualizerFrameData): number | null {
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

interface Orbit {
  a: number; // semi-major axis (world units)
  e: number; // eccentricity
  tilt: number; // ellipse orientation
  omega: number; // angular rate at rate=1 (rad/s), signed (some retrograde)
  size: number; // head radius (world units)
  family: number; // 0 mid / 1 high / 2 giant
}

/** Seed the swarm's orbit geometry (a quantized scene: re-rolled per
 * section from the trackId genome — same song, same orbit story). */
function seedOrbits(key: number, section: number): Orbit[] {
  const next = splitmix(((key | 0) ^ Math.imul(section | 0, 0x85ebca6b)) >>> 0);
  const orbits: Orbit[] = [];
  for (let i = 0; i < N; i++) {
    const family = i < 8 ? 0 : i < 16 ? 1 : 2;
    let a: number;
    let e: number;
    let size: number;
    if (family === 0) {
      a = 0.18 + 0.2 * next();
      e = 0.35 * next();
      size = 0.01 + 0.006 * next();
    } else if (family === 1) {
      a = 0.1 + 0.12 * next();
      e = 0.25 * next();
      size = 0.005 + 0.004 * next();
    } else {
      a = 0.42 + 0.18 * next();
      e = 0.1 + 0.35 * next();
      size = 0.016 + 0.006 * next();
    }
    const retro = next() < 0.15 ? -1 : 1;
    orbits.push({
      a,
      e,
      tilt: next() * Math.PI * 2,
      omega: (0.16 / Math.pow(Math.max(a, 0.15), 1.5)) * retro,
      size,
      family,
    });
  }
  return orbits;
}

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

export const g14VoyageCometsPreset: VisualizerPreset = {
  id: 'g14-voyage-comets',
  name: 'g14 voyage-comets',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;

    // --- Swarm state (JS-integrated orbits).
    let seedKey: number | null = null;
    let orbits: Orbit[] = seedOrbits(1, 0);
    const phases = new Float32Array(N); // angular phase per comet
    const flares = new Float32Array(N); // snare flare envelope per comet
    let precDir = 1; // precession direction (flips each phrase)
    let lastPhraseIndex: number | null = null;
    let lastSectionIndex: number | null = null;
    let flareCooldown = 0;

    // Uniform arrays (allocated once, mutated per frame).
    const cx = new Float32Array(N);
    const cy = new Float32Array(N);
    const cb = new Float32Array(N);
    const cw = new Float32Array(N);
    const cf = new Float32Array(N);
    const csz = new Float32Array(N);

    // Init phases from a fixed roll so the first frame is already a swarm.
    const init = splitmix(0xc0ffee);
    for (let i = 0; i < N; i++) phases[i] = init() * Math.PI * 2;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        // motion: slow bands (erratic-motion law)
        const slow = frame.bandsSlow ?? frame.bands;
        const energyMotion = energyOf(slow);
        const speed = frame.params.speed ?? 1;
        const trailsParam = frame.params.trails ?? 1;
        const swarmScale = frame.params.swarm ?? 1;

        // Excitement split by bass presence (parent), temporally smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const sustainedMotion = Math.min(1, energyMotion * 1.4);

        // --- Genome + quantized scene changes.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101);
        const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        const sectionIndex = tierBar !== null ? Math.floor(tierBar / SECTION_BARS) : 0;
        const phraseIndex = tierBar !== null ? Math.floor(tierBar / PHRASE_BARS) : null;
        if (seedKey == null || key !== seedKey) {
          seedKey = key;
          orbits = seedOrbits(seedKey, sectionIndex);
          lastSectionIndex = sectionIndex;
        }
        if (lastSectionIndex !== null && sectionIndex !== lastSectionIndex) {
          // SECTION: re-seed orbit geometry — the quantized scene change.
          orbits = seedOrbits(seedKey, sectionIndex);
        }
        lastSectionIndex = sectionIndex;
        if (phraseIndex !== null && lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
          precDir = -precDir; // PHRASE: precession direction flips.
        }
        lastPhraseIndex = phraseIndex;

        // --- Orbital rate: SLOW energy + drop plateau (motion smoothness law).
        const rate =
          Math.min(1.4, 0.25 + 0.75 * sustainedMotion + 0.6 * Math.max(drop, sustainedMotion)) *
          speed;

        // Ring charge + traveling ripple (parent).
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const waveFront = 0.16 + rippleAge * 0.9;
        const waveGain = Math.exp(-rippleAge * 2.4) * rippleAmp;

        // Buildups contract the swarm inward; drops breathe it out a little.
        const radiusScale = 1 - 0.22 * buildup + 0.05 * drop;

        // --- Snare flare: the comet nearest the core flares white + swells.
        flareCooldown = Math.max(0, flareCooldown - dt);
        let flareTarget = -1;
        if (frame.impulse.mid > 0.4 && flareCooldown <= 0) {
          flareCooldown = 0.25;
          let bestR = 1e9;
          for (let i = 0; i < N; i++) {
            const o = orbits[i];
            const rNow = o.a * (1 - o.e * Math.cos(phases[i]));
            if (rNow < bestR) {
              bestR = rNow;
              flareTarget = i;
            }
          }
        }

        // --- Integrate the swarm.
        const active = Math.max(4, Math.round(N * swarmScale));
        for (let i = 0; i < N; i++) {
          const o = orbits[i];
          phases[i] += o.omega * rate * dt;
          o.tilt += precDir * 0.03 * rate * dt;
          if (i === flareTarget) flares[i] = 1;
          flares[i] = Math.max(0, flares[i] - dt / 0.45);

          // Kepler-flavored ellipse, sun at the focus.
          const b = o.a * Math.sqrt(1 - o.e * o.e);
          const lx = o.a * Math.cos(phases[i]) - o.a * o.e;
          const ly = b * Math.sin(phases[i]);
          const ct = Math.cos(o.tilt);
          const st = Math.sin(o.tilt);
          let x = (lx * ct - ly * st) * radiusScale;
          let y = (lx * st + ly * ct) * radiusScale;
          // Kick shove: the ripple wavefront pushes the comet outward as it
          // passes (same waveFront the shader draws — synced physics).
          const rNow = Math.hypot(x, y);
          const push = Math.exp(-Math.pow((rNow - waveFront) * 9, 2)) * waveGain;
          const shove = 1 + 0.16 * push;
          x *= shove;
          y *= shove;

          cx[i] = x;
          cy[i] = y;
          cf[i] = o.family;
          // Flare swells the head (sheds its coma) — localized, photosafe.
          csz[i] = o.size * (1 + 0.8 * flares[i]);
          cw[i] = flares[i];
          if (i >= active) {
            cb[i] = 0;
            continue;
          }
          // Brightness: family band (instantaneous — brightness may jump),
          // velocity-normalized so slow comets can't accumulate to a blob,
          // dimmed through buildups, ignited on drops (giants especially).
          const famBand =
            o.family === 0
              ? 0.2 + 1.2 * frame.bands.mid
              : o.family === 1
                ? 0.15 + 1.3 * frame.bands.high
                : 0.06 + 0.25 * energy + 1.5 * Math.max(drop, 0.6 * sustained);
          const emission = Math.min(1, 0.35 + 0.65 * rate);
          cb[i] =
            famBand * emission * (1 - 0.35 * buildup) * (1 + 0.5 * push) +
            1.4 * flares[i];
        }

        // Trails: long feedback, contraction-safe (decay < 1 always).
        const baseDecay = 0.955 - 0.01 * buildup;
        const decay = Math.min(0.985, 1 - (1 - baseDecay) / trailsParam);

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: drop,
          u_buildup: buildup,
          // Gentle breathing zoom + kick lunge (orbits stay stable; the
          // rotation does the trail-curving work). Rate terms on slow bands.
          u_zoom: 1 + (0.015 + 0.35 * frame.impulse.low) * dt,
          u_rotStep: (0.03 + 0.22 * slow.mid + 0.1 * sustainedMotion) * dt,
          u_decay: decay,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_charge: charge,
          u_cx: cx,
          u_cy: cy,
          u_cb: cb,
          u_cw: cw,
          u_cf: cf,
          u_csz: csz,
        };
      },
    });
  },
};

export default g14VoyageCometsPreset;
