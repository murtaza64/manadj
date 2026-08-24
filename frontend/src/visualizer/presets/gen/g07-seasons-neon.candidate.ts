/**
 * "g07 seasons-neon" (gen-7 COLOR VARIATION of g06-voyage-seasons): the
 * parent's engine VERBATIM — ember starfield medium, traveling kick ripple
 * that lights what it passes, charged event-horizon ring, solid kick response,
 * differential-rotation warp, and the SEASON palette state machine (in-phrase
 * drift + section-boundary traveling color front). ONLY the four season
 * palette-regime banks change (CLUB NEON families) plus TWO named drama boosts:
 *
 *   (A) DROP HUE SLAM: a drop plateau SLAMS the whole field into the current
 *       regime's two PUREST hues, then eases back over the phrase. Chroma-only
 *       (grade blend toward the pure pair), riding max(drop, sustained) so it
 *       holds across the plateau; the ease-back is driven by the phrase clock.
 *   (B) KICK RIPPLE NEON EDGE-LIGHT: the traveling kick front becomes a thin,
 *       blazing, fast neon edge-light — a tight bright line in the regime hue
 *       that races outward, so kicks read as an electric edge, not a soft wave.
 *
 * The parent's anti-resemblance law (chroma is the drama, geometry untouched)
 * and photosensitivity floor are preserved: the hue slam is a smoothed
 * plateau ride (chroma, not luminance flashing), the neon edge is a localized
 * spatial front, and the chroma-preserving soft knee stays. Neon reads by what
 * stays DARK — deeper blacks between, higher saturation ceiling.
 *
 * Sibling: g07-seasons-nebula (identical engine; CELESTIAL banks + luminous-
 * surge / ripple-contrast drama). These two differ ONLY in palette content and
 * their per-brief drama treatments.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// DUST FIX v3: deterministic per-track hue anchor. Bit-mix folded to [0,1) so
// different track ids land on genuinely different hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

/** ((x % n) + n) % n — ladder/bar index can be negative before the downbeat. */
const mod = (x: number, n: number) => ((x % n) + n) % n;

