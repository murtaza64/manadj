/**
 * g07-voyage-gravity — an alternative interpretation of the bass.
 *
 * Parent: g00/voyage. Palette, starfield, snare and high behaviour are the
 * parent's, verbatim. The ONE thing reimagined is the bass/kick layer:
 * instead of ripples and pumps (surface effects), the low band bends SPACE.
 *
 * The gravity system (all displacement, never a luminance flash):
 *
 * - CURVATURE (u_curv) — bands.low + sustain read as gravitational field
 *   strength. It contracts the dust lanes inward (a radial remap that pulls
 *   samples toward the core), spins the interior faster, strengthens the
 *   gravitational lens on the starfield, and BOWS the horizon ring. Sustained
 *   heavy bass = tight, fast, hot accretion; bass dropout relaxes it all —
 *   dust drifts wide and slow. That contrast is the whole point.
 *
 * - THE FOLD (u_fold / u_foldSmear) — a kick is not a ring, it is one
 *   frame-scale spacetime fold. On a strong impulse.low we launch a ~200 ms
 *   elastic envelope: a hard PULL-IN (space compresses toward the core, the
 *   whole field sucks inward, dust bunches) followed by an overshooting
 *   REBOUND (the field slings back outward past rest and settles). u_fold is
 *   SIGNED — negative during pull, positive during rebound — and drives a
 *   radial displacement of the sample coordinate for the entire scene. During
 *   the fold the background stars SMEAR along geodesics (u_foldSmear taps the
 *   feedback along the radial direction), so the surge reads as bent light,
 *   not a flash.
 *
 * - REGIMES (u_regime) — a section-scale hysteresis between "heavy bass" and
 *   "bass dropout", shifted on ladder tiers (ladderBarIndex ?? barIndex), so
 *   a bassy section and a stripped-back section look unmistakably different
 *   (accretion hot/tight vs. relaxed/cold/wide) beyond the instantaneous band.
 *
 * - DROP = max gravity + poleward ESCAPE JETS (matter flung out along the
 *   poles, riding max(drop, energy) as the parent derives it).
 * - BUILDUP = slow inexorable contraction (u_contract), tense but alive.
 *
 * Photosafety: the fold is a coordinate displacement + a feedback smear. No
 * fullscreen luminance envelope is driven by the kick.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

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
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_armPhase;   // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;       // disk cloud / fine-dust gain
uniform float u_palette;    // palette blend 0..3
uniform float u_spawnSnare; // snare-driven star burst gain
// --- gravity system (this candidate's bass layer) ---
uniform float u_curv;       // spacetime curvature (bass field strength) 0..~1.4
uniform float u_fold;       // signed kick fold: <0 pull-in, >0 rebound
uniform float u_foldSmear;  // geodesic star-smear gain during a fold
uniform float u_regime;     // section-scale heavy(1)..dropout(0) accretion regime
uniform float u_contract;   // buildup contraction (slow inexorable pull)
uniform float u_jet;        // poleward escape-jet strength (drop)

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

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
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
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- GRAVITY: the bass bends space. Curvature contracts orbits inward and
  // spins the interior faster; a kick FOLDS the whole field elastically.
  // Field-strength falloff: strong near the core, tapering with radius (a
  // toy gravitational potential), so distortion is dramatic but stays legible
  // at the frame edges.
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.16 * u_curv) * (1.0 + 0.05 * u_jet);
  // Horizon BOWS with the curvature — an anisotropic swell (poles vs. equator)
  // so the event horizon visibly deforms under heavy bass.
  float bow = 1.0 + (0.10 * u_curv + 0.05 * u_regime) * cos(ang * 2.0 - u_armPhase * 0.3);
  horizon *= bow;
  // Potential well: 1 at the core, falling off outward. Governs how much this
  // pixel's sample is pulled toward the center.
  float well = exp(-r * (1.9 - 0.5 * u_regime));

  // Differential rotation, sped up by curvature (matter orbits faster the
  // deeper the well): the inner field shears harder under heavy bass.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * (1.0 + 0.9 * u_curv * well);
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;

  // Orbit CONTRACTION: remap the sampled radius inward as a function of the
  // potential well. Heavy bass (curv) + buildup contraction both pull; the
  // fold's pull-in phase adds a hard transient contraction (and rebound
  // slings it back out when u_fold > 0). This is the core "space curves"
  // motion — sampled coordinates migrate toward the core so dust appears to
  // fall in and orbit tighter.
  float pullIn = (0.10 * u_curv + 0.16 * u_contract) * well
    - u_fold * 0.14 * (0.35 + well);   // signed fold: <0 compresses, >0 flings out
  vec2 gravPull = dirW * pullIn;

  // Turbulent churn (mids knead the sky) — parent motion, kept.
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);

  // Gravitational LENS on the starfield: a localized swirl inside the horizon,
  // strengthened by curvature and violently by the fold. Interior churns,
  // exterior stays readable.
  float lensFall = exp(-pow(r / horizon, 2.0) * 1.4);
  float lens = (0.5 * u_curv + 1.9 * abs(u_fold)) * (1.0 + 0.9 * u_curv) * lensFall;
  float drag = lens * 0.14;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.05;

  // Escape JETS (drop): near the poles, matter is flung OUTWARD along +/-Y.
  // A poleward mask (|sin ang| near 1) times u_jet displaces the sample the
  // opposite way of the pull — visible ejection.
  float poleMask = pow(abs(sin(ang)), 6.0);
  vec2 jet = vec2(0.0, sign(c.y)) * u_jet * poleMask * (0.02 + 0.05 * well);

  vec2 src = (w + churn + gravPull + lensPull + jet) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial split, widening through the drop and blowing
  // out along the fold surge (replaces the parent's ripple term).
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.006 * abs(u_fold))
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp anti-mush tap — parent, kept.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // GEODESIC STAR SMEAR: during a fold, tap the feedback along the radial
  // direction and add it in, stretching whatever light is there into streaks
  // that bend toward the core (pull) or outward (rebound). Pure displacement
  // of already-present light — no new luminance envelope.
  if (u_foldSmear > 0.001) {
    vec2 gdir = dirW * sign(u_fold + 1e-4);
    vec3 smear = vec3(0.0);
    smear += texture2D(u_prev, src + gdir * px * 3.0).rgb;
    smear += texture2D(u_prev, src + gdir * px * 6.0).rgb;
    smear += texture2D(u_prev, src + gdir * px * 10.0).rgb;
    smear += texture2D(u_prev, src + gdir * px * 15.0).rgb;
    sky = max(sky, smear * 0.25 * u_foldSmear);
  }

  // ---- Steady layers, injected at (1 - decay). Bass rim/core/ring below is
  // the parent's language, now driven by curvature + fold instead of raw kick.
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  // Rim shape follows the bassline; fold adds a fast tremor as the field snaps.
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * abs(u_fold) * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * abs(u_fold));
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * abs(u_fold)));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // Gravity waves breathing from the core with the bassline — sustained lows
  // (curv) keep the center alive; regime hardens their contrast.
  float gwave = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gwaveGain = u_low * (0.5 + 0.8 * u_curv) * (0.6 + 0.6 * u_regime);
  fresh += mix(vec3(0.55, 0.07, 0.04), LOW, 0.5)
    * pow(gwave, 4.0) * exp(-r * 5.0) * gwaveGain;
  // Event horizon ring — its radius is the (bowed) horizon; brightness rides
  // curvature + fold. Colour runs ember -> white-hot as curvature builds (a
  // hotter accretion under heavy bass), not as a per-kick flash.
  float arcJitter = volt * (0.012 + 0.05 * abs(u_fold) + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 hotColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_curv, 0.0, 1.0));
  hotColor = mix(hotColor, vec3(1.0, 0.97, 0.92), clamp(u_curv - 0.6, 0.0, 0.5) * 2.0);
  fresh += hotColor * ringGlow * (0.12 + 0.6 * u_low + 0.7 * u_curv + 0.6 * abs(u_fold));
  fresh += mix(hotColor, vec3(1.0), 0.4 * abs(u_fold)) * ringCore
    * (0.3 + 1.3 * bassOn + 1.3 * u_curv + 1.0 * abs(u_fold));
  vec3 coal = vec3(0.55, 0.07, 0.04);
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.4 * abs(u_fold)) * heart * (0.5 + 1.2 * u_low + 1.0 * u_curv);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.3 * u_curv);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic streak — parent money shot, curvature-driven.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.6 * u_curv);

  // Escape-jet emission: poleward plumes of hot matter on the drop. Localized
  // (poleMask), so it is not a fullscreen flash.
  if (u_jet > 0.01) {
    float plume = pow(abs(sin(ang)), 8.0) * smoothstep(0.06, 0.55, r) * exp(-r * 1.6);
    plume *= 0.6 + 0.4 * fbm(vec2(r * 9.0 - t * 1.2, ang * 3.0));
    fresh += mix(vec3(0.7, 0.9, 1.0), palette(0.5 + t * 0.02), 0.5) * plume * u_jet * 1.4;
  }

  // The disk: spiral lanes + clouds in the TRAVELING palette (parent). Orbit
  // contraction is expressed here too via lane tightening under curvature.
  float armTighten = 5.0 + 1.6 * u_curv;
  float arm = sin(ang * 2.0 + log(r + 0.06) * armTighten - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * (1.8 + 0.7 * u_curv));
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4);
  float midGate = smoothstep(0.04, 0.3, u_mid);
  // Dust brightens where the fold's compression bunches it (well * pull).
  float bunch = 1.0 + 1.8 * max(0.0, -u_fold) * well;
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * bunch;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * bunch;
  // HIGH NEBULA — parent, unchanged (snare/high behaviour stays parent).
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula PUFFS — parent, unchanged.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps. Snare + powder stay parent. The kick no longer
  // stamps a shockwave ring — its energy is spent on the FOLD (displacement).
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain — parent.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade — parent.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  // Chroma-preserving soft knee (parent): scale luminance, keep hue.
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const g07VoyageGravity: VisualizerPreset = {
  id: 'g07-voyage-gravity',
  name: 'g07 Voyage Gravity',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'gravity', label: 'gravity strength', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let curv = 0;         // smoothed spacetime curvature (bass field strength)
    // --- fold envelope state (the elastic kick spacetime fold) ---
    let foldT = 999;      // seconds since the last fold launched
    let foldAmp = 0;      // that kick's captured strength
    // --- section-scale regime (heavy bass vs dropout), ladder-shifted ---
    let regime = 0;       // smoothed 0 (dropout) .. 1 (heavy)
    let prevBar: number | null = null;
    let barHeavyAccum = 0; // bass energy accumulated within the current bar
    let barFrames = 0;
    let sectionHeavy = 0;  // last completed section's heaviness (target)

    const FOLD_DUR = 0.2;  // ~200 ms elastic fold, per the brief

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const gravityGain = frame.params.gravity ?? 1;

        // Excitement split by bass presence (parent) — drop vs buildup.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // Sustained gravity rides max(drop, energy) — the plateau, not just
        // the transition (parent taste rule).
        const lift = Math.max(drop, 0.7 * sustained);

        // ---- CURVATURE: bass field strength. Attacks fast, releases slower
        // so a bass dropout visibly RELAXES (dust drifts wide) rather than
        // snapping — the contrast is the assignment.
        const curvTarget = Math.min(1.4, (0.9 * frame.bands.low + 0.7 * sustained) * gravityGain);
        const curvAlpha = curvTarget > curv
          ? 1 - Math.exp(-dt / 0.08)   // snap up under bass
          : 1 - Math.exp(-dt / 0.55);  // relax down slowly on dropout
        curv += (curvTarget - curv) * curvAlpha;

        // ---- SECTION-SCALE REGIME: accumulate bass energy per bar; on a
        // ladder-tier bar rollover, latch the section's heaviness. Regime
        // eases toward it (~1.2 s) so a bassy section and a stripped section
        // read unmistakably differently beyond the instant band.
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        barHeavyAccum += frame.bands.low;
        barFrames += 1;
        if (bar !== null && prevBar !== null && bar !== prevBar) {
          const barMean = barFrames > 0 ? barHeavyAccum / barFrames : 0;
          // Section heaviness: EMA across bars with a phrase-scale memory.
          sectionHeavy += (Math.min(1, barMean * 1.6) - sectionHeavy) * 0.4;
          barHeavyAccum = 0;
          barFrames = 0;
        }
        if (bar !== null) prevBar = bar;
        // Gridless fallback: track sustained bass directly.
        const regimeTarget = bar !== null
          ? sectionHeavy
          : Math.min(1, frame.bands.low * 1.5 + 0.4 * sustained);
        regime += (regimeTarget - regime) * (1 - Math.exp(-dt / 1.2));

        // ---- THE FOLD: one elastic frame-scale spacetime fold per strong
        // kick. Envelope over ~200 ms: a hard PULL-IN (fold < 0, space
        // compresses) then an overshooting REBOUND (fold > 0, slings out) that
        // settles. Modelled as a damped sinusoid so the sign flips once.
        foldT += dt;
        if (frame.impulse.low > 0.35 && foldT > 0.11) {
          foldT = 0;
          foldAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        let fold = 0;
        let foldSmear = 0;
        if (foldT < FOLD_DUR * 3) {
          const tau = foldT / FOLD_DUR;               // 0..~3 over the tail
          const env = Math.exp(-tau * 2.2);           // decay of the elastic
          // sin(pi*tau): negative? No — sin over [0,pi] is >=0. We want a
          // pull-in (negative) first, then a rebound (positive). Use
          // -sin(pi*tau) shifted: a full period of a damped spring.
          // fold(tau) = -sin(2*pi*tau) * env  ->  starts pulling IN (neg),
          // crosses zero at tau=0.5 (~100ms), rebounds OUT (pos), settles.
          fold = -Math.sin(Math.PI * 2 * tau) * env * foldAmp;
          // Smear rides the raw envelope magnitude, strongest at the surge.
          foldSmear = env * foldAmp;
        }

        // ---- ESCAPE JETS: drop only, riding max(drop, energy). Poleward
        // ejection erupts when gravity is maxed.
        const jet = Math.min(1, Math.max(0, lift - 0.25) * 1.4) * (0.5 + 0.5 * regime);

        // ---- Buildup contraction: slow inexorable inward pull, tense/alive.
        const contract = buildup;

        // Zoom: base flight + drop expansion, buildup collapses inward
        // (parent grammar). The fold's own compression is applied in-shader
        // (gravPull) so it does not fight the zoom.
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 2.2 * jet) * speed * dt -
          0.3 * buildup * dt -
          0.5 * contract * dt;

        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);

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
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          // gravity system
          u_curv: curv,
          u_fold: fold,
          u_foldSmear: foldSmear,
          u_regime: regime,
          u_contract: contract,
          u_jet: jet,
          // Powder (parent): MID/HIGH effect, kick-gated to stay solid.
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
        };
      },
    });
  },
};

export default g07VoyageGravity;
