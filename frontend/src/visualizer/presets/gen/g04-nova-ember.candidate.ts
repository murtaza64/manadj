/**
 * "g04 nova-ember" (genetic arena g04): a TWEAK of g01-nova-bloom. Nova's
 * structure — shells-as-hero, chromatic fringes, palette phase drift,
 * accretion streaks, drop ignition — is preserved wholesale. The single
 * change answers the human note: "needs to be less bright all the time".
 *
 * TRUE DYNAMIC RANGE. g01 sat lit whenever the medium had density. g04
 * gives it a DARK EMBER BASELINE that brightness must be EARNED out of:
 *
 *   QUIET = EMBERS — with no sustained energy the whole field is gated to
 *     10-20% brightness and thins to sparse coals (density gets a hard
 *     floor cut, dust pulled down). The core glows dull red, not white.
 *   BRIGHTNESS IS EARNED — a slow-integrated "ember charge" (u_earned)
 *     rises only under SUSTAINED loud energy and bleeds away in quiet.
 *     Charge is what lifts the master gate; a busy phrase glows, a lull
 *     goes dark. The contrast between them IS the drama.
 *   DROPS BLOW IT OPEN — the drop/kick still ignite instantly (fast lift,
 *     independent of charge) so a drop out of silence lands full-force —
 *     then the field settles back toward embers as excitement fades and
 *     charge decays. Shells and ignition are untouched heroes.
 *
 * Assigned tech: energy trend (drop/buildup) + per-band impulses + a slow
 * sustained-energy integrator (the earned-charge accumulator).
 *
 * Photosensitivity: the master gate multiplies the ALREADY chroma-preserved
 * result by one scalar, so it cannot introduce new full-field flashes; the
 * drop lift is smoothed (~0.35 s) as in the parent.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerPreset } from '../types';

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
  'uniform float u_drop;',
  'uniform float u_buildup;',
  'uniform float u_sustain;',
  'uniform float u_centroid;',
  'uniform float u_decay;',
  'uniform float u_seed;',
  'uniform float u_dust;',
  'uniform float u_palette;',
  'uniform float u_bloom;',
  'uniform float u_phase;',
  '// Earned ember charge in [0,1]: slow-integrated sustained energy. 0 =',
  '// dead embers, 1 = fully blown open. Master brightness rides this.',
  'uniform float u_earned;',
  '// Instant lift from drop/kick, independent of charge, so a drop out of',
  '// silence still ignites at full force before charge catches up.',
  'uniform float u_lift;',
  '// How dark the earned floor sits (dark ember baseline, brief).',
  'uniform float u_floor;',
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
  'vec3 palette(float t) {',
  '  vec3 a; vec3 b; vec3 cf; vec3 d;',
  '  if (u_palette < 0.5) {',
  '    a = vec3(0.42, 0.14, 0.1); b = vec3(0.42, 0.24, 0.14);',
  '    cf = vec3(1.0, 0.9, 0.6); d = vec3(0.0, 0.15, 0.25);',
  '  } else if (u_palette < 1.5) {',
  '    a = vec3(0.45, 0.28, 0.42); b = vec3(0.25, 0.35, 0.5);',
  '    cf = vec3(1.0, 0.85, 0.7); d = vec3(0.0, 0.2, 0.45);',
  '  } else if (u_palette < 2.5) {',
  '    a = vec3(0.12, 0.35, 0.3); b = vec3(0.2, 0.42, 0.38);',
  '    cf = vec3(0.9, 1.0, 0.8); d = vec3(0.1, 0.3, 0.5);',
  '  } else {',
  '    a = vec3(0.5, 0.4, 0.25); b = vec3(0.42, 0.36, 0.28);',
  '    cf = vec3(1.0, 1.0, 0.9); d = vec3(0.0, 0.1, 0.2);',
  '  }',
  '  // Palette phase drift: the medium hue wanders on a slow clock so the',
  '  // nebula never sits still (parent behaviour, preserved).',
  '  d += vec3(0.10, -0.07, 0.05) * u_phase;',
  '  return a + b * cos(6.28318 * (cf * t + d)) + vec3(0.14, -0.02, -0.07) * u_drop;',
  '}',
  '',
  '// Sample the feedback advected outward by push along the radial dir.',
  '// Chromatic fringes: R/G/B pulled from staggered offsets.',
  'vec3 samplePrev(vec2 c, vec2 dir, float push, float aspect) {',
  '  vec2 src = (c - dir * push) / vec2(aspect, 1.0) + 0.5;',
  '  return texture2D(u_prev, src).rgb;',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float aspect = u_res.x / u_res.y;',
  '  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);',
  '  float r = length(c);',
  '  float ang = atan(c.y, c.x);',
  '  float t = u_time;',
  '',
  '  // heat = the instantaneous "how alive is this moment" scalar. Charge',
  '  // is the slow floor; drop/kick lift it instantly. Fresh emission scales',
  '  // with heat so quiet passages emit sparse dim coal, loud ones bloom.',
  '  float heat = clamp(u_earned + u_lift, 0.0, 1.4);',
  '',
  '  // ---- Pressure warp: shells push OUTWARD (drop expands the medium),',
  '  // accretion pulls INWARD during buildups; a slow churn keeps it alive.',
  '  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);',
  '  float outward = (0.0012 + 0.028 * u_drop + 0.06 * u_kick) * exp(-r * 1.1);',
  '  float inward = 0.016 * u_buildup;',
  '  vec2 churn = (vec2(fbm(c * 3.1 + t * 0.1), fbm(c * 3.1 + vec2(9.2, 4.4) - t * 0.08)) - 0.5)',
  '    * (0.003 + 0.012 * u_mid);',
  '',
  '  // Chromatic advection: shells travel outward with a per-channel radial',
  '  // stagger so persistent rings wear red/green/blue fringes. Unchanged',
  '  // hero mechanic from the parent.',
  '  float push = outward - inward;',
  '  float fringe = (0.0009 + 0.0045 * u_kick + 0.003 * u_drop) * u_bloom * exp(-r * 1.0);',
  '  vec3 medium;',
  '  medium.r = samplePrev(c, dir, push + fringe, aspect).r;',
  '  medium.g = samplePrev(c, dir, push, aspect).g;',
  '  medium.b = samplePrev(c, dir, push - fringe + churn.x, aspect).b;',
  '  medium *= u_decay;',
  '',
  '  // ---- The nebula medium (mids): density-churned, center-dark, drifting.',
  '  // EARNED SPARSITY: quiet embers thin the medium hard. A high density',
  '  // floor (subtracted then clamped) leaves only the brightest coals when',
  '  // heat is low; as heat rises the floor drops and the field fills in.',
  '  float density = fbm(c * (2.2 + 1.2 * u_mid) + vec2(t * 0.05, -t * 0.04));',
  '  float sparseCut = 0.6 - 0.5 * heat;',
  '  density = max(0.0, density - sparseCut) / max(0.15, 1.0 - sparseCut);',
  '  float centerDim = smoothstep(0.03, 0.35, r);',
  '  // dust is pulled toward its floor when quiet so the medium literally',
  '  // has less stuff in it, not just dimmer stuff.',
  '  float liveDust = u_dust * (0.25 + 0.75 * heat);',
  '  vec3 fresh = palette(density * 0.8 + u_centroid * 0.4 + t * 0.012 + u_phase * 0.15)',
  '    * pow(density, 2.0) * (0.1 + 1.1 * u_mid) * liveDust * centerDim * exp(-r * 1.4);',
  '  // Coal core: dull red at rest, whitening HARD only when the drop ignites',
  '  // it. At quiet it is a low ember glow, never white.',
  '  vec3 coal = vec3(0.5, 0.06, 0.03);',
  '  float heart = exp(-r * r * 240.0);',
  '  fresh += mix(coal, vec3(1.0, 0.97, 0.9), 0.85 * u_drop + 0.35 * u_kick)',
  '    * heart * (0.12 + 0.5 * u_earned + 1.3 * u_low + 1.6 * u_kick + 3.2 * u_drop);',
  '  // Electric crackle (highs): thin ridges arcing through the medium.',
  '  float ridge = abs(fbm(vec2(ang * 4.0 + t * 0.4, r * 6.0 - t * 0.3)) - 0.5);',
  '  float crackle = pow(max(0.0, 1.0 - ridge * 9.0), 6.0);',
  '  fresh += mix(vec3(0.45, 0.9, 1.0), palette(0.65), 0.3) * crackle',
  '    * smoothstep(0.1, 0.45, r) * (0.04 + 1.5 * u_high) * liveDust;',
  '  // Accretion streaks (buildups): the medium falling inward — brighter,',
  '  // sharper, reaching further so the buildup reads.',
  '  float streaks = pow(fbm(vec2(ang * 9.0, r * 2.5 + t * 0.9)), 3.0);',
  '  fresh += palette(0.3 + t * 0.02 + u_phase * 0.2) * streaks * u_buildup',
  '    * exp(-r * 1.1) * (1.6 + 0.8 * u_buildup);',
  '  medium += fresh * (1.0 - u_decay) * (2.4 + 2.2 * u_sustain);',
  '',
  '  // ---- Stamps.',
  '  // Kick SHELLS — the hero, untouched. Bright chromatic ring stamped into',
  '  // the medium, living in the feedback and expanding forever.',
  '  if (u_kick > 0.03) {',
  '    float base = 0.085 + 0.045 * u_kick;',
  '    float width = 34.0;',
  '    float shellR = exp(-pow((r - (base - 0.006)) * width, 2.0));',
  '    float shellG = exp(-pow((r - base) * width, 2.0));',
  '    float shellB = exp(-pow((r - (base + 0.006)) * width, 2.0));',
  '    vec3 ring = vec3(1.0, 0.5, 0.35) * shellR',
  '      + vec3(0.5, 1.0, 0.6) * shellG',
  '      + vec3(0.4, 0.7, 1.0) * shellB;',
  '    ring += vec3(1.0, 0.9, 0.8) * shellG * (0.4 + 0.8 * u_drop);',
  '    medium += ring * u_kick * (1.6 + 1.4 * u_bloom);',
  '  }',
  '  // Snare powder — the one discrete element.',
  '  if (u_snare > 0.03) {',
  '    vec2 q = c * 17.0;',
  '    vec2 cell = floor(q);',
  '    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);',
  '    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;',
  '    vec2 f = fract(q) - pos;',
  '    float star = exp(-dot(f, f) * 380.0) * step(0.982, hash(sc * 1.618 + 9.7));',
  '    medium += vec3(1.0, 0.95, 0.9) * star * u_snare * smoothstep(0.08, 0.2, r) * 1.4;',
  '  }',
  '',
  '  // Supernova lift on the drop; unmistakable ramp. Rides max(drop, sustain).',
  '  medium *= 0.72 + 0.7 * max(u_drop, u_sustain) - 0.06 * u_buildup;',
  '',
  '  // ---- EARNED-BRIGHTNESS MASTER GATE (the whole point of this tweak).',
  '  // One scalar over the already chroma-preserved medium: at rest it sits',
  '  // at the dark ember floor (u_floor, ~0.15); it opens toward 1 as charge',
  '  // and instant lift arrive. Drops blow it fully open, then it settles.',
  '  // Chroma-preserving: identical factor on all channels, so gating darkens',
  '  // the field without shifting any hue and cannot add a full-field flash.',
  '  float gate = u_floor + (1.0 - u_floor) * clamp(heat, 0.0, 1.0);',
  '  gate = max(gate, u_floor + (1.0 - u_floor) * u_lift);',
  '  medium *= gate;',
  '',
  '  // Chroma-preserving soft knee (scales all channels by one factor so',
  '  // hues hold). Applied AFTER the gate so highlights still roll off.',
  '  float m = max(medium.r, max(medium.g, medium.b));',
  '  if (m > 0.8) {',
  '    medium *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(max(medium, 0.0), 1.0);',
  '}',
].join('\n');

const params: PresetParam[] = [
  { id: 'dust', label: 'nebula density', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'palette 0-3 (ember/nebula/aurora/solar)', min: 0, max: 3, step: 1, default: 0 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1.2 },
  { id: 'bloom', label: 'shell bloom / chromatic fringe', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'drift', label: 'palette phase drift', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'floor', label: 'ember floor (quiet brightness)', min: 0.05, max: 0.4, step: 0.01, default: 0.15 },
  { id: 'earn', label: 'how fast brightness is earned', min: 0.3, max: 3, step: 0.05, default: 1 },
];

const g04NovaEmberPreset: VisualizerPreset = {
  id: 'g04-nova-ember',
  name: 'g04 nova-ember',
  hiRes: true,
  params,
  create: () => {
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Ember charge: slow-integrated sustained energy. Rises only under
    // sustained loudness, bleeds away in quiet — asymmetric so a lull goes
    // dark faster than a phrase brightens (the drama is in the fall).
    let earned = 0;
    let phase = 0;
    let lastTime = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const persistence = frame.params.persistence ?? 1.2;
        const drift = frame.params.drift ?? 1;
        const floor = frame.params.floor ?? 0.15;
        const earn = frame.params.earn ?? 1;

        // Earned charge. Target = sustained energy shaped so only genuinely
        // loud passages push it high (squared) with a small buildup credit.
        // Attack is slow (charge must be *earned* over ~2.5 s of loudness);
        // release is faster (~1.2 s) so quiet drops the field back to embers.
        const target = Math.min(1, energy * energy * 1.6 + smoothBuildup * 0.3);
        const attack = 1 - Math.exp((-dt / 2.5) * earn);
        const release = 1 - Math.exp((-dt / 1.2) * earn);
        earned += (target - earned) * (target > earned ? attack : release);
        earned = Math.min(1, Math.max(0, earned));

        // Instant lift: drops/kicks blow the gate open regardless of charge,
        // so a drop out of silence still lands full-force.
        const lift = Math.min(1, smoothDrop * 1.2 + frame.impulse.low * 0.5);

        // Phase drifts on a slow clock, nudged by mid energy.
        phase += dt * drift * (0.05 + 0.12 * frame.bands.mid);
        // Persistence eases slightly in quiet so embers fade instead of
        // smearing forever — the field genuinely goes dark, not just still.
        const baseDecay = 0.99 - 0.006 * energy - 0.004 * (1 - earned);
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: Math.min(1, energy * 1.4),
          u_centroid: frame.centroid,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 0,
          u_bloom: frame.params.bloom ?? 1,
          u_phase: phase,
          u_earned: earned,
          u_lift: lift,
          u_floor: floor,
        };
      },
    });
  },
};

export default g04NovaEmberPreset;
