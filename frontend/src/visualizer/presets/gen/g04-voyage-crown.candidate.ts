/**
 * "g04 voyage-crown" (genetic arena g04): the CROSSOVER of the two strongest
 * voyage children — g02-voyage-prime × g03-solar-crown — into one definitive
 * hot voyage.
 *
 * From PRIME (the refinement layers), kept whole:
 *   (1) In-phrase evolution: dust swells and the spiral twist tightens toward
 *       each phrase boundary, released on the downbeat (u_phrase).
 *   (2) spread → disk breadth: a narrow sound concentrates the disk into a
 *       tight bright band, a wide sound spreads it outward (u_spread).
 *   (3) flatness → nebula texture: tonal = silky wisps, noisy = grainy
 *       sparkle (u_flatness).
 *
 * From CROWN (the prominences), unioned in: voyage's spinning event-horizon
 * ring is REPLACED by magnetic solar-flare arcs that erupt from the
 * photosphere on kicks, bow out along field lines, and collapse back over
 * ~1 s. Downbeat eruptions launch bigger (u_downbeat); section boundaries
 * flip the magnetic polarity (u_polarity). Hot param defaults (solar palette,
 * speed ~1.4, dense stars) are baked in.
 *
 * ENERGY-WHEN-DEMANDED (gen-4 directive): a `demand` signal = max(drop,
 * energy) gates the prominences. Quiet → the disk stays calm and only rare,
 * SMALL flares lick the rim (high kick threshold, low apex, sparse feet).
 * Loud → prominence storms (low threshold, tall apexes, whiter, all three
 * feet firing). True dynamic range, never flat.
 *
 * Contract-safe: default-export VisualizerPreset, GL feedback via
 * createGlRenderer (context-loss safe), GLSL ES 1.0, no backticks in the
 * shader, chroma-preserving soft knee (never per-channel clamp).
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

const FRAGMENT = [
  'precision highp float;',
  'uniform sampler2D u_prev;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_low;',
  'uniform float u_mid;',
  'uniform float u_high;',
  'uniform float u_kick;',
  'uniform float u_snare;',
  'uniform float u_centroid;',
  'uniform float u_specHue;',
  'uniform float u_drop;',
  'uniform float u_buildup;',
  'uniform float u_zoom;',
  'uniform float u_rotStep;',
  'uniform float u_decay;',
  'uniform float u_seed;',
  'uniform float u_spawn;',
  'uniform float u_rippleAge;',
  'uniform float u_rippleAmp;',
  'uniform float u_sustain;',
  'uniform float u_armPhase;',
  'uniform float u_dust;',
  'uniform float u_palette;',
  'uniform float u_charge;',
  'uniform float u_spawnSnare;',
  'uniform float u_spawnSnare2;',
  'uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1',
  // --- prime refinement uniforms ---
  'uniform float u_phrase;',      // in-phrase swell 0..1, released on downbeats
  'uniform float u_spread;',      // spectral spread -> disk breadth
  'uniform float u_flatness;',    // spectral flatness -> nebula texture
  // --- crown solar-prominence meter uniforms ---
  'uniform float u_flareAge;',    // seconds since the last flare erupted
  'uniform float u_flareAmp;',    // that flare strength (bigger on downbeats)
  'uniform float u_flareSeed;',   // per-eruption seed (field-line placement)
  'uniform float u_downbeat;',    // 1 near a bar downbeat, decays across the bar
  'uniform float u_polarity;',    // +1 / -1, flips at section boundaries (smoothed)
  'uniform float u_demand;',      // energy-when-demanded: max(drop, energy) 0..1
  '',
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';',
  'const vec3 HIGH = ' + rgb(ADDITIVE_COLORS[2]) + ';',
  '',
  'float hash(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
  '}',
  '',
  'float noise(vec2 p) {',
  '  vec2 i = floor(p);',
  '  vec2 f = fract(p);',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(',
  '    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
  '    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),',
  '    u.y',
  '  );',
  '}',
  '',
  'float fbm(vec2 p) {',
  '  float v = 0.0;',
  '  float amp = 0.5;',
  '  for (int i = 0; i < 4; i++) {',
  '    v += amp * noise(p);',
  '    p = p * 2.03 + vec2(17.3, 9.1);',
  '    amp *= 0.5;',
  '  }',
  '  return v;',
  '}',
  '',
  '// iq cosine palette: ember -> nebula -> aurora -> solar, morphing.',
  'vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }',
  'vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }',
  'vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }',
  'vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }',
  '',
  'vec3 palette(float t) {',
  '  float x = clamp(u_palette, 0.0, 3.0);',
  '  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));',
  '  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));',
  '  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));',
  '  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;',
  '}',
  '',
  'float starShape(vec2 f, float size) {',
  '  float d2 = dot(f, f);',
  '  float core = exp(-d2 * 1100.0 / size);',
  '  float halo = exp(-d2 * 140.0 / size) * 0.2;',
  '  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)',
  '    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;',
  '  return core + halo + spikes;',
  '}',
  '',
  '// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in',
  '// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.',
  'vec3 hueRotate(vec3 c, float rot) {',
  '  float y = dot(c, vec3(0.299, 0.587, 0.114));',
  '  float i = dot(c, vec3(0.596, -0.274, -0.322));',
  '  float q = dot(c, vec3(0.211, -0.523, 0.312));',
  '  float h = atan(q, i) + rot * 6.28318;',
  '  float chroma = sqrt(i * i + q * q);',
  '  i = chroma * cos(h);',
  '  q = chroma * sin(h);',
  '  return max(vec3(0.0), vec3(',
  '    y + 0.956 * i + 0.621 * q,',
  '    y - 0.272 * i - 0.647 * q,',
  '    y - 1.106 * i - 1.703 * q',
  '  ));',
  '}',
  'vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {',
  '  vec2 q = c * density;',
  '  vec2 cell = floor(q);',
  '  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);',
  '  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;',
  '  vec2 f = fract(q) - pos;',
  '  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));',
  '  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;',
  '  float bright = 0.4 + 0.6 * hash(sc + 17.9);',
  '  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);',
  '  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float aspect = u_res.x / u_res.y;',
  '  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);',
  '  float r = length(c);',
  '  float ang = atan(c.y, c.x);',
  '  float t = u_time;',
  '  vec2 px = 1.0 / u_res;',
  '',
  // ---- Warp: prime's phrase-tightened spiral twist (crossover keeps this).
  '  float twist = 1.0 + 0.12 * u_phrase;',
  '  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * twist;',
  '  float cs = cos(rot);',
  '  float sn = sin(rot);',
  '  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;',
  '  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);',
  '  vec2 churn = (vec2(',
  '    fbm(c * 2.6 + t * 0.12),',
  '    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)',
  '  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);',
  '  float waveFront = 0.16 + u_rippleAge * 0.9;',
  '  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;',
  '  vec2 ripple = dirW * rippleWave * 0.035;',
  '  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);',
  '  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);',
  '  float drag = lens * 0.12;',
  '  float dcs = cos(drag);',
  '  float dsn = sin(drag);',
  '  w = mat2(dcs, -dsn, dsn, dcs) * w;',
  '  vec2 lensPull = dirW * lens * 0.055;',
  '  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;',
  '',
  // Chromatic aberration + unsharp feedback (voyage engine, unchanged).
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)',
  '    / vec2(aspect, 1.0);',
  '  ab *= u_dust; // fringe amount rides the dust param (human note)',
  '  // fringe fix: hue-steerable fringes -- rotate the field to the anchor',
  '  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can',
  '  // go slightly negative) so the unsharp feedback loop stays stable.',
  '  float fringeRot = u_hueRot;',
  '  vec3 tapA = texture2D(u_prev, src + ab).rgb;',
  '  vec3 tapC = texture2D(u_prev, src).rgb;',
  '  vec3 tapB = texture2D(u_prev, src - ab).rgb;',
  '  vec3 sampled = max(vec3(0.0), hueRotate(vec3(',
  '    hueRotate(tapA, -fringeRot).r,',
  '    hueRotate(tapC, -fringeRot).g,',
  '    hueRotate(tapB, -fringeRot).b',
  '  ), fringeRot));',
  '  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb',
  '    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;',
  '  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;',
  '',
  // ---- Steady layers.
  '  vec3 fresh = vec3(0.0);',
  // Photosphere surface radius: the sun-rim the prominences root on (crown).
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)',
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);',
  '  float surf = horizon + volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);',
  '',
  // Core / heart / corona-body (voyage engine, bass-solid).
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))',
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)',
  '    + volt * (0.14 * u_low + 0.32 * u_kick);',
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));',
  '  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));',
  '  float coronaBody = exp(-rc * (7.0 - 3.0 * u_low));',
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;',
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);',
  '  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);',
  '  fresh += gravityColor',
  '    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;',
  '',
  // ===== SOLAR PROMINENCES (crown), gated by ENERGY-WHEN-DEMANDED =====
  // A live eruption: right after a kick u_flareAge is small; the arc apex
  // rises then collapses over ~1 s. Height scales with captured strength
  // (downbeats bigger); u_demand widens the whole thing on loud passages.
  '  float life = clamp(u_flareAge / 1.0, 0.0, 1.0);',
  '  float riseFall = sin(life * 3.14159265);',
  '  riseFall = pow(riseFall, 0.7);',
  '  float flareEnergy = u_flareAmp * exp(-u_flareAge * 1.6);',
  // Quiet: small apex, tight lobes. Loud: taller, wider — a storm.
  '  float apexH = (0.07 + 0.10 * u_flareAmp + 0.24 * u_flareAmp * u_demand) * riseFall;',
  // Feet count follows demand: 1 lonely lick when quiet, all 3 when loud.
  '  float feetOn = 1.0 + 2.0 * smoothstep(0.15, 0.7, u_demand);',
  '  float promo = 0.0;',
  '  float promoHot = 0.0;',
  '  for (int i = 0; i < 3; i++) {',
  '    float fi = float(i);',
  '    float gateFoot = step(fi, feetOn - 0.5);',
  '    float base = u_flareSeed * 6.28318530 + fi * 2.09439510',
  '      + u_polarity * (0.35 + 0.25 * life);',
  '    float span = 0.55 + 0.25 * hash(vec2(u_flareSeed * 13.1 + fi, 7.0));',
  '    float apex = apexH * (0.7 + 0.6 * hash(vec2(fi * 3.7, u_flareSeed * 5.3)));',
  '    float d = ang - base;',
  '    d = mod(d + 3.14159265, 6.28318530) - 3.14159265;',
  '    float s = d / max(span, 0.001);',
  '    if (abs(s) <= 1.0) {',
  '      float lobe = pow(cos(s * 1.5708), 1.4);',
  '      float lineR = surf + apex * lobe;',
  '      float dr = (r - lineR);',
  '      float body = exp(-dr * dr * 900.0);',
  '      float glowW = exp(-dr * dr * 120.0) * 0.5;',
  '      float foot = smoothstep(1.0, 0.55, abs(s));',
  '      promo += (body + glowW) * flareEnergy * (0.55 + 0.6 * foot) * gateFoot;',
  '      promoHot += body * flareEnergy * riseFall * (0.4 + 0.9 * foot) * gateFoot;',
  '    }',
  '  }',
  '  vec3 promColor = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.72, 0.3), clamp(apexH * 2.5, 0.0, 1.0));',
  '  promColor = mix(promColor, vec3(1.0, 0.95, 0.85), clamp(u_downbeat * riseFall * (0.4 + 0.6 * u_demand), 0.0, 1.0));',
  '  fresh += promColor * promo * (0.6 + 1.4 * u_kick + 0.8 * u_charge);',
  '  fresh += vec3(1.0, 0.9, 0.75) * promoHot * (0.5 + 1.0 * u_downbeat);',
  '',
  // Mid-streaming corona: soft radial licks from the rim (crown). Quiet keeps
  // it a low simmer; mids/demand make it stream.
  '  float coronaField = fbm(vec2(ang * 5.0 + u_polarity * t * 0.4, (r - surf) * 9.0 - t * 0.6));',
  '  float streamers = 0.5 + 0.5 * sin(ang * 22.0 + u_polarity * t * 1.3 + coronaField * 6.0);',
  '  float coronaBand = exp(-pow((r - surf) * 7.0, 2.0)) + exp(-pow((r - surf * 1.8) * 3.5, 2.0)) * 0.5;',
  '  float coronaGain = (0.08 + 1.3 * u_mid + 0.5 * u_demand) * (0.4 + 0.6 * coronaField);',
  '  vec3 coronaColor = mix(vec3(1.0, 0.5, 0.15), palette(0.55 + t * 0.02), 0.4);',
  '  fresh += coronaColor * coronaBand * pow(streamers, 2.0) * coronaGain;',
  '',
  // Coal heart + corona body (voyage, kept — bass solid).
  '  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;',
  '  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);',
  '  fresh += mix(coal, LOW, 0.4) * coronaBody * (0.1 + 0.6 * u_low + 0.35 * u_kick);',
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);',
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));',
  '  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);',
  '',
  // ---- Spiral dust disk: PRIME's spread->breadth + phrase swell.
  '  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));',
  '  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));',
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));',
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;',
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));',
  '  float cloud = pow(cloudField, 2.4);',
  '  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);',
  '  float reverb = 1.0 + 2.6 * rippleWave;',
  '  float midGate = smoothstep(0.04, 0.3, u_mid);',
  '  float phraseSwell = 1.0 + 0.22 * u_phrase;',
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;',
  '  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;',
  '',
  // ---- High nebula: PRIME's flatness texturing (silky vs grainy).
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));',
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);',
  '  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));',
  '  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));',
  '  // DISTINCT DUST HUE: high nebula samples the palette at +0.35 phase from',
  '  // the mid dust so the bands read as different dust kinds.',
  '  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);',
  '  fresh += electric * pow(wisp, silky) * shimmer * grain * smoothstep(0.12, 0.5, r)',
  '    * (0.08 + 1.7 * u_high) * u_dust * reverb;',
  '  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);',
  '',
  // Nebula puffs (voyage engine, unchanged).
  '  if (u_spawn > 0.01) {',
  '    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);',
  '    float puff = pow(fbm(c * 7.0 + sOff), 3.5);',
  '    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;',
  '  }',
  '',
  // Transient stamps (voyage engine, unchanged).
  '  if (u_kick > 0.02) {',
  '    float ringR = 0.1 + 0.05 * u_kick;',
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))',
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));',
  '    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);',
  '    sky *= 1.0 + 0.1 * u_kick;',
  '  }',
  '  if (u_snare > 0.03) {',
  '    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);',
  '    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;',
  '  }',
  '  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {',
  '    float reach = smoothstep(0.05, 0.18, r);',
  '    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare2) * reach',
  '      * mix(vec3(1.0), palette(0.15), 0.45);',
  '  }',
  '',
  // Film grain (voyage engine, unchanged).
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);',
  '',
  // Palette grade + drop/buildup (voyage engine, unchanged).
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);',
  '  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);',
  '  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;',
  // Chroma-preserving soft knee (never per-channel clamp).
  '  float m = max(sky.r, max(sky.g, sky.b));',
  '  if (m > 0.8) {',
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);',
  '}',
].join('\n');

const g04VoyageCrownPreset: VisualizerPreset = {
  id: 'g04-voyage-crown',
  name: 'g04 voyage-crown',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1.4 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 3 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1.4 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    // PRIME: phrase-tier release. `phrase` ramps 0->1 across the 4-bar phrase
    // and is snapped to 0 on the downbeat, then eased back up. Gridless
    // material breathes on a slow free-running triangle instead.
    let prevBarIndexPhrase: number | null = null;
    let phrase = 0;
    let smoothSpread = 0;
    let smoothFlatness = 0;
    // CROWN: solar-prominence eruption + section polarity state.
    let flareAge = 999;
    let flareAmp = 0;
    let flareSeed = 0;
    let prevBarIndexPolarity: number | null = null;
    let polarityTarget = 1;
    let polarity = 1;
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
        const speed = frame.params.speed ?? 1.4;
        const persistence = frame.params.persistence ?? 1;
        const beat: BeatInfo | null = frame.beat;
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);
        // Energy-when-demanded: one signal the prominences read. High when the
        // music goes hard (drop or sustained loudness), near-zero when quiet.
        const demand = Math.min(1, Math.max(drop, sustained));
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (beat?.bpm ? ((beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // ---- PRIME meter: in-phrase swell, released on phrase downbeats.
        let phraseTarget: number;
        if (beat && beat.barIndex !== null) {
          if (prevBarIndexPhrase !== null && beat.barIndex !== prevBarIndexPhrase) {
            const phraseBoundary = (((beat.barIndex % 4) + 4) % 4) === 0;
            if (phraseBoundary) phrase = 0;
          }
          prevBarIndexPhrase = beat.barIndex;
          phraseTarget = ((((beat.barIndex % 4) + 4) % 4) + beat.barPhase) / 4;
        } else {
          phraseTarget = 0.5 + 0.5 * Math.sin(frame.time * 0.35);
        }
        phrase += (phraseTarget - phrase) * (1 - Math.exp(-dt / 0.5));
        // PRIME: spectral spread/flatness, gently smoothed so they don't jitter.
        smoothSpread += ((frame.spread ?? 0) - smoothSpread) * (1 - Math.exp(-dt / 0.4));
        smoothFlatness += ((frame.flatness ?? 0) - smoothFlatness) * (1 - Math.exp(-dt / 0.4));

        // ---- CROWN meter: section polarity flip (every 16 bars = one section).
        if (beat && beat.barIndex !== null) {
          if (prevBarIndexPolarity !== null && beat.barIndex !== prevBarIndexPolarity) {
            const sectionBoundary = ((beat.barIndex % 16) + 16) % 16 === 0;
            if (sectionBoundary) polarityTarget = -polarityTarget;
          }
          prevBarIndexPolarity = beat.barIndex;
        }
        polarity += (polarityTarget - polarity) * (1 - Math.exp(-dt / 0.6));

        // Downbeat weight: 1 near the bar's downbeat, decaying across it.
        const downbeat = beat && beat.barPhase !== null
          ? Math.pow(1 - Math.min(1, beat.barPhase * 1.5), 2)
          : 0.3;

        // ---- Prominence eruption: kicks launch a flare; downbeats bigger.
        // ENERGY-WHEN-DEMANDED: the kick threshold RISES as demand falls, so
        // quiet passages fire only on the strongest kicks (rare small flares);
        // loud passages let almost every kick erupt (prominence storms).
        flareAge += dt;
        const flareThresh = 0.5 - 0.24 * demand;
        if (frame.impulse.low > flareThresh && flareAge > 0.14) {
          flareAge = 0;
          flareAmp = Math.min(
            1.4,
            frame.impulse.low * (0.8 + 0.9 * downbeat) * (0.5 + 0.9 * demand)
          );
          flareSeed = (frame.time * 0.618 + frame.impulse.low * 3.1) % 1;
        }

        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        const stars = frame.params.stars ?? 1.4;
        const spawnSnare =
          ((Math.min(1, 0.95 * frame.impulse.mid) * stars * (0.5 + 0.5 * Math.max(drop, sustained))) /
            (1 + 0.8 * buildup)) /
          (1 + 2.2 * frame.impulse.low);
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
          u_palette: frame.params.palette ?? 3,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              stars *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare: spawnSnare,
          u_spawnSnare2: spawnSnare * 1.2,
          // PRIME refinement uniforms.
          u_phrase: Math.min(1, Math.max(0, phrase)),
          u_spread: Math.min(1, Math.max(0, smoothSpread)),
          u_flatness: Math.min(1, Math.max(0, smoothFlatness)),
          // CROWN solar-prominence uniforms.
          u_flareAge: flareAge,
          u_flareAmp: flareAmp,
          u_flareSeed: flareSeed,
          u_downbeat: downbeat,
          u_polarity: polarity,
          u_demand: demand,
        };
      },
    });
  },
};

export default g04VoyageCrownPreset;