const FRAGMENT =
  'precision highp float;\n' +
  'uniform sampler2D u_prev;\n' +
  'uniform vec2 u_res;\n' +
  'uniform float u_time;\n' +
  'uniform float u_low;\n' +
  'uniform float u_mid;\n' +
  'uniform float u_high;\n' +
  'uniform float u_kick;\n' +
  'uniform float u_snare;\n' +
  'uniform float u_centroid;\n' +
  'uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content\n' +
  'uniform float u_drop;\n' +
  'uniform float u_buildup;\n' +
  'uniform float u_zoom;\n' +
  'uniform float u_rotStep;\n' +
  'uniform float u_decay;\n' +
  'uniform float u_seed;\n' +
  'uniform float u_spawn;\n' +
  'uniform float u_rippleAge;\n' +
  'uniform float u_rippleAmp;\n' +
  'uniform float u_sustain;\n' +
  'uniform float u_armPhase;\n' +
  'uniform float u_dust;\n' +
  'uniform float u_charge;\n' +
  'uniform float u_spawnSnare;\n' +
  'uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1\n' +
  'uniform float u_phrase;    // in-phrase swell 0..1, released on downbeats\n' +
  'uniform float u_spread;    // spectral spread -> disk breadth\n' +
  'uniform float u_flatness;  // spectral flatness -> nebula texture\n' +
  // --- g06 season system ---
  'uniform float u_hue;       // INCOMING season hue center (turns) 0..1\n' +
  'uniform float u_warm;      // INCOMING season warmth 0..1 (cool->warm)\n' +
  'uniform float u_sat;       // INCOMING season saturation breadth 0..1\n' +
  'uniform float u_hueOut;    // OUTGOING season hue center (pre-jump)\n' +
  'uniform float u_warmOut;   // OUTGOING season warmth\n' +
  'uniform float u_satOut;    // OUTGOING season saturation breadth\n' +
  'uniform float u_sweep;     // 0..1 section-front progress (1 = fully arrived)\n' +
  'uniform float u_sweepDir;  // front travel direction (radians)\n' +
  'uniform float u_dropSat;   // trend/drop-gated extra saturation 0..1\n' +
  'uniform float u_dropSlam;  // (A) drop hue-slam 0..1 (plateau ride, phrase ease-back)\n' +
  'uniform float u_pureA;     // (A) regime purest hue #1 (turns)\n' +
  'uniform float u_pureB;     // (A) regime purest hue #2 (turns)\n' +
  '\n' +
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';\n' +
  'const vec3 HIGH = ' + rgb(ADDITIVE_COLORS[2]) + ';\n' +
  '\n' +
  'float hash(vec2 p) {\n' +
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n' +
  '}\n' +
  '\n' +
  'float noise(vec2 p) {\n' +
  '  vec2 i = floor(p);\n' +
  '  vec2 f = fract(p);\n' +
  '  vec2 u = f * f * (3.0 - 2.0 * f);\n' +
  '  return mix(\n' +
  '    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),\n' +
  '    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),\n' +
  '    u.y\n' +
  '  );\n' +
  '}\n' +
  '\n' +
  'float fbm(vec2 p) {\n' +
  '  float v = 0.0;\n' +
  '  float amp = 0.5;\n' +
  '  for (int i = 0; i < 4; i++) {\n' +
  '    v += amp * noise(p);\n' +
  '    p = p * 2.03 + vec2(17.3, 9.1);\n' +
  '    amp *= 0.5;\n' +
  '  }\n' +
  '  return v;\n' +
  '}\n' +
  '\n' +
  '// HSV -> RGB (bright, fully saturated seasons; no pastel wash).\n' +
  'vec3 hsv2rgb(vec3 c) {\n' +
  '  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);\n' +
  '  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);\n' +
  '}\n' +
  '\n' +
  '// SEASON palette. A season is (hue center, warmth, sat breadth). The\n' +
  '// argument t (the same spatial/phase drive the parent fed palette()) rides\n' +
  '// a hue SPAN around the center so dust/nebula never go monochrome; warmth\n' +
  '// biases the center toward the ember end and lifts value at that end;\n' +
  '// sat breadth widens the span AND the saturation. Value stays parent-like\n' +
  '// (anti-resemblance: chroma is the drama, not luminance).\n' +
  'vec3 seasonColor(float t, float hueC, float warm, float sat) {\n' +
  '  float span = 0.14 + 0.20 * sat;\n' +
  '  // warmth pulls the traveling hue toward warm (0.02..0.10 = red/orange).\n' +
  '  float warmPull = mix(0.0, -0.10, warm);\n' +
  '  float hue = hueC + warmPull + span * sin(6.28318 * t);\n' +
  '  float s = clamp(0.62 + 0.34 * sat + 0.10 * u_dropSat, 0.0, 1.0);\n' +
  '  // Value envelope kept near parent (roughly 0.5..1.0 with the cosine),\n' +
  '  // warmth only nudges it so the change is CHROMATIC not luminance.\n' +
  '  float v = 0.55 + 0.42 * (0.5 + 0.5 * cos(6.28318 * (t + 0.15)));\n' +
  '  v = v * (0.92 + 0.16 * warm);\n' +
  '  return hsv2rgb(vec3(fract(hue), s, clamp(v, 0.0, 1.0)));\n' +
  '}\n' +
  '\n' +
  '// The palette() drop-in: same signature the parent used everywhere. Blends\n' +
  '// the OUTGOING and INCOMING seasons by the TRAVELING FRONT. The front is a\n' +
  '// moving line across the field (u_sweepDir), its position set by u_sweep;\n' +
  '// a soft edge makes it read as a sweeping color front, not a hard wipe.\n' +
  '// Between sections u_sweep sits at 1.0 (front fully passed) so incoming ==\n' +
  '// the live season and the whole field is one palette.\n' +
  'vec3 palette(float t) {\n' +
  '  vec3 inc = seasonColor(t, u_hue, u_warm, u_sat);\n' +
  '  vec3 out0 = seasonColor(t, u_hueOut, u_warmOut, u_satOut);\n' +
  '  // Projection of the pixel onto the sweep axis, normalized to ~[-1,1].\n' +
  '  vec2 uv = gl_FragCoord.xy / u_res;\n' +
  '  vec2 pc = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);\n' +
  '  vec2 axis = vec2(cos(u_sweepDir), sin(u_sweepDir));\n' +
  '  float proj = dot(pc, axis) * 0.62 + 0.5; // 0 at trailing edge, 1 at leading\n' +
  '  // Front position travels 0 -> 1 with a soft leading edge (width ~0.35).\n' +
  '  float frontPos = u_sweep * 1.35 - 0.175;\n' +
  '  float arrived = smoothstep(frontPos - 0.175, frontPos + 0.175, 1.0 - proj);\n' +
  '  return mix(out0, inc, arrived);\n' +
  '}\n' +
  '\n' +
  'float starShape(vec2 f, float size) {\n' +
  '  float d2 = dot(f, f);\n' +
  '  float core = exp(-d2 * 1100.0 / size);\n' +
  '  float halo = exp(-d2 * 140.0 / size) * 0.2;\n' +
  '  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)\n' +
  '    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;\n' +
  '  return core + halo + spikes;\n' +
  '}\n' +
  '\n' +
  '// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in\n' +
  '// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.\n' +
  'vec3 hueRotate(vec3 c, float rot) {\n' +
  '  float y = dot(c, vec3(0.299, 0.587, 0.114));\n' +
  '  float i = dot(c, vec3(0.596, -0.274, -0.322));\n' +
  '  float q = dot(c, vec3(0.211, -0.523, 0.312));\n' +
  '  float h = atan(q, i) + rot * 6.28318;\n' +
  '  float chroma = sqrt(i * i + q * q);\n' +
  '  i = chroma * cos(h);\n' +
  '  q = chroma * sin(h);\n' +
  '  return max(vec3(0.0), vec3(\n' +
  '    y + 0.956 * i + 0.621 * q,\n' +
  '    y - 0.272 * i - 0.647 * q,\n' +
  '    y - 1.106 * i - 1.703 * q\n' +
  '  ));\n' +
  '}\n' +
  'vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {\n' +
  '  vec2 q = c * density;\n' +
  '  vec2 cell = floor(q);\n' +
  '  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);\n' +
  '  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;\n' +
  '  vec2 f = fract(q) - pos;\n' +
  '  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));\n' +
  '  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;\n' +
  '  float bright = 0.4 + 0.6 * hash(sc + 17.9);\n' +
  '  // Star tint samples the OWN neon-season palette at each star hash phase\n' +
  '  // (wide span, spectral-hue biased) instead of a fixed cool/warm ramp.\n' +
  '  // Luminance unchanged (starShape * on * bright * gain).\n' +
  '  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5), u_hueRot);\n' +
  '  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;\n' +
  '}\n' +
  '\n' +
  'void main() {\n' +
  '  vec2 uv = gl_FragCoord.xy / u_res;\n' +
  '  float aspect = u_res.x / u_res.y;\n' +
  '  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);\n' +
  '  float r = length(c);\n' +
  '  float ang = atan(c.y, c.x);\n' +
  '  float t = u_time;\n' +
  '  vec2 px = 1.0 / u_res;\n' +
  '\n' +
  '  // ---- Warp: differential rotation + churn + traveling kick ripple.\n' +
  '  float twist = 1.0 + 0.12 * u_phrase;\n' +
  '  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * twist;\n' +
  '  float cs = cos(rot);\n' +
  '  float sn = sin(rot);\n' +
  '  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;\n' +
  '  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);\n' +
  '  vec2 churn = (vec2(\n' +
  '    fbm(c * 2.6 + t * 0.12),\n' +
  '    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)\n' +
  '  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);\n' +
  '  float waveFront = 0.16 + u_rippleAge * 0.9;\n' +
  '  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;\n' +
  '  vec2 ripple = dirW * rippleWave * 0.035;\n' +
  '  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);\n' +
  '  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);\n' +
  '  float drag = lens * 0.12;\n' +
  '  float dcs = cos(drag);\n' +
  '  float dsn = sin(drag);\n' +
  '  w = mat2(dcs, -dsn, dsn, dcs) * w;\n' +
  '  vec2 lensPull = dirW * lens * 0.055;\n' +
  '  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;\n' +
  '\n' +
  '  // Chromatic aberration.\n' +
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)\n' +
  '    / vec2(aspect, 1.0);\n' +
  '  ab *= u_dust; // fringe amount rides the dust param (human note)\n' +
  '  // fringe fix: hue-steerable fringes -- rotate the field to the anchor\n' +
  '  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can\n' +
  '  // go slightly negative) so the unsharp feedback loop stays stable.\n' +
  '  float fringeRot = u_hueRot;\n' +
  '  vec3 tapA = texture2D(u_prev, src + ab).rgb;\n' +
  '  vec3 tapC = texture2D(u_prev, src).rgb;\n' +
  '  vec3 tapB = texture2D(u_prev, src - ab).rgb;\n' +
  '  vec3 sampled = max(vec3(0.0), hueRotate(vec3(\n' +
  '    hueRotate(tapA, -fringeRot).r,\n' +
  '    hueRotate(tapC, -fringeRot).g,\n' +
  '    hueRotate(tapB, -fringeRot).b\n' +
  '  ), fringeRot));\n' +
  '  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;\n' +
  '  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;\n' +
  '\n' +
  '  // ---- Steady layers, injected at (1 - decay).\n' +
  '  vec3 fresh = vec3(0.0);\n' +
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)\n' +
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);\n' +
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))\n' +
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)\n' +
  '    + volt * (0.14 * u_low + 0.32 * u_kick);\n' +
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));\n' +
  '  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));\n' +
  '  float corona = exp(-rc * (7.0 - 3.0 * u_low));\n' +
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;\n' +
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);\n' +
  '  // Gravity ripple color: a slice of the OWN neon-season palette (spectral-hue\n' +
  '  // biased) instead of a fixed ember/LOW mix. Gain unchanged.\n' +
  '  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);\n' +
  '  fresh += gravityColor\n' +
  '    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;\n' +
  '  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);\n' +
  '  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));\n' +
  '  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));\n' +
  '  float bassOn = smoothstep(0.06, 0.3, u_low);\n' +
  '  // Ring color: a neon-season palette slice (spectral-hue biased) charging\n' +
  '  // toward a wide phase offset then white-hot at high charge. Palette supplies\n' +
  '  // hue; the charge->white ramp and gains preserve luminance.\n' +
  '  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));\n' +
  '  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);\n' +
  '  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);\n' +
  '  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore\n' +
  '    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);\n' +
  '  // Coal heart: a deep, low-luma slice of the OWN neon-season palette (spectral-\n' +
  '  // hue biased) instead of a fixed dark red. Kept dark (0.55 floor); gains/kick-\n' +
  '  // whiten preserve luminance.\n' +
  '  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;\n' +
  '  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);\n' +
  '  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);\n' +
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);\n' +
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));\n' +
  '  // Streak: both ends sample the OWN neon-season palette (a wide phase offset\n' +
  '  // for the cool end, spectral-hue biased) instead of a fixed steel-blue.\n' +
  '  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);\n' +
  '  // The disk: spiral lanes + clouds in the SEASON palette (front-swept).\n' +
  '  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));\n' +
  '  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));\n' +
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));\n' +
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;\n' +
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));\n' +
  '  float cloud = pow(cloudField, 2.4);\n' +
  '  // SPECTRAL DUST TINT: the disk palette phase is biased by the slow-tracked\n' +
  '  // centroid (u_specHue, ~1s EMA) so dust hue follows spectral content.\n' +
  '  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);\n' +
  '  float reverb = 1.0 + 2.6 * rippleWave;\n' +
  '  float midGate = smoothstep(0.04, 0.3, u_mid);\n' +
  '  float phraseSwell = 1.0 + 0.22 * u_phrase;\n' +
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  // HIGH NEBULA: finer, counter-rotating, electric — season-tinted.\n' +
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));\n' +
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);\n' +
  '  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));\n' +
  '  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));\n' +
  '  vec3 electric = hueRotate(mix(palette(0.85 + u_specHue * 0.5), palette(0.6 + t * 0.03 + u_specHue * 0.5), 0.65), u_hueRot);\n' +
  '  fresh += electric * pow(wisp, silky) * shimmer * grain * smoothstep(0.12, 0.5, r)\n' +
  '    * (0.08 + 1.7 * u_high) * u_dust * reverb;\n' +
  '  // (B) KICK RIPPLE NEON EDGE-LIGHT: a thin, blazing, fast neon line in the\n' +
  '  // regime hue, riding the same traveling wavefront but MUCH tighter (a thin\n' +
  '  // edge, not a soft wave) and additively bright, so a kick throws a racing\n' +
  '  // electric edge across the field. Localized spatial front (photosensitivity\n' +
  '  // floor: not a full-field flash).\n' +
  '  float neonEdge = exp(-pow((r - waveFront) * 46.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;\n' +
  '  vec3 neonHue = seasonColor(0.0, u_pureA, 0.0, 1.0);\n' +
  '  fresh += neonHue * neonEdge * (1.6 + 2.4 * u_kick);\n' +
  '  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);\n' +
  '\n' +
  '  // High-transient nebula PUFFS.\n' +
  '  if (u_spawn > 0.01) {\n' +
  '    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);\n' +
  '    float puff = pow(fbm(c * 7.0 + sOff), 3.5);\n' +
  '    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Transient stamps (kick response stays SOLID).\n' +
  '  if (u_kick > 0.02) {\n' +
  '    float ringR = 0.1 + 0.05 * u_kick;\n' +
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))\n' +
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));\n' +
  '    // Shockwave hue from the OWN neon-season palette (spectral-hue biased)\n' +
  '    // mixed toward a warm-white accent. Kick gain / drop scaling unchanged.\n' +
  '    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);\n' +
  '    sky *= 1.0 + 0.1 * u_kick;\n' +
  '  }\n' +
  '  if (u_snare > 0.03) {\n' +
  '    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);\n' +
  '    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;\n' +
  '  }\n' +
  '  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {\n' +
  '    float reach = smoothstep(0.05, 0.18, r);\n' +
  '    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach\n' +
  '      * mix(vec3(1.0), palette(0.15), 0.45);\n' +
  '  }\n' +
  '\n' +
  '  // Film grain.\n' +
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);\n' +
  '\n' +
  '  // Season grade: lean the whole frame toward the (front-swept) season hue,\n' +
  '  // so the chromatic drama is legible even while bass-red owns the center.\n' +
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);\n' +
  '  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);\n' +
  '  // (A) DROP HUE SLAM: on a drop plateau, slam the whole field toward the\n' +
  '  // regime two PUREST hues (spatially split so it stays legible, not flat),\n' +
  '  // easing back over the phrase. CHROMA-only: the field keeps its own\n' +
  '  // luminance, only its hue is dragged toward the pure pair (per-pixel scale\n' +
  '  // by the frame luminance so blacks stay black -> deeper neon contrast).\n' +
  '  float lum = max(sky.r, max(sky.g, sky.b));\n' +
  '  float split = smoothstep(-0.15, 0.15, dot((uv - 0.5), vec2(cos(u_sweepDir), sin(u_sweepDir))));\n' +
  '  float pureHue = mix(u_pureA, u_pureB, split);\n' +
  '  vec3 pure = seasonColor(0.0, pureHue, 0.0, 1.0) * lum;\n' +
  '  sky = mix(sky, pure, 0.55 * u_dropSlam);\n' +
  '  // Luminance envelope kept PARENT-LIKE (anti-resemblance: chroma is the\n' +
  '  // drama). No section-boundary brightness flash.\n' +
  '  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;\n' +
  '  // Chroma-preserving soft knee (never per-channel clamp).\n' +
  '  float m = max(sky.r, max(sky.g, sky.b));\n' +
  '  if (m > 0.8) {\n' +
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;\n' +
  '  }\n' +
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);\n' +
  '}\n';

