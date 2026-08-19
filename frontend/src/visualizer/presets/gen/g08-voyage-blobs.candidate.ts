/**
 * g08-voyage-blobs — MEDIUM REPLACEMENT of Voyage's fine-dust wash.
 *
 * Brief: keep voyage's skeleton (kick ripple, charged horizon ring, lens,
 * feedback) but the MASS is now LIQUID METABALLS — a dozen viscous luminous
 * blobs orbiting the core, merging and splitting via a screen-space SDF
 * union (smooth-min) rendered with rim light + interior glow. NO dust, NO
 * fbm cloud wash: if a frame could pass for g00-voyage it fails.
 *
 * Medium: 12 CPU-simulated metaball centers packed as a flat float array
 * (u_blobPos[24] = x,y pairs), per-blob radius (u_blobR[12]) and split
 * heat (u_blobSplit[12]). The shader unions them with a polynomial
 * smooth-min into one liquid field, isolines give the rim, the field
 * interior gets a MID-driven body colour + HIGH surface-tension shimmer.
 *
 * Band mapping (per brief):
 *   LOWS  = blob volume/viscosity — heavy bass: fewer, fatter, slower,
 *           gooier blobs; bass kill: they atomize (radii shrink, smooth-min
 *           k drops so they read as separate droplets).
 *   MIDS  = blob COLOUR (committed complementary duos, palette param swaps
 *           between 3 — teal/orange, magenta/lime, indigo/amber; never
 *           blue-wash).
 *   HIGHS = surface-tension shimmer on the rims (no dust anywhere).
 *
 * Events:
 *   kick  = the traveling ripple SLOSHES each blob it passes (a radial
 *           deformation wave shoves the blob field outward at the wavefront).
 *   snare = a random blob briefly splits (split heat pushes a paired lobe).
 *   drop  = all blobs merge into one giant pulsing mass then shatter apart,
 *           riding max(drop, energy).
 *   beat  = orbit angle advances a quantized notch on the ladder grid.
 *   phrase/section = palette regime drift (per parent behaviour).
 *
 * Self-contained: only shared helpers (glPreset / style / waveform colours)
 * are imported. GL is context-loss safe via createGlRenderer; feedback uses
 * a chroma-preserving soft knee (never per-channel clamp).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const BLOB_COUNT = 12;

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

// GLSL ES 1.0. No backticks inside the source. Array uniforms are sized to
// exactly BLOB_COUNT and indexed with a loop-constant int (i), which WebGL1
// requires for sampler/array indexing.
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
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_sustain;   // bass-weighted sustained loudness
uniform float u_decay;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since the last strong kick
uniform float u_rippleAmp;  // that kick's captured strength
uniform float u_charge;     // bass-ring charge (kick energy accumulator)
uniform float u_palette;    // 0..1 blend across 3 committed duos
uniform float u_merge;      // 0 separate droplets .. 1 one giant mass
uniform float u_smoothK;    // smooth-min radius (viscosity)
uniform float u_glossy;     // HIGH surface-tension shimmer gain
uniform float u_blobPos[${BLOB_COUNT * 2}];  // flat x,y screen-space centres
uniform float u_blobR[${BLOB_COUNT}];        // per-blob radius
uniform float u_blobSplit[${BLOB_COUNT}];    // per-blob split heat

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Three COMMITTED complementary duos (body / rim). Never blue-wash.
//   duo 0: deep teal body      / molten orange rim
//   duo 1: royal magenta body  / acid lime rim
//   duo 2: indigo body         / hot amber rim
void duo(out vec3 body, out vec3 rim) {
  float x = clamp(u_palette, 0.0, 1.0) * 2.0;
  vec3 b0 = vec3(0.02, 0.55, 0.52); vec3 r0 = vec3(1.0, 0.42, 0.06);
  vec3 b1 = vec3(0.78, 0.05, 0.62); vec3 r1 = vec3(0.55, 1.0, 0.14);
  vec3 b2 = vec3(0.20, 0.10, 0.85); vec3 r2 = vec3(1.0, 0.72, 0.10);
  body = mix(b0, b1, clamp(x, 0.0, 1.0));
  body = mix(body, b2, clamp(x - 1.0, 0.0, 1.0));
  rim = mix(r0, r1, clamp(x, 0.0, 1.0));
  rim = mix(rim, r2, clamp(x - 1.0, 0.0, 1.0));
  // MIDS travel the body toward its rim complement so an EQ move recolours
  // the mass, and the drop warms the whole duo.
  body = mix(body, rim, 0.28 * u_mid);
  body += vec3(0.12, 0.03, -0.03) * u_drop;
  rim += vec3(0.08, 0.04, 0.0) * u_kick;
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

  // ---- Feedback warp: gentle differential rotation + a traveling kick
  // ripple that PHYSICALLY sloshes the medium, + a localized core lens.
  float rot = u_rotStep * (0.3 + 1.2 * exp(-r * 2.4));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.045;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.35 * u_low + 1.4 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  vec2 lensPull = dirW * lens * 0.05;
  vec2 src = (w + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec3 sampled = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Unsharp keeps the liquid rims crisp through endless resampling.
  vec3 sky = max(vec3(0.0), sampled * 1.28 - blur * 0.28) * u_decay;

  // ---- The LIQUID MASS. Accumulate a metaball field with polynomial
  // smooth-union, tracking the nearest-blob distance so the interior can be
  // shaded per-blob. The ripple wavefront shoves the sampling point so the
  // blobs visibly deform as the kick passes.
  vec2 sloshDir = dirW * rippleWave * 0.12;
  float field = 0.0;         // additive metaball field (rim lives near iso)
  float minD = 1e3;          // nearest surface distance
  float k = max(0.02, u_smoothK);
  for (int i = 0; i < ${BLOB_COUNT}; i++) {
    vec2 bp = vec2(u_blobPos[i * 2], u_blobPos[i * 2 + 1]);
    float br = u_blobR[i];
    float split = u_blobSplit[i];
    // Split: a paired lobe offset perpendicular to the radius while hot.
    vec2 perp = vec2(-normalize(bp + 1e-4).y, normalize(bp + 1e-4).x);
    vec2 lobe = bp + perp * split * (br * 2.4);
    // The kick slosh distorts the local space so blobs squash along the
    // wavefront rather than translate rigidly.
    vec2 p = c - sloshDir * (0.5 + 0.5 * cos(ang * 3.0 + t * 4.0));
    float d0 = length(p - bp) - br;
    float d1 = length(p - lobe) - br * (0.55 + 0.45 * split);
    float d = min(d0, mix(1e3, d1, step(0.02, split)));
    minD = min(minD, d);
    // Gaussian metaball contribution; k widens with viscosity so heavy bass
    // fuses neighbours, bass kill leaves separate droplets.
    field += exp(-max(0.0, d + br) * (7.0 / k));
  }

  vec3 body; vec3 rim;
  duo(body, rim);

  // Iso mask: inside vs surface. The rim is a thin isoline band; the body
  // is the filled interior. HIGHS ripple the rim (surface tension), no dust.
  float surf = smoothstep(0.35, 1.15, field);          // filled interior
  float edge = surf * (1.0 - smoothstep(1.15, 2.4, field)); // rim proximity
  float tension = 0.5 + 0.5 * sin(minD * 60.0 - t * 9.0 + field * 5.0);
  float shimmer = pow(tension, 3.0) * u_glossy * (0.15 + u_high);

  // Interior glow falls off from the core of the union; rim light is a
  // bright complementary lip. Everything centre-dimmed so the horizon reads.
  float centerDim = smoothstep(horizon * 0.4, horizon * 1.25, r);
  vec3 mass = body * surf * (0.35 + 0.9 * u_low + 0.5 * u_sustain);
  mass += rim * edge * (1.2 + 2.0 * u_high + 1.4 * u_kick);
  mass += rim * shimmer * edge;
  // Reverb: the ripple wavefront LIGHTS the mass it crosses (audible kick).
  mass *= 1.0 + 2.4 * rippleWave;
  // Drop merge blooms the whole mass then, on shatter, high-frequency
  // fracture lines break it apart.
  mass *= 1.0 + 1.1 * u_merge;
  float fracture = 0.5 + 0.5 * sin(ang * 22.0 + minD * 40.0 - t * 3.0);
  mass *= 1.0 - 0.5 * (1.0 - u_merge) * u_drop * step(0.6, fracture) * surf;
  vec3 fresh = mass * centerDim;

  // ---- Charged horizon ring (kept from voyage): the bass element, charges
  // with kick energy, discharges the ripple. Colour runs ember->white-hot.
  float volt = (noise2(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5);
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.02 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart (palette-independent) so the core never goes blue-wash.
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-r * r * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.4 + 1.0 * u_low + 1.3 * u_kick);

  sky += fresh * (1.0 - u_decay) * (3.2 + 1.4 * u_sustain);

  // ---- Transient stamps: a solid kick shockwave (bass = SOLID, per taste).
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0));
    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.1 + 0.8 * u_drop);
  }

  // Palette grade so the mid-driven duo owns the whole frame (legible EQ).
  vec3 grade = mix(body, rim, 0.4 + 0.3 * u_centroid);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.22);
  // Buildups tense-but-alive (slight dim), drops bloom; ride max(drop,energy).
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp): scale toward the
  // hue, don't crush individual channels.
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

// noise2 declared after use above is fine in GLSL if forward-declared; put a
// prototype at the top of the source instead. Rebuild FRAGMENT with the
// prototype prepended so voltage jitter compiles.
const NOISE = `
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// Inject the noise helpers right after the precision/uniform block by
// splicing before the "float hash(" declaration.
const FRAGMENT_SRC = FRAGMENT.replace('float hash(vec2 p) {', NOISE + '\nfloat hash(vec2 p) {');

export const g08VoyageBlobs: VisualizerPreset = {
  id: 'g08-voyage-blobs',
  name: 'g08 Voyage Blobs',
  hiRes: true,
  params: [
    { id: 'palette', label: 'palette duo (teal/orange→magenta/lime→indigo/amber)', min: 0, max: 1, step: 0.02, default: 0 },
    { id: 'viscosity', label: 'viscosity', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'orbit speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    // Per-blob simulation state (CPU boid-free orbit + slosh + split).
    const angle = new Float32Array(BLOB_COUNT);
    const radius = new Float32Array(BLOB_COUNT); // orbital radius
    const rBase = new Float32Array(BLOB_COUNT);  // this blob's size seed
    const split = new Float32Array(BLOB_COUNT);
    const orbitSpeed = new Float32Array(BLOB_COUNT);
    const pos = new Float32Array(BLOB_COUNT * 2);
    const rad = new Float32Array(BLOB_COUNT);
    for (let i = 0; i < BLOB_COUNT; i++) {
      angle[i] = (i / BLOB_COUNT) * Math.PI * 2 + (i % 3) * 0.7;
      radius[i] = 0.16 + 0.24 * ((i * 7) % BLOB_COUNT) / BLOB_COUNT;
      rBase[i] = 0.045 + 0.03 * ((i * 5) % BLOB_COUNT) / BLOB_COUNT;
      orbitSpeed[i] = (i % 2 === 0 ? 1 : -1) * (0.12 + 0.09 * ((i * 3) % 5) / 5);
    }

    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let beatNotch = -1;
    let mergePulse = 0; // drop merge->shatter envelope

    return createGlRenderer({
      fragment: FRAGMENT_SRC,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const viscosity = frame.params.viscosity ?? 1;

        // Excitement split by bass presence (drop vs buildup), smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, sustained);

        // Ring charge + traveling ripple (kept from voyage engine).
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // Quantized beat notch on the metric ladder: orbit advances one step
        // per beat, so movement locks to the grid rather than drifting.
        const barIdx = frame.beat
          ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex)
          : 0;
        const phaseNotch = frame.beat
          ? barIdx * frame.beat.beatsPerBar + frame.beat.beatInBar
          : -1;
        let notchKick = 0;
        if (phaseNotch >= 0 && phaseNotch !== beatNotch) {
          beatNotch = phaseNotch;
          notchKick = 1;
        }

        // Drop event: merge into one mass then shatter. mergePulse rides
        // max(drop, energy) so the plateau stays merged, not just the onset.
        const mergeTarget = Math.min(1, 1.3 * lift);
        mergePulse += (mergeTarget - mergePulse) * (1 - Math.exp(-dt / 0.5));

        // ---- LOWS = volume/viscosity. Heavy bass: fatter, slower, gooier.
        // Bass kill: radii shrink, smooth-min k drops -> separate droplets.
        const bass = frame.bands.low;
        const smoothK = viscosity * (0.35 + 1.6 * bass + 1.4 * mergePulse);
        // Orbit collapse toward the core: drop merges everything inward;
        // buildup compresses (tension); bass kill lets them drift wide.
        const pullIn = mergePulse * 0.7 + buildup * 0.35;

        for (let i = 0; i < BLOB_COUNT; i++) {
          // Beat-quantized notch step + continuous orbit.
          angle[i] += orbitSpeed[i] * speed * dt * (0.6 + 1.4 * lift);
          if (notchKick) angle[i] += orbitSpeed[i] * 0.18;
          // Split heat decays; snare ignites one blob.
          split[i] *= Math.exp(-dt / 0.28);
          // Radius: bass fattens, bass-kill atomizes; merge inflates.
          const sizeBass = 0.5 + 1.4 * bass + 0.8 * mergePulse;
          rad[i] = rBase[i] * sizeBass * (0.7 + 0.6 * (1 - buildup));
          // Orbital radius pulled inward on merge/buildup.
          const orbR = radius[i] * (1 - 0.6 * pullIn) + 0.02 * Math.sin(frame.time * 0.7 + i);
          pos[i * 2] = Math.cos(angle[i]) * orbR;
          pos[i * 2 + 1] = Math.sin(angle[i]) * orbR;
        }

        // Snare splits a (pseudo-random, snare-seeded) blob.
        if (frame.impulse.mid > 0.3) {
          const idx = Math.floor((frame.time * 13.0) % BLOB_COUNT);
          split[idx] = Math.min(1, split[idx] + frame.impulse.mid);
        }

        const baseDecay = 0.99 - 0.008 * energy - 0.008 * buildup;

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
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / persistence),
          u_zoom: 1 + (0.05 + 0.5 * lift + 3.0 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt - 0.25 * buildup * dt,
          u_rotStep: (0.04 + 0.4 * frame.bands.mid + 0.4 * buildup + 0.2 * sustained) * speed * dt,
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_charge: charge,
          u_palette: frame.params.palette ?? 0,
          u_merge: mergePulse,
          u_smoothK: smoothK,
          // HIGHS = surface-tension shimmer gain on the rims.
          u_glossy: 0.4 + 1.6 * frame.bands.high + 0.6 * frame.impulse.high,
          u_blobPos: pos,
          u_blobR: rad,
          u_blobSplit: split,
        };
      },
    });
  },
};

export default g08VoyageBlobs;
