/**
 * g08-voyage-flock — MEDIUM REPLACEMENT of Voyage's fine-dust wash.
 *
 * Brief: keep voyage's skeleton (kick ripple, charged horizon ring, lens)
 * but the mass is a FLOCKING SWARM of ~150-300 discrete bright DARTS —
 * elongated sprites with a heading, rendered as crisp countable individuals
 * (the eye counts them, not reads a wash). No dust, no fbm cloud: legible
 * individuals or it fails.
 *
 * Medium construction: 16 CPU-simulated SQUADRONS (boid leaders) with
 * position + heading, packed as flat float uniform arrays
 * (u_sqPos[32] = x,y ; u_sqHead[16] = angle ; u_sqTight[16] = spread).
 * Each squadron renders MEMBERS_PER_SQ darts in-shader, hash-placed around
 * its leader and all elongated along the shared heading — so alignment reads
 * as squadron behaviour. 16 x 14 = 224 discrete darts. The dart shape is an
 * anisotropic capsule (long in heading, thin across) with a wingtip glint.
 *
 * Boid steering (CPU): cohesion + alignment + separation, all steering
 * toward a shared murmuration heading target that snaps on the beat grid.
 *
 * Band mapping (per brief):
 *   LOWS  = flock cohesion/mass — heavy bass: tight dense murmuration knots
 *           (squadrons pull together, spread shrinks); bass kill: scatter wide.
 *   MIDS  = dart COLOUR (committed violet/gold identity; palette param swaps
 *           among 3 duos — violet/gold, crimson/cyan, emerald/magenta;
 *           never blue-wash).
 *   HIGHS = wingtip glints + trail crispness.
 *
 * Events:
 *   kick  = the traveling ripple SCATTERS darts it passes (burst apart at
 *           the wavefront, regroup after) — a visible physical reaction.
 *   snare = one squadron snaps a hard turn.
 *   beat  = the murmuration changes heading target on the quantized grid.
 *   drop  = full murmuration frenzy (fast coherent swirls) riding
 *           max(drop, energy).
 *   buildup = the flock compresses toward the core (tension).
 *   section = formation regime change (stream / shell / helix).
 *
 * Self-contained; GL context-loss safe; feedback uses a chroma-preserving
 * soft knee (never per-channel clamp). GLSL ES 1.0, no backticks in source,
 * uniform arrays sized exactly, loop-constant int indexing.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SQUADRONS = 16;
const MEMBERS_PER_SQ = 14; // 16 * 14 = 224 discrete darts

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
uniform float u_sustain;
uniform float u_decay;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_charge;
uniform float u_palette;    // 0..1 across 3 committed duos
uniform float u_dartLen;    // dart elongation (frenzy stretches them)
uniform float u_glint;      // HIGH wingtip glint gain
uniform float u_formation;  // 0 stream .. 1 shell .. 2 helix
uniform float u_sqPos[${SQUADRONS * 2}];
uniform float u_sqHead[${SQUADRONS}];
uniform float u_sqTight[${SQUADRONS}];

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Three COMMITTED duos (body / glint). Never blue-wash.
//   duo 0: violet body   / gold glint
//   duo 1: crimson body  / cyan glint
//   duo 2: emerald body  / magenta glint
void duo(out vec3 body, out vec3 glint) {
  float x = clamp(u_palette, 0.0, 1.0) * 2.0;
  vec3 b0 = vec3(0.62, 0.14, 0.95); vec3 g0 = vec3(1.0, 0.82, 0.15);
  vec3 b1 = vec3(0.95, 0.10, 0.28); vec3 g1 = vec3(0.15, 0.92, 1.0);
  vec3 b2 = vec3(0.06, 0.80, 0.42); vec3 g2 = vec3(1.0, 0.16, 0.78);
  body = mix(b0, b1, clamp(x, 0.0, 1.0));
  body = mix(body, b2, clamp(x - 1.0, 0.0, 1.0));
  glint = mix(g0, g1, clamp(x, 0.0, 1.0));
  glint = mix(glint, g2, clamp(x - 1.0, 0.0, 1.0));
  body = mix(body, glint, 0.22 * u_mid);
  body += vec3(0.10, 0.02, 0.02) * u_drop;
}

// Anisotropic dart: long along heading (dir), thin across. Returns intensity.
float dart(vec2 p, vec2 dir, float len, float wid) {
  vec2 perp = vec2(-dir.y, dir.x);
  float along = dot(p, dir);
  float across = dot(p, perp);
  // capsule-ish: crisp core so the eye counts individuals
  float body = exp(-across * across / (wid * wid)) * exp(-max(0.0, abs(along) - len) * 90.0);
  // brighter nose so the dart has a legible heading
  float nose = exp(-pow((along - len) * 26.0, 2.0)) * exp(-across * across / (wid * wid * 0.4));
  return body + nose * 1.4;
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

  // ---- Feedback: mild rotation + kick ripple + core lens (trail crispness
  // from HIGHS via a strong unsharp so darts leave sharp motion streaks).
  float rot = u_rotStep * (0.3 + 1.0 * exp(-r * 2.4));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.04;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.35 * u_low + 1.3 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  vec2 lensPull = dirW * lens * 0.05;
  vec2 src = (w + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec3 sampled = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // trail crispness scales with highs: sharper trails when hats are busy
  float unsharp = 1.25 + 0.5 * u_high;
  vec3 sky = max(vec3(0.0), sampled * unsharp - blur * (unsharp - 1.0)) * u_decay;

  vec3 body; vec3 glint;
  duo(body, glint);

  // ---- The DISCRETE FLOCK. For each squadron, place MEMBERS_PER_SQ darts
  // around its leader (hash-scattered within the tightness radius) all
  // aligned to the squadron heading. The kick ripple SCATTERS members it
  // crosses (radial burst at the wavefront), regrouping as the wave passes.
  float darts = 0.0;
  float glintAcc = 0.0;
  float dl = u_dartLen;
  for (int s = 0; s < ${SQUADRONS}; s++) {
    vec2 sp = vec2(u_sqPos[s * 2], u_sqPos[s * 2 + 1]);
    float head = u_sqHead[s];
    float tight = u_sqTight[s];
    vec2 dir = vec2(cos(head), sin(head));
    for (int m = 0; m < ${MEMBERS_PER_SQ}; m++) {
      float fm = float(m);
      float fs = float(s);
      // deterministic in-squadron offset (perpendicular ranks + along file)
      vec2 seed = vec2(fs * 3.1 + fm * 1.7, fs * 5.3 - fm * 2.9);
      float ox = (hash(seed) - 0.5) * 2.0;
      float oy = (hash(seed.yx + 4.7) - 0.5) * 2.0;
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 off = dir * ox * tight * 1.4 + perp * oy * tight;
      vec2 mp = sp + off;
      // ripple scatter: shove members outward at the wavefront
      float dm = length(mp);
      float scatter = exp(-pow((dm - waveFront) * 8.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
      mp += normalize(mp + 1e-4) * scatter * 0.14;
      vec2 p = c - mp;
      float len = (0.014 + 0.02 * dl) * (0.7 + 0.3 * hash(seed + 9.1));
      float wid = 0.006 * (0.7 + 0.6 * hash(seed + 2.3));
      float d = dart(p, dir, len, wid);
      darts += d;
      // wingtip glint: bright spark at the nose, HIGH-gated flicker
      float flick = 0.5 + 0.5 * sin(t * 20.0 + fs * 2.0 + fm);
      glintAcc += exp(-pow((dot(p, dir) - len) * 40.0, 2.0)) * exp(-dot(p, perp) * dot(p, perp) / (wid * wid * 0.3)) * flick;
    }
  }

  float centerDim = smoothstep(horizon * 0.35, horizon * 1.2, r);
  vec3 flock = body * darts * (0.9 + 0.7 * u_low + 0.5 * u_sustain);
  flock += glint * glintAcc * u_glint;
  // ripple LIGHTS the darts it scatters (audible kick)
  flock *= 1.0 + 2.0 * rippleWave;
  vec3 fresh = flock * centerDim;

  // ---- Charged horizon ring (kept): bass element, ember->white-hot charge.
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5);
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.02 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-r * r * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.4 + 1.0 * u_low + 1.3 * u_kick);

  sky += fresh * (1.0 - u_decay) * (3.0 + 1.4 * u_sustain);

  // Solid kick shockwave.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0));
    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.1 + 0.8 * u_drop);
  }

  // Palette grade so the mid-driven duo owns the frame.
  vec3 grade = mix(body, glint, 0.4 + 0.3 * u_centroid);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.2);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;

  // Chroma-preserving soft knee.
  float mx = max(sky.r, max(sky.g, sky.b));
  if (mx > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(mx - 0.8) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const g08VoyageFlock: VisualizerPreset = {
  id: 'g08-voyage-flock',
  name: 'g08 Voyage Flock',
  hiRes: true,
  params: [
    { id: 'palette', label: 'palette duo (violet/gold→crimson/cyan→emerald/magenta)', min: 0, max: 1, step: 0.02, default: 0 },
    { id: 'flock', label: 'flock size', min: 0.5, max: 1.5, step: 0.05, default: 1 },
    { id: 'persistence', label: 'trail persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    // Squadron (boid leader) state.
    const px = new Float32Array(SQUADRONS);
    const py = new Float32Array(SQUADRONS);
    const vx = new Float32Array(SQUADRONS);
    const vy = new Float32Array(SQUADRONS);
    const tight = new Float32Array(SQUADRONS);
    const pos = new Float32Array(SQUADRONS * 2);
    const head = new Float32Array(SQUADRONS);
    const tightOut = new Float32Array(SQUADRONS);
    for (let i = 0; i < SQUADRONS; i++) {
      const a = (i / SQUADRONS) * Math.PI * 2;
      px[i] = Math.cos(a) * 0.3;
      py[i] = Math.sin(a) * 0.3;
      vx[i] = -Math.sin(a) * 0.15;
      vy[i] = Math.cos(a) * 0.15;
      tight[i] = 0.05;
    }

    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let beatNotch = -1;
    let targetHeading = 0;       // shared murmuration heading target
    let formation = 0;          // stream / shell / helix regime
    let lastSection = -1;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const flockSize = frame.params.flock ?? 1;

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, sustained);

        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // Beat-quantized heading target change on the metric ladder.
        const barIdx = frame.beat
          ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex)
          : 0;
        const notch = frame.beat
          ? barIdx * frame.beat.beatsPerBar + frame.beat.beatInBar
          : -1;
        if (notch >= 0 && notch !== beatNotch) {
          beatNotch = notch;
          // new heading target: coherent swirl, wider swing under frenzy
          targetHeading += (0.5 + 1.5 * lift) * (((notch % 2) === 0) ? 1 : -1);
        } else if (notch < 0) {
          targetHeading += dt * 0.3;
        }

        // Section (%16 on the ladder) -> formation regime change.
        const section = frame.beat ? Math.floor(barIdx / 16) : 0;
        if (section !== lastSection) {
          lastSection = section;
          formation = (formation + 1) % 3; // stream -> shell -> helix
        }

        // ---- Boid steering: cohesion + alignment + separation toward the
        // shared heading target. LOWS drive cohesion (tight knots on bass,
        // scatter on bass kill); buildup compresses toward the core.
        const bass = frame.bands.low;
        const cohesion = 0.4 + 1.6 * bass;          // heavy bass = tight
        const scatterWide = (1 - bass) * 0.6;       // bass kill = spread
        const compress = buildup * 0.8;             // tension pulls inward
        // formation shaping of the target position ring radius
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < SQUADRONS; i++) { cx += px[i]; cy += py[i]; }
        cx /= SQUADRONS; cy /= SQUADRONS;

        const tdir = [Math.cos(targetHeading), Math.sin(targetHeading)];
        for (let i = 0; i < SQUADRONS; i++) {
          // alignment: turn velocity toward target heading
          const sp = Math.hypot(vx[i], vy[i]) || 1e-4;
          const align = 0.06 + 0.14 * lift;
          vx[i] += (tdir[0] * sp - vx[i]) * align;
          vy[i] += (tdir[1] * sp - vy[i]) * align;
          // cohesion: pull toward the flock centroid, plus core compress
          vx[i] += (cx - px[i]) * cohesion * dt;
          vy[i] += (cy - py[i]) * cohesion * dt;
          vx[i] += (0 - px[i]) * compress * dt;
          vy[i] += (0 - py[i]) * compress * dt;
          // separation from immediate ring neighbours (cheap: prev + next)
          const j = (i + 1) % SQUADRONS;
          const dx = px[i] - px[j];
          const dy = py[i] - py[j];
          const dd = dx * dx + dy * dy + 1e-4;
          vx[i] += (dx / dd) * 0.004;
          vy[i] += (dy / dd) * 0.004;

          // snare: one squadron snaps a hard turn
          if (frame.impulse.mid > 0.35 && i === (Math.floor(frame.time * 7) % SQUADRONS)) {
            const a = Math.atan2(vy[i], vx[i]) + (Math.random() < 0.5 ? 1 : -1) * 0.9;
            const m = Math.hypot(vx[i], vy[i]);
            vx[i] = Math.cos(a) * m;
            vy[i] = Math.sin(a) * m;
          }

          // integrate, speed rides the frenzy
          const spd = (0.12 + 0.55 * lift) * speed;
          const vm = Math.hypot(vx[i], vy[i]) || 1e-4;
          vx[i] = (vx[i] / vm) * spd;
          vy[i] = (vy[i] / vm) * spd;
          px[i] += vx[i] * dt;
          py[i] += vy[i] * dt;

          // soft bound: wrap squadrons back toward the field if they fly out
          const rr = Math.hypot(px[i], py[i]);
          const maxR = 0.5 + 0.15 * scatterWide - 0.25 * compress;
          if (rr > maxR) {
            px[i] *= maxR / rr;
            py[i] *= maxR / rr;
          }

          // formation-shaped tightness + LOW cohesion
          let baseTight = 0.05 * flockSize;
          if (formation === 1) baseTight *= 0.7 + 0.5 * Math.abs(Math.sin(rr * 8 + frame.time)); // shell
          if (formation === 2) baseTight *= 0.6 + 0.6 * Math.abs(Math.sin(i + frame.time * 2));  // helix
          tight[i] = baseTight * (1.4 - 0.9 * bass + scatterWide);

          pos[i * 2] = px[i];
          pos[i * 2 + 1] = py[i];
          head[i] = Math.atan2(vy[i], vx[i]);
          tightOut[i] = tight[i];
        }

        const baseDecay = 0.988 - 0.006 * energy - 0.008 * buildup;

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
          u_sustain: sustained,
          u_decay: Math.min(0.996, 1 - (1 - baseDecay) / persistence),
          u_zoom: 1 + (0.04 + 0.4 * lift + 2.5 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt - 0.2 * buildup * dt,
          u_rotStep: (0.03 + 0.35 * frame.bands.mid + 0.35 * buildup + 0.2 * sustained) * speed * dt,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_charge: charge,
          u_palette: frame.params.palette ?? 0,
          // frenzy stretches the darts (drop = fast coherent swirls)
          u_dartLen: 0.4 + 1.6 * lift,
          u_glint: 0.5 + 2.0 * frame.bands.high + 0.8 * frame.impulse.high,
          u_formation: formation,
          u_sqPos: pos,
          u_sqHead: head,
          u_sqTight: tightOut,
        };
      },
    });
  },
};

export default g08VoyageFlock;
