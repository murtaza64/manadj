/**
 * g07-odyssey-embers (gen-7 combine / REMIX) — odyssey's phrase/section
 * THEATRE with prime-embers' EARNED-BRIGHTNESS medium.
 *
 * From ODYSSEY (the SKELETON): the full advected-feedback warp engine —
 * differential rotation, churn, black-hole lens, the traveling KICK RIPPLE
 * that displaces and lights; drop-aware genome (a landing drop forces
 * flight + hot palette jump + wide horizon + big flash NOW); phrase swell +
 * twist tighten + last-bar anticipation shimmer; section-boundary WARP-MODE
 * cycling (flight -> collapse -> orbit), kaleidoscope fold toggle, spin
 * flip, horizon jump, white bloom; the section omen ring; unsharp
 * chroma-preserving feedback; grain; chroma-preserving soft knee.
 *
 * From PRIME-EMBERS (the MEDIUM), grafted in place of odyssey's dust disk +
 * high nebula: a DRIFTING EMBER FIELD under the inviolable EARNED-BRIGHTNESS
 * law — the baseline is DARK; nothing glows without a cause:
 *   - the traveling KICK RIPPLE lights embers it passes (flare + cool);
 *   - SNARE gusts (mid/high gated) scatter embers laterally;
 *   - phrase swell slowly raises ember DENSITY (not brightness);
 *   - whole-field IGNITION rides max(drop, energy) on drops;
 *   - a faint bass smoulder keeps a floor of life.
 * Palette travels through ember TEMPERATURE (cool coal -> warm blaze -> hot).
 *
 * SECTION transformation reorganizes the ember DRIFT TOPOLOGY (odyssey's
 * scene-scale change, embers guise): CONVERGENT (embers fall inward) ->
 * SHEARED (a lateral wind) -> VORTICAL (embers spiral) — cycled with the
 * warp mode. Highs are the ember shimmer/scatter, NOT new dust.
 *
 * Contrast law strict: dark field, light only where earned; band identity —
 * lows = ripple/horizon/ignition, mids = churn + drift energy, highs =
 * shimmer/scatter of existing embers.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
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
  'uniform float u_drop;\n' +
  'uniform float u_buildup;\n' +
  'uniform float u_sustain;\n' +
  'uniform float u_centroid;\n' +
  'uniform float u_decay;\n' +
  'uniform float u_seed;\n' +
  'uniform float u_zoom;\n' +
  'uniform float u_rotStep;\n' +
  'uniform float u_charge;\n' +
  'uniform float u_rippleAge;\n' +
  'uniform float u_rippleAmp;\n' +
  'uniform float u_palette;\n' +      // genome palette (continuous)
  'uniform float u_fold;\n' +         // kaleidoscope segments (0 = unfolded)
  'uniform float u_horizonScale;\n' +
  'uniform float u_flash;\n' +
  'uniform float u_phrase;\n' +       // phrase phase 0..1
  'uniform float u_section;\n' +      // section phase 0..1
  'uniform float u_barWave;\n' +
  'uniform float u_beatPump;\n' +
  // --- ember-medium uniforms (from prime-embers) ---
  'uniform float u_emberDrift;\n' +   // accumulated drift phase (quickens in buildups)
  'uniform float u_emberScatter;\n' + // snare-gust scatter 0..1 (mid/high gated)
  'uniform float u_ignite;\n' +       // whole-field ignition, rides max(drop, energy)
  'uniform float u_density;\n' +      // phrase-swelled ember density
  'uniform float u_topology;\n' +     // eased drift topology (0 convergent,1 sheared,2 vortical)
  'uniform float u_stars;\n' +        // param: ember density scale
  '\n' +
  'const float PI = 3.141592653589793;\n' +
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';\n' +
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
  'vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }\n' +
  'vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }\n' +
  'vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }\n' +
  'vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }\n' +
  '\n' +
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
  '// DRIFTING EMBER FIELD (earned brightness). Two overlaid lattices; each\n' +
  '// cell owns an ember. Brightness is EARNED via `lit` (ripple/ignite/kick/\n' +
  '// bass floor). The section TOPOLOGY reshapes the drift flow: convergent\n' +
  '// (inward), sheared (lateral wind), vortical (spiral). Density gates the\n' +
  '// ember POPULATION (phrase swell), never their glow. Temperature travels.\n' +
  'vec3 emberField(vec2 c, float r, float ang, float drift, float scatter, float lit, float palTemp, float density, float topo) {\n' +
  '  vec3 acc = vec3(0.0);\n' +
  '  float conv = max(0.0, 1.0 - abs(topo));\n' +
  '  float shear = max(0.0, 1.0 - abs(topo - 1.0));\n' +
  '  float vort = max(0.0, 1.0 - abs(topo - 2.0));\n' +
  '  for (int L = 0; L < 2; L++) {\n' +
  '    float dens = L == 0 ? 9.0 : 15.0;\n' +
  '    float sizeScale = L == 0 ? 3.4 : 1.9;\n' +
  '    // Base upward + swirling drift; snare gusts add lateral jitter.\n' +
  '    vec2 flow = vec2(\n' +
  '      0.12 * sin(drift * 0.7 + float(L) * 2.3) + scatter * 0.5 * (hash(vec2(float(L), 4.1)) - 0.5),\n' +
  '      -drift * (0.18 + 0.06 * float(L))\n' +
  '    );\n' +
  '    // Topology reshaping: convergent pulls the sample toward center,\n' +
  '    // sheared adds a lateral wind, vortical rotates around center.\n' +
  '    vec2 dir = r > 1e-4 ? c / r : vec2(0.0);\n' +
  '    flow += dir * conv * (0.10 + 0.05 * float(L)) * (0.5 + drift * 0.0);\n' +
  '    flow.x += shear * (0.16 + 0.05 * sin(drift * 0.5)) * (0.5 + 0.5 * float(L));\n' +
  '    flow += vec2(-dir.y, dir.x) * vort * (0.12 + 0.05 * float(L));\n' +
  '    vec2 q = (c + flow) * dens;\n' +
  '    vec2 cell = floor(q);\n' +
  '    vec2 sc = cell + vec2(fract(u_seed * 0.5137) * 51.3 + float(L) * 7.7, fract(u_seed * 0.2917) * 37.9);\n' +
  '    vec2 pos = vec2(hash(sc + 2.1), hash(sc.yx + 6.3)) * 0.7 + 0.15;\n' +
  '    pos += (vec2(hash(sc + drift * 0.3), hash(sc.yx + drift * 0.27)) - 0.5) * scatter * 0.4;\n' +
  '    vec2 f = fract(q) - pos;\n' +
  '    // Density gates the ember POPULATION (phrase swell), not glow.\n' +
  '    float on = step(0.62 - 0.34 * clamp(density, 0.0, 1.4), hash(sc * 1.37 + 3.9));\n' +
  '    float size = (0.5 + 1.5 * hash(sc.yx * 2.31)) * sizeScale;\n' +
  '    float breathe = 0.5 + 0.5 * sin(drift * 1.3 + hash(sc + 11.0) * 6.28318);\n' +
  '    float glow = starShape(f, size) * on * (0.25 + 0.75 * breathe);\n' +
  '    float warmth = clamp(lit * (0.4 + 0.9 * hash(sc + 19.3)) + 0.15 * breathe, 0.0, 1.0);\n' +
  '    vec3 cool = vec3(0.5, 0.09, 0.03);\n' +
  '    vec3 warm = mix(vec3(1.0, 0.55, 0.16), palette(0.08 + palTemp), 0.4);\n' +
  '    vec3 hot = vec3(1.0, 0.92, 0.72);\n' +
  '    vec3 tint = mix(cool, warm, warmth);\n' +
  '    tint = mix(tint, hot, clamp(lit - 0.6, 0.0, 0.4) * 2.0);\n' +
  '    acc += tint * glow * (0.35 + 1.9 * lit);\n' +
  '  }\n' +
  '  // Weight the population toward center (where the old core lived) — NO\n' +
  '  // central glow is ever added, only the ember count is shaped.\n' +
  '  return acc * (0.55 + 0.9 * exp(-r * 2.6));\n' +
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
  '  float anticipation = smoothstep(0.7, 1.0, u_phrase);\n' +
  '\n' +
  '  // ---- Section fold on the warp coords.\n' +
  '  vec2 wc = c;\n' +
  '  if (u_fold > 0.5) {\n' +
  '    float fold = PI / u_fold;\n' +
  '    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);\n' +
  '    wc = vec2(cos(fa), sin(fa)) * r;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Warp (odyssey): rotation + churn + kick ripple + lens.\n' +
  '  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));\n' +
  '  float cs = cos(rot);\n' +
  '  float sn = sin(rot);\n' +
  '  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;\n' +
  '  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);\n' +
  '  vec2 churn = (vec2(\n' +
  '    fbm(c * 2.6 + t * 0.12),\n' +
  '    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)\n' +
  '  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);\n' +
  '  float waveFront = 0.16 + u_rippleAge * 0.9;\n' +
  '  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;\n' +
  '  vec2 ripple = dirW * rippleWave * 0.035;\n' +
  '  float barFront = 0.15 + u_barWave * 1.1;\n' +
  '  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);\n' +
  '  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)\n' +
  '    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));\n' +
  '  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);\n' +
  '  float drag = lens * 0.12;\n' +
  '  float dcs = cos(drag);\n' +
  '  float dsn = sin(drag);\n' +
  '  w = mat2(dcs, -dsn, dsn, dcs) * w;\n' +
  '  vec2 src = (w + churn + ripple + dirW * barWave * 0.02 + dirW * lens * 0.045)\n' +
  '    / vec2(aspect, 1.0) + 0.5;\n' +
  '\n' +
  '  // Aberration + unsharp chroma-preserving feedback (DARK memory floor).\n' +
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash)\n' +
  '    / vec2(aspect, 1.0);\n' +
  '  vec3 sampled = vec3(\n' +
  '    texture2D(u_prev, src + ab).r,\n' +
  '    texture2D(u_prev, src).g,\n' +
  '    texture2D(u_prev, src - ab).b\n' +
  '  );\n' +
  '  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb\n' +
  '    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb\n' +
  '    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;\n' +
  '  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;\n' +
  '\n' +
  '  // ================= EMBER MEDIUM (earned brightness) ====================\n' +
  '  vec3 fresh = vec3(0.0);\n' +
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)\n' +
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);\n' +
  '  // Bass gravity waves (a cause — sustained lows keep the center alive).\n' +
  '  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))\n' +
  '    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)\n' +
  '    + volt * (0.14 * u_low + 0.32 * u_kick);\n' +
  '  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));\n' +
  '  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;\n' +
  '  fresh += mix(vec3(0.55, 0.07, 0.04), LOW, 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)\n' +
  '    * u_low * (0.5 + 0.8 * u_kick);\n' +
  '  // Charged horizon ring (odyssey bass element; brightens through phrase).\n' +
  '  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);\n' +
  '  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));\n' +
  '  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));\n' +
  '  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));\n' +
  '  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);\n' +
  '  float ringGain = 1.0 + 0.5 * anticipation;\n' +
  '  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;\n' +
  '  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore\n' +
  '    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;\n' +
  '  // Anamorphic lens streak (earned by lows/kick).\n' +
  '  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));\n' +
  '  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak\n' +
  '    * (0.25 + 1.2 * u_low + 0.8 * u_kick);\n' +
  '  // ===== DRIFTING EMBER FIELD: nothing glows without a cause. =====\n' +
  '  float emberLit = clamp(\n' +
  '    0.10 + 2.4 * rippleWave + 1.1 * u_ignite + 0.5 * u_kick + 0.3 * smoothstep(0.06, 0.3, u_low)\n' +
  '      + 1.6 * barWave,\n' +
  '    0.0, 1.0\n' +
  '  );\n' +
  '  float palTemp = 0.35 * clamp(u_palette, 0.0, 3.0) / 3.0 + u_centroid * 0.15 + t * 0.01;\n' +
  '  fresh += emberField(c, r, ang, u_emberDrift, u_emberScatter, emberLit, palTemp, u_density * u_stars, u_topology)\n' +
  '    * (0.6 + 1.3 * u_ignite);\n' +
  '\n' +
  '  // ---- Section omen ring closing in over the last bars.\n' +
  '  float omen = smoothstep(0.8, 1.0, u_section);\n' +
  '  if (omen > 0.001) {\n' +
  '    float omenR = 1.15 - 0.75 * omen;\n' +
  '    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;\n' +
  '  }\n' +
  '\n' +
  '  // Anticipation shimmer.\n' +
  '  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);\n' +
  '  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);\n' +
  '\n' +
  '  // ---- Kick shock stamp.\n' +
  '  if (u_kick > 0.02) {\n' +
  '    float ringR = 0.1 + 0.05 * u_kick;\n' +
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))\n' +
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));\n' +
  '    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);\n' +
  '    sky *= 1.0 + 0.1 * u_kick;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Mutation flash (rate-limited on JS side), grain, grade, dynamics,\n' +
  '  // chroma-preserving soft knee. Buildups dim (tension), drops bloom.\n' +
  '  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));\n' +
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);\n' +
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);\n' +
  '  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);\n' +
  '  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.06 * u_buildup) * (1.0 + 0.06 * u_beatPump);\n' +
  '  float m = max(sky.r, max(sky.g, sky.b));\n' +
  '  if (m > 0.8) {\n' +
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;\n' +
  '  }\n' +
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);\n' +
  '}\n';

const FOLD_CYCLE = [0, 6, 8];
const TOPOLOGY_COUNT = 3; // convergent -> sheared -> vortical drift

const candidate: VisualizerPreset = {
  id: 'g07-odyssey-embers',
  name: 'g07 odyssey-embers',
  hiRes: true,
  params: [
    { id: 'stars', label: 'ember density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'chaos', label: 'mutation chaos', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    // ---- Odyssey genome state.
    let paletteTarget = Math.floor(Math.random() * 4);
    let paletteCurrent = paletteTarget;
    let foldIndex = 0;
    let modeTarget = 0;
    let modeCurrent = 0;
    let topologyTarget = 0;
    let topologyCurrent = 0;
    let spinDirection = 1;
    let horizonTarget = 1;
    let horizonCurrent = 1;
    let flash = 0;
    let flashBudget = 0;
    let barWaveAge = 99;
    let prevBarIndex: number | null = null;
    let charge = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSustain = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let breakdownS = 0;
    let lastTime = 0;
    // ---- Ember-medium state (prime-embers).
    let emberDrift = 0;
    let emberScatter = 0;
    let density = 0; // phrase-swelled population, eased

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const bands: BandLevels = frame.bands;
        const impulse: BandLevels = frame.impulse;
        const trend: EnergyTrend = frame.trend;
        const beat: BeatInfo | null = frame.beat;

        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(bands);
        const chaos = frame.params.chaos ?? 1;
        const speed = frame.params.speed ?? 1;

        // Drop/buildup split — bass-weighted, smoothed ~0.35 s.
        const lowPresence = Math.min(1, Math.max(0, (bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustainTarget = Math.min(1, energy * 1.4);
        smoothSustain += (sustainTarget - smoothSustain) * alpha;
        const lift = Math.max(smoothDrop, 0.7 * smoothSustain);

        // Photosensitivity rate limiter: at most ~3 flash triggers/sec.
        flashBudget = Math.min(3, flashBudget + dt * 3);
        const tryFlash = (amount: number) => {
          if (flashBudget >= 1) {
            flashBudget -= 1;
            flash = Math.max(flash, Math.min(1.2, amount));
          }
        };

        // DROP-AWARE genome: force the energetic scene NOW.
        let dropLanded = false;
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 8) {
          lastDropAt = frame.time;
          dropLanded = true;
          modeTarget = 0;
          foldIndex = 0;
          paletteTarget = (paletteTarget + 2) % 4;
          horizonTarget = 1.2;
          tryFlash(1.0 * chaos);
        }
        prevDrop = smoothDrop;
        if (energy < 0.15) breakdownS += dt;
        else breakdownS = 0;
        if (breakdownS > 2.5 && modeTarget !== 2) {
          modeTarget = 2;
          foldIndex = 0;
          tryFlash(0.25 * chaos);
        }

        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;

        // Phrase progress (continuous) for the density swell.
        const phraseNow =
          beat && tierBar !== null ? ((((tierBar % 4) + 4) % 4) + beat.barPhase) / 4 : 0;

        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            barWaveAge = 0;
            const phraseBoundary = ((tierBar % 4) + 4) % 4 === 0;
            const sectionBoundary = ((tierBar % 16) + 16) % 16 === 0;
            if (phraseBoundary) {
              paletteTarget = (paletteTarget + 1) % 4;
              tryFlash(0.6 * chaos);
            }
            if (sectionBoundary) {
              // SECTION: ember field REORGANIZES its drift topology + warp
              // mode + fold + spin + horizon (odyssey scene transform).
              topologyTarget = (topologyTarget + 1) % TOPOLOGY_COUNT;
              if (lift > 0.5) {
                modeTarget = 0;
                foldIndex = 1 + Math.floor(Math.random() * 2);
              } else {
                modeTarget = (modeTarget + 1) % 3;
                foldIndex = (foldIndex + 1) % FOLD_CYCLE.length;
              }
              spinDirection *= -1;
              horizonTarget = 1 + (Math.random() - 0.35) * 0.6 * chaos;
              tryFlash(1.0 * chaos);
            }
          }
          prevBarIndex = tierBar;
        } else {
          prevBarIndex = null;
        }

        // Ease the genome; run bass systems.
        const easeSlow = 1 - Math.exp(-dt / 0.9);
        const easeFast = 1 - Math.exp(-dt / 0.4);
        paletteCurrent += (paletteTarget - paletteCurrent) * easeSlow;
        modeCurrent += (modeTarget - modeCurrent) * easeSlow;
        topologyCurrent += (topologyTarget - topologyCurrent) * easeSlow;
        horizonCurrent += (horizonTarget - horizonCurrent) * easeFast;
        flash = Math.max(0, flash - dt * 1.4);
        barWaveAge += dt;
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + impulse.low * 0.28);
        rippleAge += dt;
        if (impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, impulse.low * 1.2);
        }

        // ---- Ember medium: drift QUICKENS + warms in buildups (never still),
        // a touch faster on sustained energy; snare gusts scatter (fast decay).
        const driftRate = 0.5 + 1.6 * smoothBuildup + 0.5 * smoothSustain;
        emberDrift += dt * driftRate;
        const midHighGate = Math.min(1, Math.max(0, (bands.mid + bands.high) * 0.6 - 0.1));
        const gust = Math.min(1, impulse.mid * (0.5 + 0.9 * midHighGate));
        emberScatter = Math.max(emberScatter * Math.exp(-dt / 0.25), gust);
        // Phrase swell raises ember DENSITY (population), not brightness.
        const densityTarget = 0.35 + 0.65 * phraseNow + 0.25 * smoothSustain;
        density += (densityTarget - density) * (1 - Math.exp(-dt / 0.5));
        // Whole-field ignition rides max(drop, energy); a landing drop pins
        // it to full so the field-wide ignition is unmistakable.
        const ignite = dropLanded ? 1 : Math.min(1, Math.max(smoothDrop, energy));

        // Warp-mode blend.
        const w0 = Math.max(0, 1 - Math.abs(modeCurrent));
        const w1 = Math.max(0, 1 - Math.abs(modeCurrent - 1));
        const w2 = Math.max(0, 1 - Math.abs(modeCurrent - 2));
        const zoomFlight =
          1 +
          (0.08 + 0.7 * lift + 3.6 * impulse.low * (0.5 + 0.5 * lift)) *
            (0.85 + 0.3 * phraseNow) *
            speed *
            dt;
        const zoomCollapse =
          1 - (0.04 + 0.25 * energy) * speed * dt + 2.2 * impulse.low * speed * dt * 0.5;
        const zoomOrbit = 1 + 0.5 * impulse.low * speed * dt;
        const rotBase = (0.05 + 0.5 * bands.mid + 0.25 * smoothSustain) * speed * dt;

        const section = beat && tierBar !== null
          ? ((((tierBar % 16) + 16) % 16) + beat.barPhase) / 16 : 0;

        return {
          u_time: frame.time,
          u_low: bands.low,
          u_mid: bands.mid,
          u_high: bands.high,
          u_kick: impulse.low,
          u_snare: impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: smoothSustain,
          u_centroid: frame.centroid,
          u_decay: Math.min(0.998, 0.992 - 0.008 * energy - 0.008 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          u_zoom: w0 * zoomFlight + w1 * zoomCollapse + w2 * zoomOrbit,
          u_rotStep: spinDirection * rotBase * (1 + 2.2 * w2),
          u_charge: charge,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_palette: paletteCurrent,
          u_fold: FOLD_CYCLE[foldIndex],
          u_horizonScale: horizonCurrent,
          u_flash: flash,
          u_phrase: phraseNow,
          u_section: section,
          u_barWave: barWaveAge,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_emberDrift: emberDrift,
          u_emberScatter: Math.min(1, Math.max(0, emberScatter)),
          u_ignite: ignite,
          u_density: density,
          u_topology: topologyCurrent,
          u_stars: frame.params.stars ?? 1,
        };
      },
    });
  },
};

export default candidate;