/**
 * A SEASON is a chromatic regime: (hueCenter turns, warmth, satBreadth). The
 * regimes form a cycle where each step is a DRASTIC jump (complementary hue
 * rotation + warmth inversion). Section boundaries pick the NEXT regime;
 * phrases DRIFT toward the current one.
 *
 * g07-seasons-neon: CLUB NEON banks (vs the CELESTIAL sibling). Four electric
 * club families with a HIGHER saturation ceiling and deeper blacks between —
 * neon reads by what stays dark:
 *   0  CYAN/MAGENTA LASER — cyan center laser-cutting into magenta (hue ~0.50)
 *   1  ACID GREEN / UV     — acid green bleeding to UV violet (hue ~0.30)
 *   2  HOT PINK / ELEC BLUE — hot pink vs electric blue (hue ~0.90)
 *   3  AMBER / SCANLINE TEAL — amber against scanline teal (hue ~0.10)
 */
interface Season {
  hue: number;
  warm: number;
  sat: number;
}
const SEASONS: Season[] = [
  { hue: 0.5, warm: 0.1, sat: 0.95 }, //  cyan/magenta laser: cyan center, cool, max sat
  { hue: 0.3, warm: 0.15, sat: 0.9 }, //  acid green / UV violet: cool-neutral, broad
  { hue: 0.9, warm: 0.35, sat: 0.95 }, // hot pink / electric blue: mid-warm, max sat
  { hue: 0.1, warm: 0.85, sat: 0.85 }, // amber / scanline teal: hot amber, broad
];

