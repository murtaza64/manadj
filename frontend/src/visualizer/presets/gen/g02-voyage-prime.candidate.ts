/**
 * "g02 voyage-prime" — a CONSERVATIVE refinement of the pool leader (Voyage,
 * rating 1079). The parent is copied near-verbatim; only three subtle layers
 * are added, all invisibly-tastefully:
 *
 *   (1) In-phrase evolution: dust swells and the spiral twist tightens toward
 *       each phrase boundary, released (snapped back) on the downbeat —
 *       Odyssey's trick, gentler. Gridless falls back to a slow breathing.
 *   (2) spread → disk breadth: a narrow sound concentrates the disk into a
 *       tight bright band; a wide sound spreads the same energy outward.
 *   (3) flatness → nebula texture: tonal material reads as silky smooth wisps,
 *       noisy material as grainy sparkle.
 *
 * No new stamps, no regime changes — kick/star/ripple behavior is untouched.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

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
  'uniform float u_palette;\n' +
  'uniform float u_charge;\n' +
  'uniform float u_spawnSnare;\n' +
  // --- g02 additions ---
  'uniform float u_phrase;    // in-phrase swell 0..1, released on downbeats\n' +
  'uniform float u_spread;    // spectral spread -> disk breadth\n' +
  'uniform float u_flatness;  // spectral flatness -> nebula texture\n' +
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
  '// iq cosine palette: deep-space blues/violets/pinks that TRAVEL — phase\n' +
  '// rides time and the spectral centroid, warmth rides the drop.\n' +
  'vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }\n' +
  'vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }\n' +
  'vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }\n' +
  'vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }\n' +
  '\n' +
  '// Branchless continuous palette: the slider MORPHS between the four\n' +
  '// (0 ember -> 1 nebula -> 2 aurora -> 3 solar) instead of switching.\n' +
  'vec3 palette(float t) {\n' +
  '  float x = clamp(u_palette, 0.0, 3.0);\n' +
  '  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));\n' +
  '  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));\n' +
  '  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));\n' +
  '  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;\n' +
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
  'vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {\n' +
  '  vec2 q = c * density;\n' +
  '  vec2 cell = floor(q);\n' +
  '  // Per-axis seed mixing: adding one scalar to both axes made the sin-hash\n' +
  '  // align stars into moire diagonals across the lattice.\n' +
  '  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);\n' +
  '  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;\n' +
  '  vec2 f = fract(q) - pos;\n' +
  '  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));\n' +
  '  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;\n' +
  '  float bright = 0.4 + 0.6 * hash(sc + 17.9);\n' +
  '  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));\n' +
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
  '  // ---- Warp: differential rotation + two NON-circular motions —\n' +
  '  // a turbulent churn field (mids knead the accumulated sky) and a\n' +
  '  // traveling kick ripple (each strong kick sends a displacement wave\n' +
  '  // through everything on screen, Tunnel-style physicality).\n' +
  '  // g02: the spiral twist TIGHTENS across the phrase (u_phrase 0->1) and\n' +
  '  // is released on the downbeat — a gentle in-phrase wind-up.\n' +
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
  '  // BLACK HOLE, localized: the event-horizon radius is the bass ring;\n' +
  '  // the lens lives INSIDE it (gaussian in r/horizon), so distortion churns\n' +
  '  // the interior while the field outside stays legible. Swirl is a hint,\n' +
  '  // not a whirlpool.\n' +
  '  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);\n' +
  '  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);\n' +
  '  float drag = lens * 0.12;\n' +
  '  float dcs = cos(drag);\n' +
  '  float dsn = sin(drag);\n' +
  '  w = mat2(dcs, -dsn, dsn, dcs) * w;\n' +
  '  vec2 lensPull = dirW * lens * 0.055;\n' +
  '  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;\n' +
  '\n' +
  '  // Chromatic aberration: radial RGB split, widening through the drop\n' +
  '  // and blowing out along the ripple wavefront.\n' +
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)\n' +
  '    / vec2(aspect, 1.0);\n' +
  '  vec3 sampled = vec3(\n' +
  '    texture2D(u_prev, src + ab).r,\n' +
  '    texture2D(u_prev, src).g,\n' +
  '    texture2D(u_prev, src - ab).b\n' +
  '  );\n' +
  '  // Unsharp: the anti-mush pass — boost against a 4-tap blur so stars\n' +
  '  // and arms stay crisp through endless resampling.\n' +
  '  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;\n' +
  '  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;\n' +
  '\n' +
  '  // ---- Steady layers, injected at (1 - decay).\n' +
  '  vec3 fresh = vec3(0.0);\n' +
  '  // The bass circle stops being a circle: the low band kneads its rim\n' +
  '  // (two angular modes + a kick-synced tremor), so the core follows the\n' +
  '  // follows the bassline, not just its size.\n' +
  '  // Electrical vibration: two fast noise bands arcing around the rim —\n' +
  '  // the bass circle hums like a live wire, violently under a kick.\n' +
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)\n' +
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);\n' +
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))\n' +
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)\n' +
  '    + volt * (0.14 * u_low + 0.32 * u_kick);\n' +
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));\n' +
  '  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));\n' +
  '  float corona = exp(-rc * (7.0 - 3.0 * u_low));\n' +
  '  // Gravity waves: concentric rings breathing out of the core with the\n' +
  '  // bassline itself (not just kicks) — sustained lows keep the center alive.\n' +
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;\n' +
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);\n' +
  '  fresh += mix(vec3(0.55, 0.07, 0.04), LOW, 0.5)\n' +
  '    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;\n' +
  '  // The event horizon ring: a wide ember glow + a thin white-hot arc,\n' +
  '  // both jittering with the voltage field — THE bass element. Interior is\n' +
  '  // dark (centerDim), so the ring reads as the edge of the black hole.\n' +
  '  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);\n' +
  '  // Focused + evolving: the ring CHARGES with kick energy (color runs\n' +
  '  // ember -> orange -> white-hot as charge builds) and each kick discharges\n' +
  '  // a wave from the horizon (the ripple new launch point).\n' +
  '  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));\n' +
  '  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));\n' +
  '  float bassOn = smoothstep(0.06, 0.3, u_low);\n' +
  '  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));\n' +
  '  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);\n' +
  '  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);\n' +
  '  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore\n' +
  '    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);\n' +
  '  // The center is DARK RED regardless of palette — a coal heart that only\n' +
  '  // whitens under a kick; the bright palettes live in the outer dust.\n' +
  '  vec3 coal = vec3(0.55, 0.07, 0.04);\n' +
  '  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);\n' +
  '  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);\n' +
  '  // Radial dimmer keeps the middle dark so dust/stars read against it.\n' +
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);\n' +
  '  // Anamorphic lens streak across the core — the spacey money shot.\n' +
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));\n' +
  '  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);\n' +
  '  // The disk: spiral lanes + clouds in the TRAVELING palette.\n' +
  '  // g02: spread controls disk BREADTH — a narrow sound concentrates the\n' +
  '  // lanes into a tight bright band (steeper radial falloff), a wide sound\n' +
  '  // spreads them outward (shallower falloff). Energy-neutral.\n' +
  '  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));\n' +
  '  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));\n' +
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));\n' +
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;\n' +
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));\n' +
  '  float cloud = pow(cloudField, 2.4);\n' +
  '  // Wide phase span + spatial drift: the old 0.7·cloudField span sampled\n' +
  '  // under half a palette period (and blend positions average cosines\n' +
  '  // flatter still) — dust came out monochrome at many slider stops.\n' +
  '  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4);\n' +
  '  // Kick reverberation: the traveling wavefront LIGHTS the dust it passes\n' +
  '  // through (displacement alone read as subtle; this makes it audible).\n' +
  '  float reverb = 1.0 + 2.6 * rippleWave;\n' +
  '  float midGate = smoothstep(0.04, 0.3, u_mid);\n' +
  '  // g02: dust SWELLS toward the phrase boundary (u_phrase), gently.\n' +
  '  float phraseSwell = 1.0 + 0.22 * u_phrase;\n' +
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  // HIGH NEBULA: distinct physics from the mid dust — finer scale,\n' +
  '  // counter-rotation, electric blue-white tint, fast shimmer flicker.\n' +
  '  // g02: flatness textures it — tonal (0) = silky smooth wisps (softer\n' +
  '  // power curve, no grain), noisy (1) = grainy sparkle (grain modulation).\n' +
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));\n' +
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);\n' +
  '  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));\n' +
  '  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));\n' +
  '  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);\n' +
  '  fresh += electric * pow(wisp, silky) * shimmer * grain * smoothstep(0.12, 0.5, r)\n' +
  '    * (0.08 + 1.7 * u_high) * u_dust * reverb;\n' +
  '  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);\n' +
  '\n' +
  '  // High-transient nebula PUFFS: stamped into the feedback at full\n' +
  '  // strength (like the old stars, but cloud-natured) — they persist,\n' +
  '  // shear into the spiral, and fade. Snare powder stays as-is.\n' +
  '  if (u_spawn > 0.01) {\n' +
  '    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);\n' +
  '    float puff = pow(fbm(c * 7.0 + sOff), 3.5);\n' +
  '    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Transient stamps.\n' +
  '  if (u_kick > 0.02) {\n' +
  '    float ringR = 0.1 + 0.05 * u_kick;\n' +
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))\n' +
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));\n' +
  '    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);\n' +
  '    // Whole-frame punch: a brief lift so the kick lands everywhere.\n' +
  '    sky *= 1.0 + 0.1 * u_kick;\n' +
  '  }\n' +
  '  if (u_snare > 0.03) {\n' +
  '    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);\n' +
  '    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;\n' +
  '  }\n' +
  '  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {\n' +
  '    float reach = smoothstep(0.05, 0.18, r);\n' +
  '    // Highs live in the nebula now (puffs above); only the snare powder\n' +
  '    // keeps discrete star points — the hit you liked. Palette-tinted so\n' +
  '    // the slider reaches them too.\n' +
  '    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach\n' +
  '      * mix(vec3(1.0), palette(0.15), 0.45);\n' +
  '  }\n' +
  '\n' +
  '  // Film grain — fine, a touch louder through the drop.\n' +
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);\n' +
  '\n' +
  '  // Palette grade: the whole frame leans toward the palette hue, so the\n' +
  '  // blend slider is legible even while bass-red owns the center.\n' +
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);\n' +
  '  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);\n' +
  '  // Buildups cool and dim slightly (tension), drops bloom.\n' +
  '  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;\n' +
  '  float m = max(sky.r, max(sky.g, sky.b));\n' +
  '  if (m > 0.8) {\n' +
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;\n' +
  '  }\n' +
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);\n' +
  '}\n';

const g02VoyagePrime: VisualizerPreset = {
  id: 'g02-voyage-prime',
  name: 'g02 voyage-prime',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
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
    // g02: phrase-tier release. `phrase` ramps 0->1 across the 4-bar phrase and
    // is snapped to 0 on the downbeat (release), then eased back up. Gridless
    // material breathes on a slow free-running triangle instead.
    let prevBarIndex: number | null = null;
    let phrase = 0;
    let smoothSpread = 0;
    let smoothFlatness = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        // Excitement split by bass presence: with lows = the drop, without
        // = the buildup (risers/filtered kicks have busy highs, no bass).
        // Wider bass window + temporal smoothing: the old narrow clamp
        // flipped drop↔buildup regimes instantly (zoom sign flip + stacked
        // suppressors = the "eerily still" buildup cut).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // Drops fly outward; buildups COLLAPSE inward (zoom < 1).
        // Cruise rides sustained loudness too — a drop's PLATEAU must fly,
        // not just its first seconds (excitement fades into the baseline).
        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        // Spiral-arm drift locks to the grid: one revolution per 64
        // beats (16 bars in 4/4); gridless falls back to slow time drift.
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge: kicks pump it, it bleeds off over ~2.5 s — the
        // ring's color/size/lens all ride it, so a busy bassline visibly
        // heats the horizon.
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple: retrigger on strong kicks, capture strength.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        // g02: in-phrase swell. On a grid, `phrase` tracks the phrase phase
        // (barIndex % 4 + barPhase) / 4 and is RELEASED (dip) on every phrase
        // downbeat; between beats it eases toward the phase so the wind-up is
        // continuous. Gridless: a slow free-running breath.
        const beat = frame.beat;
        let phraseTarget: number;
        if (beat && beat.barIndex !== null) {
          if (prevBarIndex !== null && beat.barIndex !== prevBarIndex) {
            const phraseBoundary = (((beat.barIndex % 4) + 4) % 4) === 0;
            if (phraseBoundary) {
              // Release: snap the wind-up back to zero on the downbeat.
              phrase = 0;
            }
          }
          prevBarIndex = beat.barIndex;
          phraseTarget = ((((beat.barIndex % 4) + 4) % 4) + beat.barPhase) / 4;
        } else {
          phraseTarget = 0.5 + 0.5 * Math.sin(frame.time * 0.35);
        }
        phrase += (phraseTarget - phrase) * (1 - Math.exp(-dt / 0.5));
        // g02: spectral spread/flatness, gently smoothed so they don't jitter.
        smoothSpread += ((frame.spread ?? 0) - smoothSpread) * (1 - Math.exp(-dt / 0.4));
        smoothFlatness += ((frame.flatness ?? 0) - smoothFlatness) * (1 - Math.exp(-dt / 0.4));
        // Gentle with energy: the old -0.018·energy ate stars 2.5× faster
        // exactly when drops should be dense (buildups still drain extra).
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
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
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          // Buildups starve the spawner; SUSTAINED loudness keeps it open
          // (excitement fades over a drop's plateau — it's a transition
          // signal, so the drop body must ride energy, not excitement).
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          // Powder is a MID/HIGH effect: kick transients are broadband
          // (their click bleeds into impulse.high/mid), so a kick gate
          // keeps low-end impacts SOLID (core/shockwave) instead of
          // sparkly. Slightly eased overall.
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // Snares (mid transients) throw big stars; suppressed less in
          // buildups so rolls still sparkle without flooding.
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // g02 additions.
          u_phrase: Math.min(1, Math.max(0, phrase)),
          u_spread: Math.min(1, Math.max(0, smoothSpread)),
          u_flatness: Math.min(1, Math.max(0, smoothFlatness)),
        };
      },
    });
  },
};

export default g02VoyagePrime;
