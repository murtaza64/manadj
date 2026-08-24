/**
 * g07-odyssey-nursery (gen-7 combine / REMIX) — odyssey's phrase/section
 * THEATRE driving nursery's gas MEDIUM.
 *
 * From ODYSSEY (the SKELETON): the full advected-feedback warp engine —
 * differential rotation, churn field, black-hole lens, the traveling KICK
 * RIPPLE that displaces AND lights everything it crosses; the drop-aware
 * genome (a landing drop forces flight mode + a hot palette jump + a big
 * flash NOW, not on a bar line); phrase swell + spiral-twist tightening +
 * last-bar anticipation shimmer; section-boundary WARP-MODE cycling
 * (flight -> collapse-infall -> orbit) with a kaleidoscope fold toggle and
 * spin flip; the section omen ring closing in from the edge; unsharp
 * chroma-preserving feedback; mutation flash; film grain; chroma-preserving
 * soft knee.
 *
 * From NURSERY (the MEDIUM / FLESH), reimagined inside odyssey's warped
 * space rather than marched off-axis: the disk-dust vocabulary is replaced
 * by an EMISSION NEBULA — FBM gas SHELLS + vertical PILLARS (band identity:
 * mids are the gas), PROTOSTAR CORES that ignite (band identity: lows are
 * the cores), and — for the highs, NO DUST — iridescent RIM SHIMMER on gas
 * edges + nimitz-style magnetic FILAMENTS. The kick ripple IS the cores'
 * illumination front (odyssey's ripple in nursery's guise). Section = a
 * SUPERNOVA: chromatic palette regime crossfade + a new PILLAR TOPOLOGY
 * (stretch/shear/twist) — the odyssey-scale transformation staged in gas.
 *
 * Contrast law: dark-sky floor; cores blaze, gas mid, sky black. Band
 * identity by SHAPE: cores (low), gas shells/pillars (mid), shimmer +
 * filaments (high). Phrase contracts + enriches the nebula; buildup
 * compresses + tautens filaments; drop = multi-core ignition + gas churn
 * at maximum on max(drop, energy).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// fringe fix: deterministic per-track hue anchor (dust-v3 idiom). splitmix64
// style bit mix folded to [0,1) so track ids land on distinct hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};


const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

const CORE_COUNT = 5;

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
  'uniform float u_spread;\n' +
  'uniform float u_decay;\n' +
  'uniform float u_seed;\n' +
  'uniform float u_zoom;\n' +
  'uniform float u_rotStep;\n' +      // signed (genome spin)
  'uniform float u_charge;\n' +       // bass-ring charge
  'uniform float u_rippleAge;\n' +
  'uniform float u_rippleAmp;\n' +
  'uniform float u_regime;\n' +       // genome palette regime (continuous)
  'uniform float u_regimeMix;\n' +    // 0..1 supernova crossfade
  'uniform float u_topology;\n' +     // eased pillar-topology index (section)
  'uniform float u_fold;\n' +         // kaleidoscope segments (0 = unfolded)
  'uniform float u_horizonScale;\n' +
  'uniform float u_flash;\n' +        // mutation flash
  'uniform float u_phrase;\n' +       // phrase phase 0..1
  'uniform float u_section;\n' +      // section phase 0..1
  'uniform float u_barWave;\n' +      // bar-boundary wave age
  'uniform float u_beatPump;\n' +
  'uniform float u_nova;\n' +         // supernova shell strength (decays)
  'uniform float u_novaAge;\n' +      // seconds since detonation (front radius)
  'uniform vec2 u_novaPos;\n' +       // detonation center (aspect-space)
  'uniform float u_density;\n' +      // param: gas density
  'uniform float u_filaments;\n' +    // param: filament gain
  'uniform float u_glow;\n' +         // param: emission memory bias
  // Live protostar cores: xy = position (aspect-space), z = ignition 0..1.
  'uniform vec3 u_cores[' + CORE_COUNT + '];\n' +
  // Per-core illumination front: x frontAge, y frontAmp, z hue.
  'uniform vec3 u_coreFront[' + CORE_COUNT + '];\n' +
  '\n' +
  'const float PI = 3.141592653589793;\n' +
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';\n' +
  '\n' +
  'float hash(vec2 p) {\n' +
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n' +
  '}\n' +
  '\n' +
  '// value noise with per-axis seed mixing (no diagonal moire).\n' +
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
  '// iq FBM: 5 octaves, gas volume density.\n' +
  'float fbm(vec2 p) {\n' +
  '  float v = 0.0;\n' +
  '  float amp = 0.5;\n' +
  '  for (int i = 0; i < 5; i++) {\n' +
  '    v += amp * noise(p);\n' +
  '    p = p * 2.02 + vec2(19.1, 7.3);\n' +
  '    amp *= 0.5;\n' +
  '  }\n' +
  '  return v;\n' +
  '}\n' +
  '\n' +
  '// nimitz triangle noise (filament ridges).\n' +
  'float tri(float x) { return abs(fract(x) - 0.5); }\n' +
  '\n' +
  '// Saturated palette regime family; supernova crossfades between them.\n' +
  '// Each is an iq cosine palette with a wide phase span so gas TRAVELS in\n' +
  '// color (else it reads monochrome, per taste calibration).\n' +
  'vec3 palRegime(float t, float r) {\n' +
  '  float k = mod(r, 4.0);\n' +
  '  vec3 a, b, cc, d;\n' +
  '  if (k < 1.0) {          // emerald / cyan emission\n' +
  '    a = vec3(0.10, 0.30, 0.30); b = vec3(0.35, 0.50, 0.45);\n' +
  '    cc = vec3(0.90, 1.00, 0.85); d = vec3(0.10, 0.30, 0.55);\n' +
  '  } else if (k < 2.0) {   // magenta / violet H-alpha\n' +
  '    a = vec3(0.38, 0.10, 0.40); b = vec3(0.48, 0.22, 0.44);\n' +
  '    cc = vec3(1.00, 0.85, 0.70); d = vec3(0.00, 0.25, 0.55);\n' +
  '  } else if (k < 3.0) {   // gold / amber sulfur\n' +
  '    a = vec3(0.45, 0.30, 0.12); b = vec3(0.50, 0.42, 0.28);\n' +
  '    cc = vec3(1.00, 0.92, 0.60); d = vec3(0.05, 0.18, 0.40);\n' +
  '  } else {                // sapphire / teal oxygen\n' +
  '    a = vec3(0.12, 0.22, 0.45); b = vec3(0.26, 0.40, 0.50);\n' +
  '    cc = vec3(0.80, 1.00, 0.95); d = vec3(0.15, 0.35, 0.60);\n' +
  '  }\n' +
  '  vec3 col = a + b * cos(6.28318 * (cc * t + d));\n' +
  '  return col + vec3(0.12, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;\n' +
  '}\n' +
  '\n' +
  'vec3 palette(float t) {\n' +
  '  vec3 oldC = palRegime(t, u_regime - 1.0);\n' +
  '  vec3 newC = palRegime(t, u_regime);\n' +
  '  return mix(oldC, newC, clamp(u_regimeMix, 0.0, 1.0));\n' +
  '}\n' +
  '\n' +
  '// iridescent thin-film spectrum from a phase (highs carry it).\n' +
  'vec3 iridescent(float phase) {\n' +
  '  return 0.55 + 0.45 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.66)));\n' +
  '}\n' +
  '\n' +
  'uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1\n' +
  '\n' +
  '// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3\n' +
  '// idiom). rot is in TURNS; luminance (Y) is untouched by construction.\n' +
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
  '  // ---- Section fold on the warp coords: the accumulated nebula folds.\n' +
  '  vec2 wc = c;\n' +
  '  if (u_fold > 0.5) {\n' +
  '    float fold = PI / u_fold;\n' +
  '    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);\n' +
  '    wc = vec2(cos(fa), sin(fa)) * r;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Warp (odyssey): differential rotation + churn + kick ripple + lens.\n' +
  '  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));\n' +
  '  float cs = cos(rot);\n' +
  '  float sn = sin(rot);\n' +
  '  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;\n' +
  '  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);\n' +
  '  vec2 churn = (vec2(\n' +
  '    fbm(c * 2.6 + t * 0.12),\n' +
  '    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)\n' +
  '  ) - 0.5) * (0.002 + 0.020 * u_mid + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);\n' +
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
  '  // Aberration + unsharp chroma-preserving feedback sample (emission memory).\n' +
  '  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash)\n' +
  '    / vec2(aspect, 1.0);\n' +
  '  ab *= u_density; // fringe amount rides the dust param (human note)\n' +
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
  '  float memBias = clamp(1.30 + 0.10 * u_glow, 1.10, 1.45);\n' +
  '  vec3 sky = max(vec3(0.0), sampled * memBias - blur * 0.35) * u_decay;\n' +
  '\n' +
  '  // ================= NURSERY MEDIUM (fresh, injected at 1 - decay) =======\n' +
  '  vec3 fresh = vec3(0.0);\n' +
  '\n' +
  '  // ---- GAS VOLUME: FBM shells + vertical pillars. Buildup COMPRESSES the\n' +
  '  // gas (tighter, higher contrast); phrase enriches it; the section\n' +
  '  // topology stretches/shears/twists the pillar field (scene transform).\n' +
  '  float compress = 1.0 + 0.7 * u_buildup + 0.30 * u_phrase;\n' +
  '  vec2 warpG = vec2(\n' +
  '    fbm(c * 1.6 + vec2(0.0, t * 0.18)),\n' +
  '    fbm(c * 1.6 + vec2(5.2, 3.1) - t * 0.14)\n' +
  '  ) - 0.5;\n' +
  '  float convection = 0.25 + 0.9 * u_mid + 0.4 * u_sustain;\n' +
  '  // Topology: index 0 upright pillars, 1 sheared, 2 twisted (eased).\n' +
  '  float topo = u_topology;\n' +
  '  float shear = clamp(topo, 0.0, 1.0);\n' +
  '  float twistT = clamp(topo - 1.0, 0.0, 1.0);\n' +
  '  vec2 gp = c * compress + warpG * convection * 0.55;\n' +
  '  gp.x += gp.y * shear * 0.6;\n' +
  '  float ta = twistT * (0.9 * gp.y);\n' +
  '  gp = mat2(cos(ta), -sin(ta), sin(ta), cos(ta)) * gp;\n' +
  '  float shell = fbm(gp * 1.5 + vec2(t * 0.05, -t * 0.03));\n' +
  '  float pillar = fbm(vec2(gp.x * 2.4, gp.y * 1.1) + vec2(-t * 0.04, t * 0.02));\n' +
  '  float gas = pow(clamp(shell * 0.6 + pillar * 0.7, 0.0, 1.4), 1.7);\n' +
  '  gas *= (0.5 + 1.1 * u_density);\n' +
  '  // Bar wave + kick ripple LIGHT the gas as they sweep (odyssey reverb).\n' +
  '  float reverb = 1.0 + 2.4 * rippleWave + 2.0 * barWave;\n' +
  '  float palT = shell * (1.0 + 0.7 * u_spread) + gp.y * 0.22 + gp.x * 0.08\n' +
  '    + t * 0.02 + u_centroid * 0.35 + u_phrase * 0.30;\n' +
  '  vec3 gasColor = palette(palT);\n' +
  '  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);\n' +
  '  float midGate = smoothstep(0.04, 0.3, u_mid);\n' +
  '  float gasGain = 0.10 + 0.9 * u_mid + 0.5 * u_sustain + 0.35 * u_drop;\n' +
  '  fresh += gasColor * gas * gasGain * centerDim * reverb * (0.7 + 0.6 * midGate);\n' +
  '\n' +
  '  // ---- PROTOSTAR CORES (LOW/KICK): solid compact ignitions inside the\n' +
  '  // gas. On a kick each fires a spherical ILLUMINATION FRONT that LIGHTS\n' +
  '  // the gas it passes (odyssey ripple, nursery guise).\n' +
  '  for (int i = 0; i < ' + CORE_COUNT + '; i++) {\n' +
  '    vec3 core = u_cores[i];\n' +
  '    vec3 fr = u_coreFront[i];\n' +
  '    vec2 d = c - core.xy;\n' +
  '    float dist = length(d);\n' +
  '    float ignite = core.z;\n' +
  '    float hot = exp(-dist * dist * (900.0 - 500.0 * ignite));\n' +
  '    float bloom = exp(-dist * (10.0 - 4.0 * ignite));\n' +
  '    vec3 coreHue = mix(LOW, vec3(1.0, 0.95, 0.85), 0.4 + 0.6 * ignite);\n' +
  '    coreHue = mix(coreHue, palette(fr.z), 0.35);\n' +
  '    fresh += coreHue * hot * (0.6 + 1.7 * ignite + 0.6 * u_kick);\n' +
  '    fresh += mix(coreHue, palette(fr.z), 0.5) * bloom * (0.15 + 0.7 * ignite);\n' +
  '    float frontR = 0.02 + fr.x * 0.85;\n' +
  '    float front = exp(-pow((dist - frontR) * 8.0, 2.0)) * exp(-fr.x * 2.2) * fr.y;\n' +
  '    fresh += mix(coreHue, gasColor, 0.6) * front * (0.5 + 2.0 * gas) * 1.3;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Charged horizon ring (odyssey bass element, brightens through the\n' +
  '  // phrase): the cores sit inside a live event horizon.\n' +
  '  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)\n' +
  '    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);\n' +
  '  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);\n' +
  '  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));\n' +
  '  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));\n' +
  '  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));\n' +
  '  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);\n' +
  '  float ringGain = 1.0 + 0.5 * anticipation;\n' +
  '  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;\n' +
  '  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore\n' +
  '    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;\n' +
  '\n' +
  '  // ---- IRIDESCENT RIM SHIMMER (HIGH): thin-film spectrum races along gas\n' +
  '  // edges (gradient magnitude), phase driven by highs + centroid. No dust.\n' +
  '  float gx = fbm(gp * 1.5 + vec2(px.x * 40.0, 0.0)) - shell;\n' +
  '  float gy = fbm(gp * 1.5 + vec2(0.0, px.y * 40.0)) - shell;\n' +
  '  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);\n' +
  '  float shimPhase = shell * 2.0 + u_centroid * 0.8 + t * 0.4 + u_high * 3.0;\n' +
  '  vec3 rim = iridescent(shimPhase);\n' +
  '  float shimmer = edge * (0.4 + 0.6 * sin(t * 9.0 + shell * 30.0));\n' +
  '  fresh += rim * shimmer * (0.05 + 1.6 * u_high) * (0.4 + 0.6 * gas) * reverb;\n' +
  '\n' +
  '  // ---- MAGNETIC FILAMENTS (HIGH): nimitz ridges + triangle noise — thin\n' +
  '  // glowing threads that ripple; buildup TAUTENS them (tighter, brighter).\n' +
  '  float taut = 1.0 + 0.9 * u_buildup + 0.4 * anticipation;\n' +
  '  float fil = 0.0;\n' +
  '  float famp = 1.0;\n' +
  '  vec2 fp = c * taut;\n' +
  '  for (int i = 0; i < 3; i++) {\n' +
  '    float ridge = fp.y * 3.0 + sin(fp.x * 4.0 + t * 1.3) * 1.2\n' +
  '      + tri(fp.x * 2.0 - t * 0.5) * 3.0;\n' +
  '    float thread = 1.0 - smoothstep(0.0, 0.10 / taut, abs(fract(ridge) - 0.5));\n' +
  '    fil += thread * famp;\n' +
  '    famp *= 0.55;\n' +
  '    fp = fp * 1.9 + vec2(1.7, -0.9);\n' +
  '    fp = mat2(0.80, -0.60, 0.60, 0.80) * fp;\n' +
  '  }\n' +
  '  fil = pow(clamp(fil, 0.0, 1.0), 1.5);\n' +
  '  float filRipple = 0.6 + 0.4 * sin(t * 12.0 + c.x * 20.0);\n' +
  '  vec3 filColor = mix(iridescent(u_centroid + t * 0.15), palette(0.6 + t * 0.05), 0.45);\n' +
  '  fresh += filColor * fil * filRipple * u_filaments * (0.08 + 1.7 * u_high)\n' +
  '    * (0.5 + 0.5 * gas) * reverb;\n' +
  '\n' +
  '  // ---- SUPERNOVA (section boundary): chromatic shell shockwave from\n' +
  '  // u_novaPos. Its job is CHROMATIC (regime crossfade above) + a physical\n' +
  '  // shell lighting the gas — a sweep, rate-limited, not a full-field flash.\n' +
  '  if (u_nova > 0.001) {\n' +
  '    vec2 nd = c - u_novaPos;\n' +
  '    float ndist = length(nd);\n' +
  '    float shellR = 0.03 + u_novaAge * 1.4;\n' +
  '    float shellRing = exp(-pow((ndist - shellR) * 6.0, 2.0)) * u_nova;\n' +
  '    vec3 novaHue = palette(0.2 + ndist * 0.4 + t * 0.05);\n' +
  '    fresh += novaHue * shellRing * (0.8 + 1.5 * gas);\n' +
  '    float wake = smoothstep(shellR, shellR - 0.4, ndist) * u_nova * 0.15;\n' +
  '    fresh += novaHue * gas * wake;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Section omen: a ring closing in from the screen edge over the\n' +
  '  // last bars (odyssey anticipation of the coming supernova).\n' +
  '  float omen = smoothstep(0.8, 1.0, u_section);\n' +
  '  if (omen > 0.001) {\n' +
  '    float omenR = 1.15 - 0.75 * omen;\n' +
  '    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Snare: a brief convection lift of the gas (NOT particles).\n' +
  '  if (u_snare > 0.03) {\n' +
  '    fresh += gasColor * gas * u_snare * 0.25 * midGate;\n' +
  '  }\n' +
  '\n' +
  '  // Anticipation shimmer: last bar of a phrase flickers.\n' +
  '  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);\n' +
  '  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);\n' +
  '\n' +
  '  // ---- Kick shock stamp (broadband punch on the field).\n' +
  '  if (u_kick > 0.02) {\n' +
  '    float ringR = 0.1 + 0.05 * u_kick;\n' +
  '    float shock = exp(-pow((r - ringR) * 38.0, 2.0))\n' +
  '      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));\n' +
  '    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);\n' +
  '    sky *= 1.0 + 0.1 * u_kick;\n' +
  '  }\n' +
  '\n' +
  '  // ---- Mutation flash (rate-limited on the JS side), grain, grade,\n' +
  '  // dynamics, chroma-preserving soft knee.\n' +
  '  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));\n' +
  '  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);\n' +
  '  vec3 grade = palette(0.35 + u_centroid * 0.2);\n' +
  '  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.22);\n' +
  '  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.06 * u_buildup) * (1.0 + 0.06 * u_beatPump);\n' +
  '  float m = max(sky.r, max(sky.g, sky.b));\n' +
  '  if (m > 0.8) {\n' +
  '    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;\n' +
  '  }\n' +
  '  gl_FragColor = vec4(max(sky, 0.0), 1.0);\n' +
  '}\n';

const FOLD_CYCLE = [0, 6, 8];
const TOPOLOGY_COUNT = 3; // upright -> sheared -> twisted pillar fields

interface Core {
  x: number;
  y: number;
  ignition: number;
  frontAge: number;
  frontAmp: number;
  hue: number;
}

const candidate: VisualizerPreset = {
  id: 'g07-odyssey-nursery',
  name: 'g07 odyssey-nursery',
  hiRes: true,
  params: [
    { id: 'density', label: 'gas density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'filaments', label: 'filament gain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'chaos', label: 'mutation chaos', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glow', label: 'emission memory', min: 0, max: 1.5, step: 0.05, default: 0.9 },
  ],
  create: () => {
    // fringe fix: per-song hue anchor state (dust-v3 idiom) for u_hueRot.
    let fringeCentroid = 0.5;
    let fringeAnchor = 0;
    let fringeAnchorTarget = 0;
    let fringeAnchorTrack: number | null = null;
    // ---- Odyssey genome state.
    let regimeTarget = Math.floor(Math.random() * 4);
    let regimeCurrent = regimeTarget;
    let regimeMix = 1;
    let foldIndex = 0;
    let modeTarget = 0; // 0 flight, 1 collapse, 2 orbit
    let modeCurrent = 0;
    let topologyTarget = 0;
    let topologyCurrent = 0;
    let spinDirection = 1;
    let horizonTarget = 1;
    let horizonCurrent = 1;
    let flash = 0;
    let flashBudget = 0; // photosensitivity rate limiter (flashes/sec)
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

    // ---- Supernova state.
    let nova = 0;
    let novaAge = 999;
    let novaPos: [number, number] = [0, 0];
    let lastSection = -1;

    // ---- Protostar core field.
    const rand = (seed: number) => {
      const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const seedCore = (i: number, gen: number): Core => ({
      x: (rand(i * 3.7 + gen * 11.3) - 0.5) * 1.3,
      y: (rand(i * 5.1 + gen * 7.9) - 0.5) * 1.05,
      ignition: 0,
      frontAge: 999,
      frontAmp: 0,
      hue: rand(i * 2.3 + gen * 4.1),
    });
    let coreGen = 0;
    const cores: Core[] = [];
    for (let i = 0; i < CORE_COUNT; i++) cores.push(seedCore(i, 0));
    let oldestIndex = 0;

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

        // Drop/buildup split first — bass-weighted, smoothed ~0.35 s.
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

        // DROP-AWARE genome: a landing drop forces the most energetic scene
        // NOW — flight, hot regime jump, wide horizon, MULTI-CORE ignition.
        let dropLanded = false;
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 8) {
          lastDropAt = frame.time;
          dropLanded = true;
          modeTarget = 0;
          foldIndex = 0;
          regimeTarget = (regimeTarget + 2) % 4;
          regimeMix = 0;
          horizonTarget = 1.2;
          tryFlash(1.0 * chaos);
        }
        prevDrop = smoothDrop;
        if (energy < 0.15) breakdownS += dt;
        else breakdownS = 0;
        if (breakdownS > 2.5 && modeTarget !== 2) {
          modeTarget = 2; // orbit: gentle
          foldIndex = 0;
          tryFlash(0.25 * chaos);
        }

        // Ladder-correct bar ordinal (respects Reset marks).
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;

        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            barWaveAge = 0;
            const phraseBoundary = ((tierBar % 4) + 4) % 4 === 0;
            const sectionBoundary = ((tierBar % 16) + 16) % 16 === 0;
            if (phraseBoundary) {
              // Phrase: gentle regime creep + a new pillar topology stage.
              regimeTarget = (regimeTarget + 1) % 4;
              regimeMix = 0;
              topologyTarget = (topologyTarget + 1) % TOPOLOGY_COUNT;
              tryFlash(0.5 * chaos);
            }
            if (sectionBoundary) {
              // SECTION -> SUPERNOVA: detonate the oldest core, recolor,
              // cycle warp mode + fold + spin, and re-seed the field.
              nova = 1;
              novaAge = 0;
              novaPos = [cores[oldestIndex].x, cores[oldestIndex].y];
              coreGen += 1;
              cores[oldestIndex] = seedCore(oldestIndex, coreGen);
              oldestIndex = (oldestIndex + 1) % CORE_COUNT;
              regimeTarget = (regimeTarget + 2) % 4;
              regimeMix = 0;
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

        // Ease the genome; run the bass systems (charge, ripple).
        const easeSlow = 1 - Math.exp(-dt / 0.9);
        const easeFast = 1 - Math.exp(-dt / 0.4);
        regimeCurrent += (regimeTarget - regimeCurrent) * easeSlow;
        modeCurrent += (modeTarget - modeCurrent) * easeSlow;
        topologyCurrent += (topologyTarget - topologyCurrent) * easeFast;
        horizonCurrent += (horizonTarget - horizonCurrent) * easeFast;
        regimeMix = Math.min(1, regimeMix + dt / 1.2);
        flash = Math.max(0, flash - dt * 1.4);
        barWaveAge += dt;
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + impulse.low * 0.28);
        rippleAge += dt;
        if (impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, impulse.low * 1.2);
        }
        // Supernova shell expands + decays.
        novaAge += dt;
        nova = Math.max(0, nova - dt / 1.6);
        // Section clock (fallback safety for re-seed if tierBar missing).
        if (tierBar !== null) {
          const section = Math.floor(tierBar / 16);
          if (section !== lastSection) lastSection = section;
        }

        // ---- Protostar cores: ignition rises with sustained lows + drop; on
        // a kick, cores launch an illumination front; a drop fires ALL cores.
        const kick = impulse.low;
        const igniteTarget = Math.min(1, bands.low * 0.9 + smoothDrop * 0.6);
        const kickHit = kick > 0.32;
        for (let i = 0; i < CORE_COUNT; i++) {
          const co = cores[i];
          const ia = co.ignition < igniteTarget ? 1 - Math.exp(-dt / 0.12) : 1 - Math.exp(-dt / 0.7);
          co.ignition += (igniteTarget - co.ignition) * ia;
          co.frontAge += dt;
          const coreFires =
            (dropLanded && co.frontAge > 0.1) ||
            (kickHit &&
              co.frontAge > 0.14 &&
              (smoothDrop > 0.25 || rand(i * 9.1 + Math.floor(frame.time)) < 0.45 + 0.5 * kick));
          if (coreFires) {
            co.frontAge = 0;
            co.frontAmp = Math.min(1, Math.max(kick, dropLanded ? 0.9 : 0) * 1.3);
          }
        }

        const coreArr = new Float32Array(CORE_COUNT * 3);
        const frontArr = new Float32Array(CORE_COUNT * 3);
        for (let i = 0; i < CORE_COUNT; i++) {
          const co = cores[i];
          coreArr[i * 3 + 0] = co.x;
          coreArr[i * 3 + 1] = co.y;
          coreArr[i * 3 + 2] = co.ignition;
          frontArr[i * 3 + 0] = co.frontAge;
          frontArr[i * 3 + 1] = co.frontAmp;
          frontArr[i * 3 + 2] = co.hue;
        }

        // Warp-mode blend (odyssey): flight zooms out, collapse falls in,
        // orbit swirls; churn on max(drop, energy).
        const w0 = Math.max(0, 1 - Math.abs(modeCurrent));
        const w1 = Math.max(0, 1 - Math.abs(modeCurrent - 1));
        const w2 = Math.max(0, 1 - Math.abs(modeCurrent - 2));
        const phraseNow =
          beat && tierBar !== null ? ((((tierBar % 4) + 4) % 4) + beat.barPhase) / 4 : 0;
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

        // fringe fix: per-song hue anchor (splitmix of the dominant deck
        // trackId, ~2s eased) + slow spectral travel -- steers the feedback
        // fringe hue (see hueRotate in the fragment).
        fringeCentroid += (frame.centroid - fringeCentroid) * (1 - Math.exp(-dt / 1.0));
        let fringeDomTrack: number | null = null;
        let fringeDomLevel = -1;
        for (const d of frame.decks) {
          if (d.level > fringeDomLevel) {
            fringeDomLevel = d.level;
            fringeDomTrack = d.trackId;
          }
        }
        if (fringeDomTrack !== null && fringeDomTrack !== fringeAnchorTrack) {
          fringeAnchorTrack = fringeDomTrack;
          fringeAnchorTarget = splitmix01(fringeDomTrack);
        }
        fringeAnchor += (fringeAnchorTarget - fringeAnchor) * (1 - Math.exp(-dt / 2.0));
        const fringeHueRot = (((fringeAnchor + (fringeCentroid - 0.5) * 0.8) % 1) + 1) % 1;
        return {
          u_hueRot: fringeHueRot,
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
          u_spread: frame.spread,
          u_decay: Math.min(0.998, 0.992 - 0.008 * energy - 0.008 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          u_zoom: w0 * zoomFlight + w1 * zoomCollapse + w2 * zoomOrbit,
          u_rotStep: spinDirection * rotBase * (1 + 2.2 * w2),
          u_charge: charge,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_regime: regimeCurrent,
          u_regimeMix: regimeMix,
          u_topology: topologyCurrent,
          u_fold: FOLD_CYCLE[foldIndex],
          u_horizonScale: horizonCurrent,
          u_flash: flash,
          u_phrase: phraseNow,
          u_section: section,
          u_barWave: barWaveAge,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_nova: nova,
          u_novaAge: novaAge,
          u_novaPos: novaPos,
          u_density: frame.params.density ?? 1,
          u_filaments: frame.params.filaments ?? 1,
          u_glow: frame.params.glow ?? 0.9,
          u_cores: coreArr,
          u_coreFront: frontArr,
        };
      },
    });
  },
};

export default candidate;
