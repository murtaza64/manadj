/**
 * g08-voyage-eqsplit (gen-8 TWEAK of g00-voyage / presets/voyage.ts, 1044).
 *
 * Human ask (verbatim, brief): "lows influence property a, mids influence
 * colors of various things, highs influence something else."
 *
 * Falsifiable question — the human's CENTRAL ask: sweep ONE EQ knob, see ONE
 * property. Does a STRICT, independently-legible spectral split
 *   LOWS  = GEOMETRY (disk scale, warp depth, horizon height)
 *   MIDS  = COLOR    (palette hue center + saturation of everything)
 *   HIGHS = DETAIL   (star/glint count, lane edge sharpness, filament bright)
 * read cleanly — i.e. a bass kill visibly FLATTENS/SHRINKS the space, a mid
 * kill DRAINS the frame toward duotone, a high kill goes SOFT/EMPTY — with no
 * cross-talk between the three axes?
 *
 * The engine is voyage's, copied verbatim into this self-contained file
 * (galaxy driven by the feedback buffer with differential rotation; the inner
 * field turns faster, shearing everything into spiral arms; kick ripple that
 * lights the dust; charged horizon ring; localized black-hole lens;
 * chroma-preserving soft knee). The tweak is the STRICT EQ SPLIT — each band
 * owns exactly one visual axis and touches nothing else:
 *
 *   u_geo  (LOWS → GEOMETRY): the low band is the ONLY driver of the space's
 *     SIZE. It scales the disk (radial expansion), the warp DEPTH (feedback
 *     zoom/rotation gain), and the horizon HEIGHT (ring radius). Bass kill
 *     flattens & shrinks (small tight core, shallow warp); heavy bass inflates
 *     (big disk, deep churn, tall horizon). No hue/detail change from lows.
 *
 *   u_col  (MIDS → COLOR): the mid band is the ONLY driver of chroma. It moves
 *     the palette hue CENTER (mid content shifts the traveling palette phase)
 *     and the global SATURATION. Mid kill drains toward DUOTONE (desaturated
 *     ember/steel); mid boost = full saturated palette travel. No size/detail
 *     change from mids.
 *
 *   u_det  (HIGHS → DETAIL): the high band is the ONLY driver of fine detail.
 *     It sets the star/glint COUNT tier, the lane EDGE sharpness, and the
 *     filament brightness. High kill = soft, empty (blurred lanes, no stars);
 *     high boost = crystalline, busy (crisp lanes, dense glints). No size/hue
 *     change from highs. (Detail is glints/filaments, NOT dust powder.)
 *
 * EACH KNOB READS INDEPENDENTLY. To make the split legible off the physical
 * mixer, each axis is the max of the master band level and the dominant
 * audible deck's matching EQ knob deflection — so turning ONE EQ knob on the
 * deck sweeps exactly ONE property while the others hold.
 *
 * Kick/drop drama per parent (kick ripple + shockwave; drop rides
 * max(drop, energy)). Snare = a brief DETAIL-LAYER sparkle (mid/high gated,
 * no powder) — it rides the highs' detail axis, not a new dust medium.
 *
 * Standing law (docs/visualizer-ga.md): kicks SOLID; ride max(drop, energy);
 * no new dust media; shape carries band identity, color travels; photosafe
 * (smooth luminance envelopes, no fullscreen strobe); bright saturated colors
 * (repo dislikes pastels). Grid-locked drama lands via
 * `ladderBarIndex ?? barIndex` + beat phase; integers never interpolate.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

// No backticks inside this GLSL string (GLSL ES 1.0).
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
uniform float u_centroid;  // harmonic content: palette phase
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;  // seconds since the last strong kick
uniform float u_rippleAmp;  // that kick's captured strength
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_armPhase;   // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;       // disk cloud / fine-dust gain
uniform float u_palette;    // palette blend 0..3
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven detail sparkle gain
// --- THE STRICT EQ SPLIT (each drives exactly one axis).
uniform float u_geo;   // LOWS  -> geometry (size/warp/horizon), 0..1
uniform float u_col;   // MIDS  -> color (hue center + saturation), 0..1
uniform float u_det;   // HIGHS -> detail (count/edge/filament), 0..1

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palette: deep-space blues/violets/pinks that TRAVEL.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// The palette PHASE center is driven by the MIDS (u_col) — this is the color
// axis. Lows/highs never touch hue. The drop/buildup warmth stays (parent).
vec3 palRaw(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

// COLOR AXIS (mids): mid content moves the hue center AND sets saturation.
// A mid kill drains toward DUOTONE (a desaturated ember/steel), a mid boost
// gives the full saturated traveling palette. Nothing else touches chroma.
vec3 palette(float t) {
  // Mids push the palette phase forward (hue center travels with mid content).
  vec3 c = palRaw(t + 0.45 * u_col);
  // Duotone floor when mids are killed: luminance-preserving desaturation
  // toward a bass-ember / steel duotone axis (bright, not gray — repo taste).
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 duo = mix(vec3(0.5, 0.16, 0.10), vec3(0.16, 0.22, 0.5), clamp(t, 0.0, 1.0)) * (0.5 + lum);
  float sat = 0.15 + 0.85 * clamp(u_col, 0.0, 1.0);
  return mix(duo, c, sat);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

// DETAIL AXIS (highs): the gate WIDENS with u_det so more cells light up (a
// count tier), and the spikes sharpen. High kill -> almost none; high boost ->
// dense crystalline field. No hue/size dependence.
vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  // Count TIER from the detail axis: lower the gate as u_det rises => more on.
  float on = step(gate - 0.12 * u_det - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // GEOMETRY AXIS (lows): the low band scales the SPACE. A radial remap
  // shrinks the field toward the core when bass is killed (flat/tight) and
  // inflates it when bass is heavy (big disk). This is the ONLY size driver.
  // geoScale < 1 pulls structure inward (smaller), > 1 pushes it outward.
  float geoScale = 0.62 + 0.7 * clamp(u_geo, 0.0, 1.0);
  float rg = r / geoScale;             // geometry-scaled radius for structure
  float angG = ang;

  // ---- Warp: differential rotation + churn + traveling kick ripple. Warp
  // DEPTH (rotation + churn magnitude) rides the geometry axis (lows), per the
  // split — bass kill = shallow warp, heavy bass = deep churn.
  float warpDepth = 0.4 + 0.6 * clamp(u_geo, 0.0, 1.0);
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * (0.5 + 0.5 * warpDepth);
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.02 * warpDepth + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // Localized black-hole lens; horizon HEIGHT (radius) rides the geometry axis.
  float horizon = (0.10 + 0.14 * clamp(u_geo, 0.0, 1.0)) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp anti-mush tap.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay). Structure uses the
  // geometry-scaled radius rg so the whole SPACE grows/shrinks with lows.
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(angG * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(angG * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(angG * 3.0 + t * 1.7) + 0.13 * sin(angG * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(angG * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = rg * (1.0 - bassWarp * exp(-rg * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  fresh += mix(vec3(0.55, 0.07, 0.04), LOW, 0.5)
    * pow(gravity, 4.0) * exp(-rg * 5.0) * gravityGain;
  // The event-horizon ring (its RADIUS is the geometry-driven horizon).
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart (bass identity).
  vec3 coal = vec3(0.55, 0.07, 0.04);
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak (color from the palette => the MID color axis).
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // ---- The disk: spiral lanes. SIZE from geometry (rg), COLOR from palette
  // (mids), EDGE SHARPNESS + filament brightness from detail (highs).
  float arm = sin(angG * 2.0 + log(rg + 0.06) * 5.0 - u_armPhase);
  // DETAIL AXIS: lane EDGE sharpness. High kill -> soft (low power, blurred
  // lanes); high boost -> crisp (high power). Highs never change size or hue.
  float lanePow = mix(1.5, 5.0, clamp(u_det, 0.0, 1.0));
  float lanes = pow(0.5 + 0.5 * arm, lanePow) * smoothstep(0.06, 0.2, rg) * exp(-rg * 1.8);
  float cloudField = fbm(vec2(angG * 2.2 + rg * 3.0 - t * 0.15, rg * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // COLOR: palette phase carries the mid color axis (palette() already does).
  vec3 diskColor = palette(cloudField * 1.5 + rg * 0.35 + angG * 0.1 + t * 0.012 + u_centroid * 0.4);
  float reverb = 1.0 + 2.6 * rippleWave;
  // Disk BRIGHTNESS is a stable base (rides sustain, not any single band) so
  // the three axes stay legible; only detail adds the filament sheen.
  fresh += diskColor * lanes * (0.5 + 0.7 * cloud) * (0.7 + 0.9 * u_sustain) * u_dust * centerDim * reverb;
  fresh += diskColor * cloud * exp(-rg * 2.4) * 0.4 * u_dust * centerDim * reverb;
  // DETAIL AXIS: filament brightness — crisp bright fibers along the lane
  // crests, brightness from highs (NOT dust powder; crest-locked filaments).
  float crest = pow(0.5 + 0.5 * arm, 10.0);
  vec3 filament = mix(vec3(0.7, 0.9, 1.0), palette(0.55 + t * 0.03), 0.35);
  fresh += filament * crest * smoothstep(0.1, 0.5, rg) * (0.15 + 1.6 * u_det) * u_dust * centerDim * reverb;

  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    // Shockwave radius rides the geometry scale (bigger space, bigger ring).
    float ringR = (0.1 + 0.05 * u_kick) * geoScale;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  // SNARE = brief DETAIL-LAYER sparkle (mid/high gated, no powder): a crisp
  // ring of glint points on the detail axis, gated by highs so it belongs to
  // the detail vocabulary, not a new dust medium.
  if (u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 18.0, 2.4, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade (color axis — mids). Keep it legible without leaking size.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool/dim, drops bloom.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  { id: 'splitGamma', label: 'EQ split contrast', min: 0.5, max: 2.5, step: 0.05, default: 1.3 },
];

/** Dominant audible deck (highest master-audible level); null when unknown. */
function dominantDeck(frame: VisualizerFrameData) {
  let best: (typeof frame.decks)[number] | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck;
    }
  }
  return best;
}

