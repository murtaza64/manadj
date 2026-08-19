/**
 * g08-solar-beat (gen-8 TWEAK of g03-solar-crown — beat-grid eruptions).
 *
 * Copied wholesale from solar-crown: the whole voyage-derived engine baked
 * HOT (solar palette, dense stars), the sun with erupting magnetic
 * prominences, the mid-streaming corona, chroma-preserving soft knee. What
 * changes is the BEAT GRAMMAR and the mid/high responses:
 *
 *   PROMINENCES ERUPT ON THE BEAT GRID. In the parent, kicks launched a
 *   flare from a seed-scattered longitude. Here EACH BEAT launches ONE
 *   prominence from a GRID-ADVANCING longitude — the eruption site steps
 *   around the crown one beat at a time (a full lap per bar), so the
 *   schedule is LEGIBLE: you can watch the eruptions march around the sun.
 *   KICK = that beat's prominence goes MASSIVE (a solid over-arc, parent
 *   ember language, whiter apex).
 *
 *   ALT MID RESPONSE: mids COLOR THE MAGNETIC FIELD LINES. Visible curved
 *   field lines arc from pole to pole across the corona; their HUE tracks
 *   mid content (the "mids = colors" ask), and BUILDUP TIGHTENS them
 *   inward (visible magnetic tension — lines pull toward the surface).
 *
 *   ALT HIGH RESPONSE: highs = CORONA SHIMMER GRANULARITY. The corona's
 *   licking streamers get finer and busier with high content — a shimmer,
 *   NOT powder/particles (dust-fatigue rule).
 *
 *   BAR = the crown's ROTATION SNAPS ONE NOTCH (the eruption longitude
 *   frame advances a quantized step per bar — a legible tick).
 *
 *   DROP = ALL LONGITUDES ERUPT AT ONCE + the field lines IGNITE, riding
 *   max(drop, energy).
 *
 * Contract-safe: default-export VisualizerPreset, GL feedback via
 * createGlRenderer, GLSL ES 1.0, no backticks in the shader, chroma-
 * preserving soft knee. Photosensitivity floor: eruption/ignition envelopes
 * are rate-limited; localized pulses exempt.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
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
  // --- solar-prominence meter uniforms ---
  'uniform float u_flareAge;',    // seconds since the last (beat) prominence
  'uniform float u_flareAmp;',    // that prominence strength (kick = massive)
  'uniform float u_flareLong;',   // grid-advancing longitude (0..1 around crown)
  'uniform float u_downbeat;',    // 1 near a bar downbeat, decays across the bar
  'uniform float u_polarity;',    // +1 / -1, flips at section boundaries (smoothed)
  // --- g08 beat-grammar uniforms ---
  'uniform float u_crownRot;',    // crown rotation frame (SNAPS one notch per bar)
  'uniform float u_fieldHue;',    // magnetic field-line hue (tracks MIDS)
  'uniform float u_tension;',     // buildup -> field lines tighten inward
  'uniform float u_shimmer;',     // corona shimmer granularity (tracks HIGHS)
  'uniform float u_dropErupt;',   // 0..1 all-longitudes eruption (drop), rate-limited
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
  // Hue helper for the magnetic field lines (mids drive u_fieldHue).
  'vec3 hue2rgb(float h) {',
  '  vec3 k = mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);',
  '  return clamp(min(k, 4.0 - k), 0.0, 1.0);',
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
  '  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);',
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
  // ---- Warp (voyage engine, unchanged).
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
  // Chromatic aberration + unsharp feedback (voyage engine, unchanged).
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
  // ---- Steady layers.
  '  vec3 fresh = vec3(0.0);',
  // The angle measured in the CROWN'S ROTATING FRAME — this frame snaps one
  // notch per bar (u_crownRot) so eruption longitudes tick around legibly.
  '  float crownAng = ang - u_crownRot;',
  '  float volt = (noise(vec2(crownAng * 14.0 + t * 3.0, t * 22.0)) - 0.5)',
  '    + 0.5 * (noise(vec2(crownAng * 30.0 - t * 5.0, t * 37.0)) - 0.5);',
  '  float surf = horizon + volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);',
  '',
  // Core / heart / corona (voyage engine, bass-solid — kept).
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))',
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)',
  '    + volt * (0.14 * u_low + 0.32 * u_kick);',
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));',
  '  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));',
  '  float coronaBody = exp(-rc * (7.0 - 3.0 * u_low));',
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;',
  '  float gravityGain = u_low * (0.5 + 0.8 * u_kick);',
  '  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);',
  '  fresh += gravityColor',
  '    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;',
  '',
  // ===== MAGNETIC FIELD LINES (alt-mid: hue tracks mids; buildup tightens) =====
  // Curved arcs bowing from the surface across the corona. Their apex height
  // shrinks as u_tension (buildup) rises = lines pull inward (magnetic
  // tension). u_dropErupt IGNITES them (bright, saturated) on the drop.
  '  float fieldMass = 0.0;',
  '  for (int i = 0; i < 6; i++) {',
  '    float fi = float(i);',
  '    float lbase = (fi / 6.0) * 6.28318530 + u_crownRot * 0.5',
  '      + u_polarity * 0.2;',                                   // polarity lean
  '    float ld = crownAng - lbase;',
  '    ld = mod(ld + 3.14159265, 6.28318530) - 3.14159265;',
  '    float lspan = 0.9;',
  '    float ls = ld / lspan;',
  '    if (abs(ls) <= 1.0) {',
  '      float lobe = pow(cos(ls * 1.5708), 1.3);',
  // Tension pulls the apex inward on buildups; drop pushes it back out.
  '      float apexH = (0.14 + 0.08 * u_mid) * (1.0 - 0.55 * u_tension)',
  '        * (1.0 + 0.5 * u_dropErupt);',
  '      float lineR = surf + apexH * lobe;',
  '      float dr = (r - lineR);',
  '      float line = exp(-dr * dr * 700.0) * smoothstep(1.0, 0.2, abs(ls));',
  '      fieldMass += line;',
  '    }',
  '  }',
  // Field-line color: hue driven by mids; ignite (whiten+brighten) on drop.
  '  vec3 fieldCol = hue2rgb(fract(u_fieldHue));',
  '  fieldCol = mix(fieldCol, vec3(1.0, 0.95, 0.85), 0.6 * u_dropErupt);',
  '  float fieldGain = (0.25 + 1.6 * u_mid + 1.4 * u_dropErupt) * (0.5 + 0.5 * u_sustain);',
  '  fresh += fieldCol * fieldMass * fieldGain;',
  '',
  // ===== SOLAR PROMINENCES (beat-grid eruptions) =====
  // A live eruption from a GRID-ADVANCING longitude (u_flareLong steps around
  // the crown per beat). Kick = MASSIVE. Drop = ALL longitudes erupt.
  '  float life = clamp(u_flareAge / 1.0, 0.0, 1.0);',
  '  float riseFall = pow(sin(life * 3.14159265), 0.7);',
  '  float flareEnergy = u_flareAmp * exp(-u_flareAge * 1.6);',
  '  float apexH = (0.10 + 0.30 * u_flareAmp) * riseFall;',
  '  float promo = 0.0;',
  '  float promoHot = 0.0;',
  // Beat prominence: one foot at the grid longitude. Plus (drop) all-longitude.
  '  for (int i = 0; i < 6; i++) {',
  '    float fi = float(i);',
  // The single scheduled foot is i==0 at the grid longitude; the rest only
  // erupt when u_dropErupt lifts them (all longitudes fire on the drop).
  '    float longi = i == 0',
  '      ? u_flareLong * 6.28318530',
  '      : (fi / 6.0) * 6.28318530 + u_crownRot * 0.5;',
  '    float base = crownAng - (longi - u_crownRot)',              // fold into crown frame consistently
  '      + u_polarity * (0.25 + 0.2 * life);',
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
  // Prominence color: ember at the feet, white-hot at the apex; kick pushes
  // it whiter and MASSIVE (handled by u_flareAmp scaling on kick).
  '  vec3 promColor = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.72, 0.3), clamp(apexH * 2.5, 0.0, 1.0));',
  '  promColor = mix(promColor, vec3(1.0, 0.95, 0.85), clamp(u_downbeat * riseFall + 0.6 * u_kick, 0.0, 1.0));',
  '  fresh += promColor * promo * (0.6 + 1.4 * u_kick + 0.8 * u_charge);',
  '  fresh += vec3(1.0, 0.9, 0.75) * promoHot * (0.5 + 1.0 * u_downbeat);',
  '',
  // Mid-streaming corona: soft radial licks rising from the rim. GRANULARITY
  // (streamer count) tracks HIGHS (u_shimmer) — a shimmer, not powder.
  '  float shimmerFreq = 16.0 + 34.0 * u_shimmer;',            // highs -> finer streamers
  '  float coronaField = fbm(vec2(crownAng * 5.0 + u_polarity * t * 0.4, (r - surf) * 9.0 - t * 0.6));',
  '  float streamers = 0.5 + 0.5 * sin(crownAng * shimmerFreq + u_polarity * t * 1.3 + coronaField * 6.0);',
  '  float coronaBand = exp(-pow((r - surf) * 7.0, 2.0)) + exp(-pow((r - surf * 1.8) * 3.5, 2.0)) * 0.5;',
  '  float coronaGain = (0.12 + 1.0 * u_mid + 0.9 * u_high + 0.4 * u_sustain) * (0.4 + 0.6 * coronaField);',
  '  vec3 coronaColor = mix(vec3(1.0, 0.5, 0.15), palette(0.55 + t * 0.02), 0.4);',
  '  fresh += coronaColor * coronaBand * pow(streamers, 2.0) * coronaGain;',
  '',
  // Coal heart + corona body (voyage, kept — bass solid).
  '  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;',
  '  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);',
  '  fresh += mix(coal, LOW, 0.4) * coronaBody * (0.1 + 0.6 * u_low + 0.35 * u_kick);',
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);',
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));',
  '  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);',
  '',
  // Spiral dust disk (voyage engine, unchanged).
  '  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));',
  '  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);',
  '  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));',
  '  float cloud = pow(cloudField, 2.4);',
  '  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);',
  '  float reverb = 1.0 + 2.6 * rippleWave;',
  '  float midGate = smoothstep(0.04, 0.3, u_mid);',
  '  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;',
  '  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;',
  '',
  // High nebula: distinct dust hue (+0.35 phase from the mid dust).
  '  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));',
  '  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);',
  '  vec3 electric = palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);',
  '  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)',
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
  '    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach',
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

export const g08SolarBeatPreset: VisualizerPreset = {
  id: 'g08-solar-beat',
  name: 'g08 solar-beat',
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
    // Solar-prominence eruption state.
    let flareAge = 999;
    let flareAmp = 0;
    let flareLong = 0; // grid-advancing longitude 0..1 around the crown
    // Meter state: polarity flips at section boundaries (16-bar), smoothed.
    let prevBarIndex: number | null = null;
    let polarityTarget = 1;
    let polarity = 1;
    // g08 beat-grammar state.
    let prevBeatInBar: number | null = null; // detect beat crossings
    let crownRot = 0;        // crown rotation frame — SNAPS one notch per bar
    let crownRotTarget = 0;  // eased toward the notch (visible tick, then settle)
    let smoothFieldHue = 0;  // magnetic field-line hue (tracks smoothed mids)
    let smoothTension = 0;   // buildup -> field lines tighten inward
    let smoothShimmer = 0;   // highs -> corona shimmer granularity
    let dropErupt = 0;       // rate-limited all-longitude eruption env
    let freeBeatPhase = 0;   // free-running beat clock without a grid
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase.
    let slowCentroid = 0.5;
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

        // ---- Meter: section polarity flip (every 16 bars = one section).
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            const sectionBoundary = ((tierBar % 16) + 16) % 16 === 0;
            if (sectionBoundary) polarityTarget = -polarityTarget;
            // BAR: the crown's rotation SNAPS one notch (quantized step).
            // beatsPerBar notches per lap so the tick is legible.
            const bpb = beat.beatsPerBar || 4;
            crownRotTarget += (Math.PI * 2) / bpb;
          }
          prevBarIndex = tierBar;
        }
        polarity += (polarityTarget - polarity) * (1 - Math.exp(-dt / 0.6));
        // Ease the crown toward its notch (~0.18 s): a visible SNAP, not a
        // continuous spin, then it settles until the next bar.
        crownRot += (crownRotTarget - crownRot) * (1 - Math.exp(-dt / 0.18));

        // Downbeat weight.
        const downbeat = beat && beat.barPhase !== null
          ? Math.pow(1 - Math.min(1, beat.barPhase * 1.5), 2)
          : 0.3;

        // ---- BEAT-GRID PROMINENCE ERUPTION ----
        // Each BEAT launches one prominence from a grid-advancing longitude.
        // Detect a beat crossing via beatInBar (integer beat within the bar).
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
          // Free clock: synthesize beats at 120 bpm without a grid.
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
          // Grid-advancing longitude: the eruption site steps one beat's worth
          // around the crown (a full lap per bar). Quantized, never interpolated.
          flareLong = beatInBar / bpb;
          // KICK = MASSIVE prominence (solid over-arc); else a normal beat pop.
          const kickBoost = frame.impulse.low > 0.28 ? 1.0 : 0.0;
          flareAmp = Math.min(
            1.5,
            (0.45 + 0.55 * kickBoost) *
              (0.7 + 0.5 * frame.impulse.low) *
              (0.8 + 0.6 * Math.max(drop, sustained))
          );
        }

        // ALT MID: field-line hue tracks mids (mids = colors). Wide travel.
        const hueTarget = (frame.bands.mid * 0.7 + frame.centroid * 0.3 + 0.55) % 1;
        smoothFieldHue += (hueTarget - smoothFieldHue) * (1 - Math.exp(-dt / 0.4));
        // Buildup tightens field lines inward (magnetic tension).
        smoothTension += (buildup - smoothTension) * (1 - Math.exp(-dt / 0.3));
        // ALT HIGH: corona shimmer granularity tracks highs.
        smoothShimmer += (Math.min(1, frame.bands.high * 1.3) - smoothShimmer) * (1 - Math.exp(-dt / 0.2));

        // DROP: all longitudes erupt + field lines ignite. Rate-limited env
        // (rise ~0.25 s, fall ~0.6 s) so it's a swell, not a strobe — WCAG.
        const dropTarget = Math.min(1, Math.max(0, (Math.max(drop, sustained) - 0.5) / 0.35));
        const dropAlpha = 1 - Math.exp(-dt / (dropTarget > dropErupt ? 0.25 : 0.6));
        dropErupt += (dropTarget - dropErupt) * dropAlpha;

        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
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
              (frame.params.stars ?? 1.4) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1.4) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // Solar-prominence uniforms.
          u_flareAge: flareAge,
          u_flareAmp: flareAmp,
          u_flareLong: flareLong,
          u_downbeat: downbeat,
          u_polarity: polarity,
          // g08 beat-grammar uniforms.
          u_crownRot: crownRot,
          u_fieldHue: smoothFieldHue,
          u_tension: smoothTension,
          u_shimmer: smoothShimmer,
          u_dropErupt: dropErupt,
        };
      },
    });
  },
};

export default g08SolarBeatPreset;
