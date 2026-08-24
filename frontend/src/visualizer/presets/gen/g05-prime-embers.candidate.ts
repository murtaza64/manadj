/**
 * "g05 prime-embers" — a MINOR VARIATION of the pool leader g02 voyage-prime
 * (rating 1065). The parent's whole engine is copied verbatim — differential-
 * rotation warp, churn field, traveling kick ripple, black-hole lens, spiral
 * dust disk (spread → breadth), high nebula (flatness → texture), in-phrase
 * swell, snare powder, chroma-preserving soft knee. Exactly ONE element is
 * swapped, per the gen-5 directive "replacing core glow with" another element.
 *
 *   DRIFTING EMBER FIELD — voyage-prime's central coal-heart glow (the
 *     bright core `heart` + `corona`) is GONE. No central glow at all; in its
 *     place a field of slow-drifting embers whose brightness is EARNED:
 *       - the traveling KICK RIPPLE (the g00-voyage idiom, already in the
 *         engine as u_rippleAge/u_rippleAmp) LIGHTS the embers it passes —
 *         each ember flares as the wavefront crosses it, then cools;
 *       - SNARE gusts (mid/high gated) scatter the embers, jittering their
 *         drift;
 *       - during DROPS the whole field ignites, riding max(trend.drop,
 *         energy);
 *       - BUILDUPS quicken and warm the drift (tense-but-alive, never still).
 *     Palette travel applies to the ember TEMPERATURE tint. Everything else
 *     stays parent.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import type { BeatInfo } from '../../channel';
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
  'uniform float u_palette;\n' +
  'uniform float u_charge;\n' +
  'uniform float u_spawnSnare;\n' +
  'uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1\n' +
  'uniform float u_phrase;    // in-phrase swell 0..1, released on downbeats\n' +
  'uniform float u_spread;    // spectral spread -> disk breadth\n' +
  'uniform float u_flatness;  // spectral flatness -> nebula texture\n' +
  // --- g05 embers: drifting ember field uniforms ---
  'uniform float u_emberDrift;  // accumulated drift phase (quickens in buildups)\n' +
  'uniform float u_emberScatter;// snare-gust scatter 0..1 (mid/high gated)\n' +
  'uniform float u_ignite;      // whole-field ignition, rides max(drop, energy)\n' +
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
  '// DRIFTING EMBER FIELD: a lattice of slow-rising embers. Each cell owns one\n' +
  '// ember with its own position, size, and a per-ember phase; brightness is\n' +
  '// EARNED — the caller supplies a lit factor from the traveling ripple, the\n' +
  '// field ignition, and the snare scatter. Palette travel tints ember\n' +
  '// TEMPERATURE (cool coal -> warm blaze).\n' +
  'vec3 emberField(vec2 c, float r, float drift, float scatter, float lit, float palTemp) {\n' +
  '  vec3 acc = vec3(0.0);\n' +
  '  // Two overlaid lattices at different scales for depth (near + far embers).\n' +
  '  for (int L = 0; L < 2; L++) {\n' +
  '    float density = L == 0 ? 9.0 : 15.0;\n' +
  '    float sizeScale = L == 0 ? 3.4 : 1.9;\n' +
  '    // Slow upward + swirling drift; snare gusts add lateral jitter.\n' +
  '    vec2 flow = vec2(\n' +
  '      0.12 * sin(drift * 0.7 + float(L) * 2.3) + scatter * 0.5 * (hash(vec2(float(L), 4.1)) - 0.5),\n' +
  '      -drift * (0.18 + 0.06 * float(L))\n' +
  '    );\n' +
  '    vec2 q = (c + flow) * density;\n' +
  '    vec2 cell = floor(q);\n' +
  '    vec2 sc = cell + vec2(fract(u_seed * 0.5137) * 51.3 + float(L) * 7.7, fract(u_seed * 0.2917) * 37.9);\n' +
  '    // Per-ember rest position inside its cell, jostled by the scatter gust.\n' +
  '    vec2 pos = vec2(hash(sc + 2.1), hash(sc.yx + 6.3)) * 0.7 + 0.15;\n' +
  '    pos += (vec2(hash(sc + drift * 0.3), hash(sc.yx + drift * 0.27)) - 0.5) * scatter * 0.4;\n' +
  '    vec2 f = fract(q) - pos;\n' +
  '    float on = step(0.45, hash(sc * 1.37 + 3.9));\n' +
  '    float size = (0.5 + 1.5 * hash(sc.yx * 2.31)) * sizeScale;\n' +
  '    // Per-ember slow breathing so the field is never dead-still.\n' +
  '    float breathe = 0.5 + 0.5 * sin(drift * 1.3 + hash(sc + 11.0) * 6.28318);\n' +
  '    float glow = starShape(f, size) * on * (0.25 + 0.75 * breathe);\n' +
  '    // Ember temperature: cool coal at rest, warmer as it is lit; palette\n' +
  '    // travel shifts the warm end.\n' +
  '    float warmth = clamp(lit * (0.4 + 0.9 * hash(sc + 19.3)) + 0.15 * breathe, 0.0, 1.0);\n' +
  '    vec3 cool = vec3(0.5, 0.09, 0.03);\n' +
  '    vec3 warm = mix(vec3(1.0, 0.55, 0.16), palette(0.08 + palTemp), 0.4);\n' +
  '    vec3 hot = vec3(1.0, 0.92, 0.72);\n' +
  '    vec3 tint = mix(cool, warm, warmth);\n' +
  '    tint = mix(tint, hot, clamp(lit - 0.6, 0.0, 0.4) * 2.0);\n' +
  '    acc += tint * glow * (0.35 + 1.9 * lit);\n' +
  '  }\n' +
  '  // Denser toward the center where the old core lived, but NO central glow —\n' +
  '  // the falloff only weights the ember population, it never adds a core.\n' +
  '  return acc * (0.55 + 0.9 * exp(-r * 2.6));\n' +
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
  '  // Per-axis seed mixing: adding one scalar to both axes made the sin-hash\n' +
  '  // align stars into moire diagonals across the lattice.\n' +
  '  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);\n' +
  '  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;\n' +
  '  vec2 f = fract(q) - pos;\n' +
  '  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));\n' +
  '  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;\n' +
  '  float bright = 0.4 + 0.6 * hash(sc + 17.9);\n' +
  '  // Star tint samples the traveling palette at each star own hash phase.\n' +
  '  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);\n' +
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
  '  // The spiral twist TIGHTENS across the phrase (u_phrase 0->1) and\n' +
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
  '  // bassline, not just its size.\n' +
  '  // Electrical vibration: two fast noise bands arcing around the rim —\n' +
  '  // the bass circle hums like a live wire, violently under a kick.\n' +
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)\n' +
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);\n' +
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))\n' +
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)\n' +
  '    + volt * (0.14 * u_low + 0.32 * u_kick);\n' +
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));\n' +
  '  // Gravity waves: concentric rings breathing out of the core with the\n' +
  '  // bassline itself (not just kicks) — sustained lows keep the center alive.\n' +
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;\n' +
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);\n' +
  '  // Gravity ripple color: a spectral-hue-biased warm palette slice.\n' +
  '  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);\n' +
  '  fresh += gravityColor\n' +
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
  '  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));\n' +
  '  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);\n' +
  '  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);\n' +
  '  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore\n' +
  '    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);\n' +
  '  // ===== DRIFTING EMBER FIELD (replaces the voyage-prime core glow) =====\n' +
  '  // No central heart/corona: instead a field of slow-drifting embers whose\n' +
  '  // brightness is EARNED. The traveling ripple wavefront LIGHTS the embers\n' +
  '  // it crosses (rippleWave), the whole field IGNITES on drops (u_ignite),\n' +
  '  // a low bass floor keeps a faint smoulder alive, and snare gusts scatter\n' +
  '  // them (u_emberScatter). Palette travel tints ember temperature.\n' +
  '  float emberLit = clamp(\n' +
  '    0.12 + 2.4 * rippleWave + 1.1 * u_ignite + 0.5 * u_kick + 0.3 * bassOn,\n' +
  '    0.0, 1.0\n' +
  '  );\n' +
  '  float palTemp = 0.35 * clamp(u_palette, 0.0, 3.0) / 3.0 + u_centroid * 0.15 + t * 0.01;\n' +
  '  fresh += emberField(c, r, u_emberDrift, u_emberScatter, emberLit, palTemp)\n' +
  '    * (0.6 + 1.3 * u_ignite);\n' +
  '  // Radial dimmer keeps the middle dark so dust/stars read against it.\n' +
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);\n' +
  '  // Anamorphic lens streak across the core — the spacey money shot.\n' +
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));\n' +
  '  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);\n' +
  '  // The disk: spiral lanes + clouds in the TRAVELING palette.\n' +
  '  // spread controls disk BREADTH — a narrow sound concentrates the lanes\n' +
  '  // into a tight bright band (steeper radial falloff), a wide sound spreads\n' +
  '  // them outward (shallower falloff). Energy-neutral.\n' +
  '  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));\n' +
  '  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));\n' +
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));\n' +
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;\n' +
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));\n' +
  '  float cloud = pow(cloudField, 2.4);\n' +
  '  // Wide phase span + spatial drift: the old 0.7·cloudField span sampled\n' +
  '  // under half a palette period (and blend positions average cosines\n' +
  '  // flatter still) — dust came out monochrome at many slider stops.\n' +
  '  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);\n' +
  '  // Kick reverberation: the traveling wavefront LIGHTS the dust it passes\n' +
  '  // through (displacement alone read as subtle; this makes it audible).\n' +
  '  float reverb = 1.0 + 2.6 * rippleWave;\n' +
  '  float midGate = smoothstep(0.04, 0.3, u_mid);\n' +
  '  // dust SWELLS toward the phrase boundary (u_phrase), gently.\n' +
  '  float phraseSwell = 1.0 + 0.22 * u_phrase;\n' +
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;\n' +
  '  // HIGH NEBULA: distinct physics from the mid dust — finer scale,\n' +
  '  // counter-rotation, electric blue-white tint, fast shimmer flicker.\n' +
  '  // flatness textures it — tonal (0) = silky smooth wisps (softer power\n' +
  '  // curve, no grain), noisy (1) = grainy sparkle (grain modulation).\n' +
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));\n' +
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);\n' +
  '  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));\n' +
  '  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));\n' +
  '  // DISTINCT DUST HUE: high nebula samples the palette at +0.35 phase from\n' +
  '  // the mid dust so the bands read as different dust kinds.\n' +
  '  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);\n' +
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
  '    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);\n' +
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

const g05PrimeEmbers: VisualizerPreset = {
  id: 'g05-prime-embers',
  name: 'g05 prime-embers',
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
    // Phrase-tier release. `phrase` ramps 0->1 across the 4-bar phrase and
    // is snapped to 0 on the downbeat (release), then eased back up. Gridless
    // material breathes on a slow free-running triangle instead.
    let prevBarIndex: number | null = null;
    let phrase = 0;
    let smoothSpread = 0;
    let smoothFlatness = 0;
    // g05 embers: drifting ember field state. `emberDrift` accumulates the
    // field's slow drift phase and QUICKENS in buildups (tense-but-alive);
    // `emberScatter` is a fast-decaying snare gust that jostles the embers.
    let emberDrift = 0;
    let emberScatter = 0;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase.
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep; centroid EMA supplies the travel.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const beat: BeatInfo | null = frame.beat;
        // Excitement split by bass presence: with lows = the drop, without
        // = the buildup (risers/filtered kicks have busy highs, no bass).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // Drops fly outward; buildups COLLAPSE inward (zoom < 1).
        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        // Spiral-arm drift locks to the grid: one revolution per 64
        // beats (16 bars in 4/4); gridless falls back to slow time drift.
        armPhase += dt * (beat?.bpm ? ((beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge: kicks pump it, it bleeds off over ~2.5 s — the ring's
        // color/size/lens all ride it, so a busy bassline visibly heats the
        // horizon.
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple: retrigger on strong kicks, capture strength — this
        // is the wavefront that LIGHTS the ember field.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        // g05 embers: the field's drift QUICKENS and warms in buildups (never
        // still) and rides a touch faster on sustained energy.
        const driftRate = 0.5 + 1.6 * buildup + 0.5 * sustained;
        emberDrift += dt * driftRate;
        // g05 embers: snare gusts (mid transient, gated on mid/high band
        // presence) scatter the embers; the gust decays fast (~0.25 s).
        const midHighGate = Math.min(1, Math.max(0, (frame.bands.mid + frame.bands.high) * 0.6 - 0.1));
        const gust = Math.min(1, frame.impulse.mid * (0.5 + 0.9 * midHighGate));
        emberScatter = Math.max(emberScatter * Math.exp(-dt / 0.25), gust);
        // In-phrase swell. On a grid, `phrase` tracks the phrase phase and is
        // RELEASED on every phrase downbeat; gridless: a slow breath. Phrase
        // tiers use the ladder-correct ordinal when present.
        let phraseTarget: number;
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            const phraseBoundary = ((tierBar % 4) + 4) % 4 === 0;
            if (phraseBoundary) {
              phrase = 0;
            }
          }
          prevBarIndex = tierBar;
          phraseTarget = ((((tierBar % 4) + 4) % 4) + beat.barPhase) / 4;
        } else {
          phraseTarget = 0.5 + 0.5 * Math.sin(frame.time * 0.35);
        }
        phrase += (phraseTarget - phrase) * (1 - Math.exp(-dt / 0.5));
        // Spectral spread/flatness, gently smoothed so they don't jitter.
        smoothSpread += ((frame.spread ?? 0) - smoothSpread) * (1 - Math.exp(-dt / 0.4));
        smoothFlatness += ((frame.flatness ?? 0) - smoothFlatness) * (1 - Math.exp(-dt / 0.4));
        // Gentle with energy so drops stay dense; buildups drain extra.
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // Whole-field ignition rides max(drop, energy).
        const ignite = Math.min(1, Math.max(drop, energy));
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
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
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
          // g05 embers additions.
          u_emberDrift: emberDrift,
          u_emberScatter: Math.min(1, Math.max(0, emberScatter)),
          u_ignite: ignite,
        };
      },
    });
  },
};

export default g05PrimeEmbers;