export const g08VoyageEqsplitPreset: VisualizerPreset = {
  id: 'g08-voyage-eqsplit',
  name: 'g08 voyage-eqsplit',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    // Smoothed EQ-split axes so a knob sweep glides, never steps.
    let geo = 0;
    let col = 0;
    let det = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const splitGamma = frame.params.splitGamma ?? 1.3;

        // Excitement split by bass presence (parent), temporally smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);

        // --- THE STRICT EQ SPLIT. Each axis = the band's own content, and to
        // make ONE physical EQ knob sweep ONE property, blend in the dominant
        // deck's matching EQ knob deflection (eq is 0..1, 0.5 = flat). A knob
        // ABOVE flat boosts its axis; below flat cuts it. Each axis is
        // otherwise INDEPENDENT — no cross-band terms anywhere.
        const deck = dominantDeck(frame);
        const knob = (v: number | undefined) => (v == null ? 0.5 : v); // 0.5 = flat
        // Knob deflection mapped to a 0..1 multiplier: cut (0)->0.15, flat->1,
        // boost (1)->1.6, so sweeping the knob visibly drains/boosts the axis.
        const knobGain = (k: number) => (k < 0.5 ? 0.15 + 1.7 * k : 0.85 + 0.3 * (k - 0.5) * 2);
        const eq = deck ? deck.eq : null;
        const lowKnob = eq ? knobGain(knob(eq.low)) : 1;
        const midKnob = eq ? knobGain(knob(eq.mid)) : 1;
        const highKnob = eq ? knobGain(knob(eq.high)) : 1;
        // Target axes: band content * knob gain, contrast-shaped so a kill
        // reads as a real collapse and a boost pops. Strictly one band each.
        const shape = (x: number) => Math.pow(Math.min(1, Math.max(0, x)), splitGamma);
        const geoT = Math.min(1, shape(frame.bands.low) * lowKnob);
        const colT = Math.min(1, shape(frame.bands.mid) * midKnob);
        const detT = Math.min(1, shape(frame.bands.high) * highKnob);
        // Smooth each axis independently (knob sweeps glide).
        geo += (geoT - geo) * (1 - Math.exp(-dt / 0.12));
        col += (colT - col) * (1 - Math.exp(-dt / 0.12));
        det += (detT - det) * (1 - Math.exp(-dt / 0.10));

        // Arm drift (parent).
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge (parent).
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple (parent).
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
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
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          // Parent's high-nebula spawner is retired here — highs are the detail
          // axis (lane edge / stars / filaments), not a spawner. u_spawn unused.
          u_spawn: 0,
          // SNARE detail sparkle: mid/high gated (snare = mid transient), rides
          // the detail axis so it belongs to the highs' vocabulary, no powder.
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (0.3 + 0.9 * det) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // --- THE STRICT EQ SPLIT.
          u_geo: geo,
          u_col: col,
          u_det: det,
        };
      },
    });
  },
};

export default g08VoyageEqsplitPreset;