/** The regime two PUREST hues (turns): the center and its complement. */
const PURE_A: number[] = [0.5, 0.3, 0.9, 0.1];
const PURE_B: number[] = [0.87, 0.78, 0.58, 0.47];

const g07SeasonsNeon: VisualizerPreset = {
  id: 'g07-seasons-neon',
  name: 'g07 seasons-neon',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'seasonDrift', label: 'season drift (in-phrase hue turn)', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'sweepSpeed', label: 'section sweep speed', min: 0.3, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let prevBarIndex: number | null = null;
    let phrase = 0;
    let smoothSpread = 0;
    let smoothFlatness = 0;
    let smoothDropSlam = 0;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase so
    // dust hue follows spectral content without jerking on transients.
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep; centroid EMA supplies the travel.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;

    // --- g06 SEASON STATE MACHINE ---------------------------------------
    // The LIVE (incoming) season is what the field currently wears; the
    // OUTGOING season is the previous regime, still painted behind the
    // traveling front until it fully passes.
    //   * incoming / outgoing: eased HSV-ish season params fed to the shader.
    //   * targetSeason: the regime index the current SECTION belongs to.
    //   * sectionId: which section we're in (derived from ladderBarIndex/16),
    //     so a rollover triggers exactly one jump.
    //   * sweep: 0 at a jump, eased -> 1 as the color front crosses the field.
    //     While < 1 the shader blends outgoing->incoming spatially.
    // Within a phrase the incoming season DRIFTS bar-by-bar (seasonDrift): the
    // hue center rotates a little each bar and warmth/sat breathe, so the
    // palette turns like a season even between section jumps.
    let regimeIndex = 0;
    const incoming: Season = { ...SEASONS[0] };
    const outgoing: Season = { ...SEASONS[0] };
    let sweep = 1; // 1 = front fully passed (single-palette field)
    let sweepDir = 0;
    let sectionId: number | null = null;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        // motion: slow bands (erratic-motion law)
        const slow = frame.bandsSlow ?? frame.bands;
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const seasonDrift = frame.params.seasonDrift ?? 1;
        const sweepSpeed = frame.params.sweepSpeed ?? 1;

        // Drop/buildup split (bass-weighted, smoothed) — derived exactly as
        // the parent does (VisualizerFrameData.trend has NO drop field).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // --- Phrase swell (parent machinery, raided from g02-voyage-prime).
        const beat = frame.beat;
        // Phrase/section tiers derive from the LADDER-correct ordinal.
        const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
        let phraseTarget: number;
        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            const phraseBoundary = mod(tierBar, 4) === 0;
            if (phraseBoundary) phrase = 0; // release on the phrase downbeat
          }
          phraseTarget = (mod(tierBar, 4) + beat.barPhase) / 4;
        } else {
          phraseTarget = 0.5 + 0.5 * Math.sin(frame.time * 0.35);
        }
        phrase += (phraseTarget - phrase) * (1 - Math.exp(-dt / 0.5));

        // --- SEASON STATE MACHINE -----------------------------------------
        // SECTION JUMP: a section is 16 ladder-bars. On a new section id, jump
        // the regime (complementary/inverted family) and LAUNCH a traveling
        // color front — the outgoing season freezes, sweep restarts at 0.
        if (beat && tierBar !== null) {
          // Monotone section counter from the (possibly negative) ladder bar.
          const sec = Math.floor(tierBar / 16);
          if (sectionId === null) {
            sectionId = sec;
          } else if (sec !== sectionId) {
            sectionId = sec;
            // Freeze the current live season as the outgoing one.
            outgoing.hue = incoming.hue;
            outgoing.warm = incoming.warm;
            outgoing.sat = incoming.sat;
            // Advance to the next regime (drastic complementary jump). Add a
            // section-derived hop so successive sections don't always land on
            // the same neighbour — still a big, committed regime change.
            const hop = 1 + mod(sec, 3); // 1..3 regimes forward
            regimeIndex = mod(regimeIndex + hop, SEASONS.length);
            // Launch the front from an edge; direction rotates per section so
            // the sweep doesn't always come from the same side.
            sweepDir = mod(sec * 1.7, Math.PI * 2);
            sweep = 0;
          }
        }

        // The front crosses the field. Speed: ~one bar at 128bpm baseline, so
        // it commits in <1 bar; sweepSpeed scales it. Eased toward 1.
        sweep = Math.min(1, sweep + dt * 1.6 * sweepSpeed);

        // SEASON DRIFT (within a phrase): rotate the hue center a little each
        // bar and breathe warmth/sat, so the palette turns like a slow season.
        // ladderBarIndex fractional position (bar + barPhase) drives a smooth
        // turn; seasonDrift scales its magnitude. Between sections this is the
        // ONLY palette motion (a gentle seasonal creep).
        const target = SEASONS[regimeIndex];
        // A slow triangle over the 4-bar phrase turns the hue; magnitude tiny
        // so it never rivals the section jump (drama belongs to the jump).
        const phraseTurn = Math.sin(phrase * Math.PI * 2) * 0.03 * seasonDrift;
        const warmBreath = 0.08 * seasonDrift * Math.sin(phrase * Math.PI);
        const satBreath = 0.06 * seasonDrift * (0.5 + 0.5 * Math.cos(phrase * Math.PI * 2));
        const driftHue = target.hue + phraseTurn;
        const driftWarm = Math.min(1, Math.max(0, target.warm + warmBreath));
        const driftSat = Math.min(1, Math.max(0, target.sat + satBreath));

        // Ease the LIVE season toward the (drifted) target. Fast enough that a
        // section jump commits in well under a bar, slow enough to read as a
        // turn rather than a cut.
        const seasonAlpha = 1 - Math.exp(-dt / 0.25);
        // Shortest-path hue easing on the [0,1) turn circle.
        let dHue = driftHue - incoming.hue;
        dHue -= Math.round(dHue);
        incoming.hue = mod(incoming.hue + dHue * seasonAlpha, 1);
        incoming.warm += (driftWarm - incoming.warm) * seasonAlpha;
        incoming.sat += (driftSat - incoming.sat) * seasonAlpha;

        // Drop-gated extra saturation: a drop plateau juices the chroma
        // (rides max(drop, sustained) so it doesn't fade over the plateau).
        const dropSat = Math.min(1, Math.max(drop, 0.6 * sustained));

        // (A) DROP HUE SLAM: a drop plateau slams the field into the regime two
        // purest hues, then EASES BACK over the phrase (u_phrase rises 0->1 as
        // the phrase progresses, so multiplying by (1 - phrase) relaxes the
        // slam toward the phrase downbeat). Rides max(drop, sustained) so it
        // holds across the plateau; smoothed so it never flashes.
        const slamTarget = Math.min(1, Math.max(drop, 0.55 * sustained)) * (1 - 0.7 * phrase);
        smoothDropSlam += (slamTarget - smoothDropSlam) * (1 - Math.exp(-dt / 0.3));

        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        if (beat && tierBar !== null) prevBarIndex = tierBar;

        smoothSpread += ((frame.spread ?? 0) - smoothSpread) * (1 - Math.exp(-dt / 0.4));
        smoothFlatness += ((frame.flatness ?? 0) - smoothFlatness) * (1 - Math.exp(-dt / 0.4));
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // DUST FIX v3: dominant deck = argmax audible level; its trackId anchors
        // a stable per-song hue, eased over ~2s; centroid EMA supplies travel.
        let domTrack: number | null = null;
        let domLevel = -1;
        for (const d of frame.decks) {
          if (d.level > domLevel) {
            domLevel = d.level;
            domTrack = d.trackId;
          }
        }
        if (domTrack !== null && domTrack !== lastAnchorTrack) {
          lastAnchorTrack = domTrack;
          hueAnchorTarget = splitmix01(domTrack);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        const hueRot = (((hueAnchor + (slowCentroid - 0.5) * 0.8) % 1) + 1) % 1;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          // rotation RATE on slow bands (erratic-motion law)
          u_rotStep: (0.05 + 0.5 * slow.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_phrase: Math.min(1, Math.max(0, phrase)),
          u_spread: Math.min(1, Math.max(0, smoothSpread)),
          u_flatness: Math.min(1, Math.max(0, smoothFlatness)),
          // g06 season uniforms.
          u_hue: incoming.hue,
          u_warm: Math.min(1, Math.max(0, incoming.warm)),
          u_sat: Math.min(1, Math.max(0, incoming.sat)),
          u_hueOut: outgoing.hue,
          u_warmOut: Math.min(1, Math.max(0, outgoing.warm)),
          u_satOut: Math.min(1, Math.max(0, outgoing.sat)),
          u_sweep: Math.min(1, Math.max(0, sweep)),
          u_sweepDir: sweepDir,
          u_dropSat: dropSat,
          u_dropSlam: Math.min(1, Math.max(0, smoothDropSlam)),
          u_pureA: PURE_A[regimeIndex],
          u_pureB: PURE_B[regimeIndex],
        };
      },
    });
  },
};

export default g07SeasonsNeon;
