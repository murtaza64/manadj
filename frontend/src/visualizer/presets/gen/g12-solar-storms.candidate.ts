/**
 * g12-solar-storms (gen-12 mid/high RESPONSIVENESS tweak).
 *
 * Parents copied wholesale (post-sweep): g09-solar-spectra (the superset —
 * the voyage-derived engine baked HOT, beat-grid erupting prominences,
 * mid-colored field lines, spectral stellar body, per-eruption flare hue,
 * corona breadth/shimmer) which itself carries g08-solar-beat's beat grammar.
 * Beat-grid prominence eruptions + the per-bar rotation notch stay. gen-12
 * adds TWO NEW ATMOSPHERIC SYSTEMS for the mid/high bands:
 *
 *   MIDS = AURORA SHEETS at the star's poles. Curtain ribbons hang above the
 *   north/south poles of the crown; their EXTENT (how far they reach) and
 *   DANCE RATE ride bandsSlow.mid (motion-smoothness law — the sheets sway on
 *   the slow band, not the 8ms-attack instantaneous mid). They are colored by
 *   the mids-hue field-line system (u_fieldHue), so the aurora and the field
 *   lines share a hue. EQ kill mid => the sheets collapse (u_midKill).
 *
 *   HIGHS = CORONA STATIC. Crackling filament granularity in the corona —
 *   fine branching micro-arcs (discrete jittered segments), density from
 *   highs (u_coronaStatic). NOT powder/particles: a crackle of thin arcs.
 *   EQ kill high => the corona goes smooth (density -> 0).
 *
 *   DROP = polar aurora STORM (sheets flare tall + fast) + full corona
 *   crackle, riding max(drop, energy).
 *
 * Standing law: docs/visualizer-ga.md — taste calibration, photosensitivity
 * floor (all new light is localized / band-limited, never a full-field
 * strobe), feedback contraction (fresh injection bounded by (1 - decay)),
 * MOTION SMOOTHNESS (dance/sway ride bandsSlow.mid), luminance-parity.
 * Phrase/section via beat.ladderBarIndex ?? beat.barIndex.
 *
 * Contract-safe: default-export VisualizerPreset, GL feedback via
 * createGlRenderer, GLSL ES 1.0, NO backticks in the shader, chroma-
 * preserving soft knee.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { SPECTRUM_BAND_COUNT } from '../../channel';
import type { BeatInfo } from '../../channel';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

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
  // --- solar-prominence meter uniforms ---
  'uniform float u_flareAge;',
  'uniform float u_flareAmp;',
  'uniform float u_flareLong;',
  'uniform float u_downbeat;',
  'uniform float u_polarity;',
  // --- beat-grammar uniforms ---
  'uniform float u_crownRot;',
  'uniform float u_fieldHue;',
  'uniform float u_tension;',
  'uniform float u_shimmer;',
  'uniform float u_dropErupt;',
  // --- g09 spectral-color uniforms ---
  'uniform float u_bodyHue;',
  'uniform float u_flareHue;',
  'uniform float u_fieldSat;',
  'uniform float u_coronaBreadth;',
  // --- g12 storm uniforms ---
  'uniform float u_auroraMid;',    // motion-grade mid: aurora-sheet extent + dance (bandsSlow.mid)
  'uniform float u_auroraDance;',  // aurora dance phase (rides bandsSlow.mid, slow)
  'uniform float u_midKill;',      // EQ mid kill: 1 flat -> 0 killed (sheets collapse)
  'uniform float u_coronaStatic;', // corona-static density (highs)
  'uniform float u_highKill;',     // EQ high kill: 1 flat -> 0 killed (corona smooth)
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
  // nimitz triangle noise for the aurora ridges.
  'float tri(float x) { return abs(fract(x) - 0.5); }',
  '',
  'vec3 hue2rgb(float h) {',
  '  vec3 k = mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);',
  '  return clamp(min(k, 4.0 - k), 0.0, 1.0);',
  '}',
  'vec3 desat(vec3 c, float sat) {',
  '  float y = dot(c, vec3(0.299, 0.587, 0.114));',
  '  return mix(vec3(y), c, clamp(sat, 0.0, 1.0));',
  '}',
  '',
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
  'vec3 stellarBody(float shade) {',
  '  vec3 amber = vec3(0.85, 0.28, 0.06);',
  '  vec3 gold = vec3(0.95, 0.65, 0.3);',
  '  vec3 whiteBlue = vec3(0.7, 0.85, 1.0);',
  '  float h = clamp(u_bodyHue, 0.0, 1.0);',
  '  vec3 c = mix(amber, gold, clamp(h * 2.0, 0.0, 1.0));',
  '  c = mix(c, whiteBlue, clamp((h - 0.5) * 2.0, 0.0, 1.0));',
  '  return c * shade;',
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
  'vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {',
  '  vec2 q = c * density;',
  '  vec2 cell = floor(q);',
  '  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);',
  '  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;',
  '  vec2 f = fract(q) - pos;',
  '  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));',
  '  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;',
  '  float bright = 0.4 + 0.6 * hash(sc + 17.9);',
  '  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));',
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
  '  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));',
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
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)',
  '    / vec2(aspect, 1.0);',
  '  vec3 sampled = vec3(',
  '    texture2D(u_prev, src + ab).r,',
  '    texture2D(u_prev, src).g,',
  '    texture2D(u_prev, src - ab).b',
  '  );',
  '  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb',
  '    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;',
  '  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;',
  '',
  '  vec3 fresh = vec3(0.0);',
  '  float crownAng = ang - u_crownRot;',
  '  float volt = (noise(vec2(crownAng * 14.0 + t * 3.0, t * 22.0)) - 0.5)',
  '    + 0.5 * (noise(vec2(crownAng * 30.0 - t * 5.0, t * 37.0)) - 0.5);',
  '  float surf = horizon + volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);',
  '',
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))',
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)',
  '    + volt * (0.14 * u_low + 0.32 * u_kick);',
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));',
  '  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));',
  '  float coronaBody = exp(-rc * (7.0 - 3.0 * u_low));',
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;',
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);',
  '  fresh += mix(stellarBody(0.65), LOW, 0.4)',
  '    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;',
  '',
  // ===== MAGNETIC FIELD LINES (parent) =====
  '  float fieldMass = 0.0;',
  '  for (int i = 0; i < 6; i++) {',
  '    float fi = float(i);',
  '    float lbase = (fi / 6.0) * 6.28318530 + u_crownRot * 0.5 + u_polarity * 0.2;',
  '    float ld = crownAng - lbase;',
  '    ld = mod(ld + 3.14159265, 6.28318530) - 3.14159265;',
  '    float lspan = 0.9;',
  '    float ls = ld / lspan;',
  '    if (abs(ls) <= 1.0) {',
  '      float lobe = pow(cos(ls * 1.5708), 1.3);',
  '      float apexH = (0.14 + 0.08 * u_mid) * (1.0 - 0.55 * u_tension) * (1.0 + 0.5 * u_dropErupt);',
  '      float lineR = surf + apexH * lobe;',
  '      float dr = (r - lineR);',
  '      float line = exp(-dr * dr * 700.0) * smoothstep(1.0, 0.2, abs(ls));',
  '      fieldMass += line;',
  '    }',
  '  }',
  '  vec3 fieldCol = hue2rgb(fract(u_fieldHue));',
  '  fieldCol = desat(fieldCol, 0.15 + 0.85 * u_fieldSat);',
  '  fieldCol = mix(fieldCol, vec3(1.0, 0.95, 0.85), 0.6 * u_dropErupt);',
  '  float fieldGain = (0.25 + 1.6 * u_mid + 1.4 * u_dropErupt) * (0.5 + 0.5 * u_sustain);',
  '  fresh += fieldCol * fieldMass * fieldGain;',
  '',
  // ===== NEW: POLAR AURORA SHEETS (MIDS) =====
  // Curtain ribbons above the north/south poles of the crown. The pole axis is
  // vertical in the crown frame; sheets hang at crownAng near +pi/2 (north) and
  // -pi/2 (south). EXTENT and DANCE ride bandsSlow.mid (u_auroraMid); DROP makes
  // them storm (tall + fast). Colored by the field-line hue (shared hue system).
  '  float auroraMass = 0.0;',
  '  {',
  '    float extent = (0.10 + 0.28 * u_auroraMid + 0.30 * u_dropErupt) * u_midKill;',
  '    float storm = 1.0 + 1.6 * u_dropErupt;',
  // Two poles: north (+cos>0 region), south. Use the crown-frame vertical.
  '    for (int p = 0; p < 2; p++) {',
  '      float sgn = p == 0 ? 1.0 : -1.0;',
  // Pole proximity: how close crownAng is to +/- pi/2 (top/bottom).
  '      float poleAng = sgn * 1.5708;',
  '      float da = crownAng - poleAng;',
  '      da = mod(da + 3.14159265, 6.28318530) - 3.14159265;',
  '      float poleGate = smoothstep(1.1, 0.0, abs(da));',       // near this pole
  // Ribbon ridges: nimitz sine + triangle noise, dancing with u_auroraDance.
  '      for (int k = 0; k < 3; k++) {',
  '        float fk = float(k);',
  '        float dph = u_auroraDance * (0.6 + 0.5 * fk) * storm;',
  '        float ridge = tri(da * (2.5 + fk) + dph + fk * 1.7)',
  '          + 0.6 * fbm(vec2(da * 3.0 + dph, (r - surf) * 6.0));',
  '        float ribbonR = surf + (0.02 + fk * 0.03) + extent * (0.4 + 0.6 * (ridge - 0.3));',
  '        float dr = r - ribbonR;',
  '        float ribbon = exp(-dr * dr * (120.0 - 40.0 * u_auroraMid)) * poleGate;',
  '        auroraMass += ribbon * (0.5 + 0.5 * (ridge));',
  '      }',
  '    }',
  '  }',
  // Sheet color: the field-line hue (shared), luminance-parity gains.
  '  vec3 auroraCol = hue2rgb(fract(u_fieldHue + 0.08));',
  '  auroraCol = desat(auroraCol, 0.35 + 0.65 * u_fieldSat);',
  '  auroraCol = mix(auroraCol, vec3(0.85, 0.95, 1.0), 0.35 * u_dropErupt);',
  '  fresh += auroraCol * auroraMass * (0.35 + 1.3 * u_auroraMid + 1.1 * u_dropErupt) * (0.5 + 0.5 * u_sustain);',
  '',
  // ===== SOLAR PROMINENCES (parent) =====
  '  float life = clamp(u_flareAge / 1.0, 0.0, 1.0);',
  '  float riseFall = pow(sin(life * 3.14159265), 0.7);',
  '  float flareEnergy = u_flareAmp * exp(-u_flareAge * 1.6);',
  '  float apexH = (0.10 + 0.30 * u_flareAmp) * riseFall;',
  '  float promo = 0.0;',
  '  float promoHot = 0.0;',
  '  for (int i = 0; i < 6; i++) {',
  '    float fi = float(i);',
  '    float longi = i == 0 ? u_flareLong * 6.28318530 : (fi / 6.0) * 6.28318530 + u_crownRot * 0.5;',
  '    float base = crownAng - (longi - u_crownRot) + u_polarity * (0.25 + 0.2 * life);',
  '    base = mod(base + 3.14159265, 6.28318530) - 3.14159265;',
  '    float gateI = i == 0 ? 1.0 : u_dropErupt;',
  '    if (gateI < 0.01) continue;',
  '    float span = 0.5 + 0.2 * hash(vec2(fi * 3.1, 7.0));',
  '    float apex = apexH * (0.7 + 0.6 * hash(vec2(fi * 3.7, u_flareLong * 5.3)));',
  '    float s = base / max(span, 0.001);',
  '    if (abs(s) <= 1.0) {',
  '      float lobe = pow(cos(s * 1.5708), 1.4);',
  '      float lineR = surf + apex * lobe;',
  '      float dr = (r - lineR);',
  '      float bodyF = exp(-dr * dr * 900.0);',
  '      float glowW = exp(-dr * dr * 120.0) * 0.5;',
  '      float foot = smoothstep(1.0, 0.55, abs(s));',
  '      promo += (bodyF + glowW) * flareEnergy * gateI * (0.55 + 0.6 * foot);',
  '      promoHot += bodyF * flareEnergy * gateI * riseFall * (0.4 + 0.9 * foot);',
  '    }',
  '  }',
  '  vec3 flareTint = hue2rgb(fract(u_flareHue));',
  '  flareTint = mix(vec3(1.0, 0.4, 0.12), flareTint, 0.75);',
  '  vec3 promColor = mix(flareTint, vec3(1.0, 0.85, 0.5), clamp(apexH * 2.5, 0.0, 1.0));',
  '  promColor = mix(promColor, vec3(1.0, 0.95, 0.85), clamp(u_downbeat * riseFall + 0.6 * u_kick, 0.0, 1.0));',
  '  fresh += promColor * promo * (0.6 + 1.4 * u_kick + 0.8 * u_charge);',
  '  fresh += vec3(1.0, 0.9, 0.75) * promoHot * (0.5 + 1.0 * u_downbeat);',
  '',
  // ===== CORONA (parent breadth/shimmer) + NEW CORONA STATIC (HIGHS) =====
  '  float shimmerFreq = 16.0 + 34.0 * u_shimmer;',
  '  float coronaField = fbm(vec2(crownAng * 5.0 + u_polarity * t * 0.4, (r - surf) * 9.0 - t * 0.6));',
  '  float streamers = 0.5 + 0.5 * sin(crownAng * shimmerFreq + u_polarity * t * 1.3 + coronaField * 6.0);',
  '  float bandTight = 7.0 - 4.0 * clamp(u_coronaBreadth, 0.0, 1.0);',
  '  float bandTight2 = 3.5 - 1.8 * clamp(u_coronaBreadth, 0.0, 1.0);',
  '  float coronaBand = exp(-pow((r - surf) * bandTight, 2.0)) + exp(-pow((r - surf * 1.8) * bandTight2, 2.0)) * 0.5;',
  '  float coronaGain = (0.12 + 1.0 * u_mid + 0.9 * u_high + 0.4 * u_sustain) * (0.4 + 0.6 * coronaField);',
  '  vec3 coronaColor = mix(vec3(1.0, 0.5, 0.15), palette(0.55 + t * 0.02), 0.4);',
  '  fresh += coronaColor * coronaBand * pow(streamers, 2.0) * coronaGain;',
  '',
  // CORONA STATIC: fine branching micro-arcs crackling in the corona shell.
  // Discrete jittered segments (cellular hash), density from highs. Rides
  // max(drop,energy) so drops crackle full. EQ high kill -> density 0.
  '  float staticDensity = clamp(u_coronaStatic, 0.0, 1.0) * u_highKill;',
  '  float storm2 = max(u_dropErupt, 0.0);',
  '  {',
  // Shell mask: a thin annulus at the corona rim.
  '    float shellR = surf + 0.03 + 0.04 * coronaField;',
  '    float shellM = exp(-pow((r - shellR) * (18.0 - 6.0 * staticDensity), 2.0));',
  // Branching micro-arcs: cellular jitter on angle*radius; density gates cells.
  '    float cellDens = 40.0 + 120.0 * staticDensity;',
  '    vec2 ap = vec2(crownAng * cellDens, (r - surf) * 90.0 + t * 6.0);',
  '    vec2 ci = floor(ap);',
  '    float cellRand = hash(ci + fract(u_seed * 0.41) * 13.0);',
  '    float on = step(0.85 - 0.7 * staticDensity, cellRand);',
  // Thin arc segment inside the lit cell: a jittered diagonal filament.
  '    vec2 cf = fract(ap) - 0.5;',
  '    float segAng = hash(ci + 3.3) * 3.14159;',
  '    vec2 sd = vec2(cos(segAng), sin(segAng));',
  '    float across = abs(dot(cf, vec2(-sd.y, sd.x)));',
  '    float arc = exp(-across * across * 120.0) * on;',
  // Crackle flicker: fast temporal jitter per cell so it reads as static.
  '    float flick = step(0.4, hash(ci + floor(t * 22.0)));',
  '    float crackle = arc * shellM * flick;',
  '    vec3 staticCol = mix(vec3(0.85, 0.95, 1.0), hue2rgb(fract(u_fieldHue + 0.2)), 0.4);',
  '    fresh += staticCol * crackle * (0.4 + 1.4 * u_high + 1.0 * storm2) * (0.5 + 0.5 * staticDensity);',
  '  }',
  '',
  '  vec3 coal = stellarBody(0.6);',
  '  fresh += mix(coal, vec3(1.0, 0.85, 0.75), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);',
  '  fresh += mix(coal, LOW, 0.4) * coronaBody * (0.1 + 0.6 * u_low + 0.35 * u_kick);',
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);',
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));',
  '  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);',
  '',
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));',
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);',
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));',
  '  float cloud = pow(cloudField, 2.4);',
  '  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4);',
  '  float reverb = 1.0 + 2.6 * rippleWave;',
  '  float midGate = smoothstep(0.04, 0.3, u_mid);',
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;',
  '  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;',
  '',
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));',
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);',
  '  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);',
  '  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)',
  '    * (0.08 + 1.7 * u_high) * u_dust * reverb;',
  '  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);',
  '',
  '  if (u_spawn > 0.01) {',
  '    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);',
  '    float puff = pow(fbm(c * 7.0 + sOff), 3.5);',
  '    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;',
  '  }',
  '',
  '  if (u_kick > 0.02) {',
  '    float ringR = 0.1 + 0.05 * u_kick;',
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))',
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));',
  '    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);',
  '    sky *= 1.0 + 0.1 * u_kick;',
  '  }',
  '  if (u_snare > 0.03) {',
  '    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);',
  '    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;',
  '  }',
  '  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {',
  '    float reach = smoothstep(0.05, 0.18, r);',
  '    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach',
  '      * mix(vec3(1.0), palette(0.15), 0.45);',
  '  }',
  '',
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);',
  '',
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);',
  '  sky = mix(sky, sky * min(vec3(0.99), 0.4 + grade * 1.5), 0.24);',
  '  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;',
  '  float m = max(sky.r, max(sky.g, sky.b));',
  '  if (m > 0.8) {',
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);',
  '}',
].join('\n');

export const g12SolarStormsPreset: VisualizerPreset = {
  id: 'g12-solar-storms',
  name: 'g12 solar-storms',
  hiRes: true,
  params: [
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 3 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1.4 },
    { id: 'aurora', label: 'polar aurora gain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'corona', label: 'corona static gain', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let flareAge = 999;
    let flareAmp = 0;
    let flareLong = 0;
    let flareHue = 0.06;
    let prevBarIndex: number | null = null;
    let polarityTarget = 1;
    let polarity = 1;
    let prevBeatInBar: number | null = null;
    let crownRot = 0;
    let crownRotTarget = 0;
    let smoothFieldHue = 0;
    let smoothTension = 0;
    let smoothShimmer = 0;
    let dropErupt = 0;
    let freeBeatPhase = 0;
    let smoothBodyHue = 0.5;
    let smoothCoronaBreadth = 0;
    let smoothFieldSat = 0.5;
    // g12 storm state.
    let smoothAuroraMid = 0; // motion-grade: aurora extent/dance (bandsSlow.mid)
    let auroraDance = 0;     // aurora dance phase (slow)
    let eqMid = 0.5;
    let eqHigh = 0.5;
    let smoothCoronaStatic = 0; // corona-static density (highs)

    const LOWMID_BANDS = Math.max(1, Math.round(SPECTRUM_BAND_COUNT * 0.5));
    const loudestLowMidHue = (spectrum: number[]): number => {
      let bestIdx = 0;
      let bestVal = -1;
      const n = Math.min(LOWMID_BANDS, spectrum.length);
      for (let i = 0; i < n; i++) {
        const v = spectrum[i] ?? 0;
        if (v > bestVal) {
          bestVal = v;
          bestIdx = i;
        }
      }
      return 0.02 + (bestIdx / Math.max(1, n - 1)) * 0.4;
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1.4;
        const auroraGain = frame.params.aurora ?? 1;
        const coronaGainParam = frame.params.corona ?? 1;
        const beat: BeatInfo | null = frame.beat;
        const slow = frame.bandsSlow ?? frame.bands;
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
        armPhase += dt * (beat?.bpm ? ((beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            const sectionBoundary = ((tierBar % 16) + 16) % 16 === 0;
            if (sectionBoundary) polarityTarget = -polarityTarget;
            const bpb = beat.beatsPerBar || 4;
            crownRotTarget += (Math.PI * 2) / bpb;
          }
          prevBarIndex = tierBar;
        }
        polarity += (polarityTarget - polarity) * (1 - Math.exp(-dt / 0.6));
        crownRot += (crownRotTarget - crownRot) * (1 - Math.exp(-dt / 0.18));

        const downbeat = beat && beat.barPhase !== null
          ? Math.pow(1 - Math.min(1, beat.barPhase * 1.5), 2)
          : 0.3;

        flareAge += dt;
        let beatCrossed = false;
        let beatInBar = 0;
        let bpb = 4;
        if (beat) {
          bpb = beat.beatsPerBar || 4;
          beatInBar = beat.beatInBar;
          if (prevBeatInBar !== null && beatInBar !== prevBeatInBar) beatCrossed = true;
          prevBeatInBar = beatInBar;
        } else {
          const bpm = 120;
          const prev = freeBeatPhase;
          freeBeatPhase += dt * (bpm / 60);
          if (Math.floor(freeBeatPhase) !== Math.floor(prev)) {
            beatCrossed = true;
            beatInBar = Math.floor(freeBeatPhase) % bpb;
          }
        }

        if (beatCrossed) {
          flareAge = 0;
          flareLong = beatInBar / bpb;
          flareHue = loudestLowMidHue(frame.spectrum);
          const kickBoost = frame.impulse.low > 0.28 ? 1.0 : 0.0;
          flareAmp = Math.min(
            1.5,
            (0.45 + 0.55 * kickBoost) *
              (0.7 + 0.5 * frame.impulse.low) *
              (0.8 + 0.6 * Math.max(drop, sustained))
          );
        }

        const hueTarget = (frame.bands.mid * 0.7 + frame.centroid * 0.3 + 0.55) % 1;
        smoothFieldHue += (hueTarget - smoothFieldHue) * (1 - Math.exp(-dt / 0.4));
        smoothTension += (buildup - smoothTension) * (1 - Math.exp(-dt / 0.3));
        smoothShimmer += (Math.min(1, frame.bands.high * 1.3) - smoothShimmer) * (1 - Math.exp(-dt / 0.2));

        smoothBodyHue += (frame.centroid - smoothBodyHue) * (1 - Math.exp(-dt / 1.0));
        const satTarget = 1 - Math.min(1, Math.max(0, frame.flatness));
        smoothFieldSat += (satTarget - smoothFieldSat) * (1 - Math.exp(-dt / 0.4));
        smoothCoronaBreadth += (Math.min(1, Math.max(0, frame.spread)) - smoothCoronaBreadth) * (1 - Math.exp(-dt / 0.5));

        // --- g12: AURORA MIDS on the SLOW band (motion-smoothness law). Extent
        // + dance rate ride bandsSlow.mid. Dance phase advances at a rate set by
        // the slow mid (no per-frame speed jerks).
        const auroraTarget = Math.min(1, slow.mid * 1.4) * auroraGain;
        smoothAuroraMid += (auroraTarget - smoothAuroraMid) * (1 - Math.exp(-dt / 0.4));
        auroraDance += dt * (0.4 + 1.6 * smoothAuroraMid) * (0.7 + 0.6 * Math.max(drop, sustained));

        // --- g12: CORONA STATIC density from HIGHS (instantaneous is fine for
        // a crackle, but smooth a touch so it doesn't strobe).
        const staticTarget = Math.min(1, frame.bands.high * 1.5) * coronaGainParam;
        smoothCoronaStatic += (staticTarget - smoothCoronaStatic) * (1 - Math.exp(-dt / 0.12));

        // --- EQ kills (dominant deck). Mid kill collapses sheets; high kill
        // smooths the corona.
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        eqMid += ((dom?.eq.mid ?? 0.5) - eqMid) * eqAlpha;
        eqHigh += ((dom?.eq.high ?? 0.5) - eqHigh) * eqAlpha;
        // 0.5 = flat -> 1.0; 0 = killed -> 0.0.
        const midKill = Math.min(1, Math.max(0, eqMid * 2));
        const highKill = Math.min(1, Math.max(0, eqHigh * 2));

        const dropTarget = Math.min(1, Math.max(0, (Math.max(drop, sustained) - 0.5) / 0.35));
        const dropAlpha = 1 - Math.exp(-dt / (dropTarget > dropErupt ? 0.25 : 0.6));
        dropErupt += (dropTarget - dropErupt) * dropAlpha;

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
          u_rotStep: (0.05 + 0.5 * slow.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay)),
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
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_flareAge: flareAge,
          u_flareAmp: flareAmp,
          u_flareLong: flareLong,
          u_downbeat: downbeat,
          u_polarity: polarity,
          u_crownRot: crownRot,
          u_fieldHue: smoothFieldHue,
          u_tension: smoothTension,
          u_shimmer: smoothShimmer,
          u_dropErupt: dropErupt,
          u_bodyHue: smoothBodyHue,
          u_flareHue: flareHue,
          u_fieldSat: smoothFieldSat,
          u_coronaBreadth: smoothCoronaBreadth,
          u_auroraMid: smoothAuroraMid,
          u_auroraDance: auroraDance,
          u_midKill: midKill,
          u_coronaStatic: smoothCoronaStatic,
          u_highKill: highKill,
        };
      },
    });
  },
};

export default g12SolarStormsPreset;
