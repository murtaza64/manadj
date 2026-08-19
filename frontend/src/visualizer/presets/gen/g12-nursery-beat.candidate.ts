/**
 * g12-nursery-beat (gen-12 beat RESPONSIVENESS tweak).
 *
 * Parents copied wholesale (post-fix): g09-nursery-spectra (the superset — the
 * raymarched/FBM stellar nursery: drifting gas, iridescent rim shimmer,
 * magnetic filaments, protostar cores, spectral gas hue family / breadth /
 * saturation, section-boundary supernova recolor to the spectral complement)
 * which inherits g06-nursery's engine. The gas medium, rim shimmer, filaments,
 * feedback-as-emission-memory and the supernova recolor are UNCHANGED.
 *
 * ONE mechanic is replaced — the protostar IGNITION SCHEDULE. In the parents,
 * kicks fired a bass-gated pseudo-random subset of cores. gen-12 puts the
 * ignitions onto the BEAT GRID as a CONSTELLATION SEQUENCER:
 *
 *   Each BEAT ignites the NEXT star of a genome-chosen CONSTELLATION FIGURE —
 *   one star per beat, marching through a fixed set of slot positions. The
 *   figure COMPLETES across a 4-bar phrase (the slot count is set so the last
 *   slot lands near the phrase end), and on each DOWNBEAT the ignited stars so
 *   far are CONNECTED with drawn LINES — a constellation literally forms as the
 *   bar/phrase progresses, then FADES back into the gas as the phrase rolls
 *   over and a fresh figure begins. Bar position is readable off the partial
 *   figure (how many stars are lit + how many lines drawn).
 *
 *   KICK = that beat's ignition is MASSIVE (a big bright core + strong front).
 *   SNARE = a SHOOTING STAR crosses (one, discrete — a streaking trail).
 *   SECTION = supernova recolor (parent).
 *   DROP = the WHOLE constellation ignites at once + gas churn max, riding
 *   max(drop, energy).
 *
 * Standing law: docs/visualizer-ga.md — photosensitivity floor (ignitions are
 * localized, not full-field; the drop all-ignite is a swell), feedback
 * contraction (memory gain capped < 1; drama in the fresh injection), MOTION
 * SMOOTHNESS (gas convection rides bandsSlow.mid). Chroma-preserving soft knee.
 * Phrase/section via beat.ladderBarIndex ?? beat.barIndex.
 *
 * Contract-safe: default-export VisualizerPreset, GL feedback via
 * createGlRenderer, GLSL ES 1.0, NO backticks in the shader.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

// Constellation slots: 8 stars per figure. One ignites per beat; a 4-bar phrase
// at 4 beats/bar has 16 beats, so the 8-slot figure completes twice over a
// phrase (or once for the drawn-line pass, re-igniting brighter). Kept a
// compile-time constant so the GLSL loops are constant-bounded.
const STAR_COUNT = 8;
// Drawn lines connect consecutive lit stars: up to STAR_COUNT - 1 segments.
const LINE_COUNT = STAR_COUNT - 1;

const FRAGMENT = [
  'precision highp float;',
  'uniform sampler2D u_prev;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_low;',
  'uniform float u_mid;',
  'uniform float u_midSlow;',
  'uniform float u_high;',
  'uniform float u_kick;',
  'uniform float u_snare;',
  'uniform float u_centroid;',
  'uniform float u_spread;',
  'uniform float u_drop;',
  'uniform float u_sustain;',
  'uniform float u_buildup;',
  'uniform float u_phrase;',
  'uniform float u_novaMix;',
  'uniform float u_nova;',
  'uniform float u_novaAge;',
  'uniform vec2 u_novaPos;',
  'uniform float u_seed;',
  'uniform float u_density;',
  'uniform float u_filaments;',
  'uniform float u_drift;',
  'uniform float u_glow;',
  'uniform float u_hueOld;',
  'uniform float u_hueNew;',
  'uniform float u_breadth;',
  'uniform float u_sat;',
  // Constellation stars: xy = slot position (aspect-space), z = ignition 0..1.
  'uniform vec3 u_stars[' + STAR_COUNT + '];',
  // Star fronts: x = frontAge, y = frontAmp, z = per-star travel offset.
  'uniform vec3 u_starFront[' + STAR_COUNT + '];',
  // Drawn connecting lines: strength 0..1 for each segment (i -> i+1).
  'uniform float u_lineOn[' + LINE_COUNT + '];',
  // Shooting star (snare): xy = current head position, z = life 0..1 (decays),
  // and u_shootDir = travel direction.
  'uniform vec3 u_shoot;',
  'uniform vec2 u_shootDir;',
  '',
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';',
  'const float TWO_PI = 6.28318530718;',
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
  '  for (int i = 0; i < 5; i++) {',
  '    v += amp * noise(p);',
  '    p = p * 2.02 + vec2(19.1, 7.3);',
  '    amp *= 0.5;',
  '  }',
  '  return v;',
  '}',
  '',
  'float tri(float x) { return abs(fract(x) - 0.5); }',
  '',
  'vec3 hsv2rgb(float h, float s, float v) {',
  '  vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);',
  '  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);',
  '}',
  '',
  'float gasHueCenter() {',
  '  float d = u_hueNew - u_hueOld;',
  '  d -= floor(d + 0.5);',
  '  return u_hueOld + d * clamp(u_novaMix, 0.0, 1.0);',
  '}',
  '',
  'vec3 gasPalette(float t) {',
  '  float hueC = gasHueCenter();',
  '  float hue = hueC + (t - 0.5) * u_breadth;',
  '  float sat = clamp(u_sat, 0.12, 1.0);',
  '  return hsv2rgb(hue, sat, 1.0);',
  '}',
  '',
  'vec3 iridescent(float phase) {',
  '  return 0.55 + 0.45 * cos(TWO_PI * (phase + vec3(0.0, 0.33, 0.66)));',
  '}',
  '',
  // Distance from point p to segment a-b (for drawn constellation lines).
  'float segDist(vec2 p, vec2 a, vec2 b) {',
  '  vec2 ab = b - a;',
  '  float len2 = max(dot(ab, ab), 1e-5);',
  '  float h = clamp(dot(p - a, ab) / len2, 0.0, 1.0);',
  '  return length(p - a - ab * h);',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float aspect = u_res.x / u_res.y;',
  '  vec2 c = (uv - vec2(0.32, 0.38)) * vec2(aspect, 1.0);',
  '  float t = u_time * u_drift;',
  '  vec2 px = 1.0 / u_res;',
  '',
  // Feedback: slow emission memory only (parent).
  '  vec3 prev = texture2D(u_prev, uv).rgb;',
  '  vec3 blur = (texture2D(u_prev, uv + vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, uv - vec2(px.x, 0.0)).rgb',
  '    + texture2D(u_prev, uv + vec2(0.0, px.y)).rgb',
  '    + texture2D(u_prev, uv - vec2(0.0, px.y)).rgb) * 0.25;',
  '  vec3 memory = max(vec3(0.0), prev * 1.06 - blur * 0.06);',
  '  float memGain = clamp(0.60 + 0.30 * u_glow, 0.0, 0.93);',
  '  vec3 col = memory * memGain;',
  '',
  // Gas volume (parent).
  '  float compress = 1.0 + 0.7 * u_buildup + 0.25 * u_phrase;',
  '  vec2 warp = vec2(',
  '    fbm(c * 1.6 + vec2(0.0, t * 0.18)),',
  '    fbm(c * 1.6 + vec2(5.2, 3.1) - t * 0.14)',
  '  ) - 0.5;',
  '  float convection = (0.25 + 0.9 * u_midSlow + 0.4 * u_sustain);',
  '  vec2 gp = c * compress + warp * convection * 0.55;',
  '  float shell = fbm(gp * 1.5 + vec2(t * 0.05, -t * 0.03));',
  '  float pillar = fbm(vec2(gp.x * 2.4, gp.y * 1.1) + vec2(-t * 0.04, t * 0.02));',
  '  float gas = pow(clamp(shell * 0.6 + pillar * 0.7, 0.0, 1.4), 1.7);',
  '  gas *= (0.5 + 1.1 * u_density);',
  '  float palT = shell * (0.6 + 0.9 * u_spread) + gp.y * 0.20 + gp.x * 0.08 + t * 0.015;',
  '  vec3 gasColor = gasPalette(palT);',
  '  float gasGain = 0.05 + 0.6 * u_mid + 0.35 * u_sustain + 0.25 * u_drop;',
  '  col += gasColor * gas * gasGain;',
  '',
  // Iridescent rim shimmer (parent).
  '  float gx = fbm(gp * 1.5 + vec2(px.x * 40.0, 0.0)) - shell;',
  '  float gy = fbm(gp * 1.5 + vec2(0.0, px.y * 40.0)) - shell;',
  '  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);',
  '  float shimPhase = shell * 2.0 + u_centroid * 0.8 + t * 0.4 + u_high * 3.0;',
  '  vec3 rim = iridescent(shimPhase);',
  '  float shimmer = edge * (0.4 + 0.6 * sin(t * 9.0 + shell * 30.0));',
  '  col += rim * shimmer * (0.05 + 1.6 * u_high) * (0.4 + 0.6 * gas);',
  '',
  // Magnetic filaments (parent).
  '  float fil = 0.0;',
  '  float famp = 1.0;',
  '  vec2 fp = c * 1.0;',
  '  for (int i = 0; i < 3; i++) {',
  '    float ridge = fp.y * 3.0 + sin(fp.x * 4.0 + t * 1.3) * 1.2 + tri(fp.x * 2.0 - t * 0.5) * 3.0;',
  '    float thread = 1.0 - smoothstep(0.0, 0.10, abs(fract(ridge) - 0.5));',
  '    fil += thread * famp;',
  '    famp *= 0.55;',
  '    fp = fp * 1.9 + vec2(1.7, -0.9);',
  '    fp = mat2(0.80, -0.60, 0.60, 0.80) * fp;',
  '  }',
  '  fil = pow(clamp(fil, 0.0, 1.0), 1.5);',
  '  float filRipple = 0.6 + 0.4 * sin(t * 12.0 + c.x * 20.0);',
  '  vec3 filColor = mix(iridescent(u_centroid + t * 0.15), gasPalette(0.7 + t * 0.05), 0.55);',
  '  col += filColor * fil * filRipple * u_filaments * (0.08 + 1.7 * u_high) * (0.5 + 0.5 * gas);',
  '',
  // ---- CONSTELLATION DRAWN LINES: connect consecutive lit stars. Each segment
  // is gated by u_lineOn[i] (drawn on the downbeat once both endpoints are lit).
  // Thin glowing line in the current gas family.
  '  float lineMass = 0.0;',
  '  for (int i = 0; i < ' + LINE_COUNT + '; i++) {',
  '    float on = u_lineOn[i];',
  '    if (on < 0.01) continue;',
  '    vec2 a = u_stars[i].xy;',
  '    vec2 b = u_stars[i + 1].xy;',
  '    float d = segDist(c, a, b);',
  '    float line = exp(-d * d * 900.0);',
  '    lineMass += line * on;',
  '  }',
  '  vec3 lineCol = mix(gasPalette(0.45), vec3(0.9, 0.95, 1.0), 0.4);',
  '  col += lineCol * lineMass * (0.5 + 0.8 * u_sustain);',
  '',
  // ---- CONSTELLATION STARS (protostar ignitions, one per beat). Each lit slot
  // is a hot core + bloom; kick made its ignition massive (u_stars[i].z high).
  '  for (int i = 0; i < ' + STAR_COUNT + '; i++) {',
  '    vec3 star = u_stars[i];',
  '    vec3 fr = u_starFront[i];',
  '    vec2 d = c - star.xy;',
  '    float dist = length(d);',
  '    float ignite = star.z;',
  '    if (ignite < 0.01 && fr.y < 0.01) continue;',
  '    vec3 familyHue = gasPalette(0.35 + fr.z * u_breadth);',
  '    float hot = exp(-dist * dist * (900.0 - 500.0 * ignite));',
  '    float bloom = exp(-dist * (10.0 - 4.0 * ignite));',
  '    vec3 coreHue = mix(LOW, vec3(1.0, 0.95, 0.85), 0.4 + 0.6 * ignite);',
  '    coreHue = mix(coreHue, familyHue, 0.45);',
  '    col += coreHue * hot * (0.4 + 1.3 * ignite);',
  '    col += mix(coreHue, familyHue, 0.5) * bloom * (0.10 + 0.55 * ignite);',
  '    float frontR = 0.02 + fr.x * 0.85;',
  '    float front = exp(-pow((dist - frontR) * 8.0, 2.0)) * exp(-fr.x * 2.2) * fr.y;',
  '    col += mix(familyHue, gasColor, 0.6) * front * (0.5 + 2.0 * gas) * 1.0;',
  '  }',
  '',
  // ---- SHOOTING STAR (snare): one discrete streak crossing the field. A bright
  // head with a trailing tail along u_shootDir, life decays.
  '  if (u_shoot.z > 0.01) {',
  '    vec2 hd = c - u_shoot.xy;',
  '    float along = dot(hd, u_shootDir);',
  '    float across = length(hd - u_shootDir * along);',
  // Head glow + tail behind the head (along < 0 side).
  '    float head = exp(-dot(hd, hd) * 700.0);',
  '    float tail = exp(-across * across * 1600.0) * smoothstep(0.0, -0.35, along) * exp(along * 4.0);',
  '    vec3 shootCol = mix(vec3(1.0), gasPalette(0.6), 0.35);',
  '    col += shootCol * (head * 1.4 + tail * 0.9) * u_shoot.z;',
  '  }',
  '',
  // Supernova (parent).
  '  if (u_nova > 0.001) {',
  '    vec2 nd = c - u_novaPos;',
  '    float ndist = length(nd);',
  '    float shellR = 0.03 + u_novaAge * 1.4;',
  '    float shellRing = exp(-pow((ndist - shellR) * 6.0, 2.0)) * u_nova;',
  '    vec3 novaHue = gasPalette(0.2 + ndist * 0.4 + t * 0.05);',
  '    col += novaHue * shellRing * (0.8 + 1.5 * gas);',
  '    float wake = smoothstep(shellR, shellR - 0.4, ndist) * u_nova * 0.15;',
  '    col += novaHue * gas * wake;',
  '  }',
  '',
  '  col *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.06 * u_buildup;',
  '  vec3 grade = gasPalette(0.5);',
  '  col = mix(col, col * (0.45 + grade * 1.5), 0.20);',
  '',
  '  float m = max(col.r, max(col.g, col.b));',
  '  if (m > 0.85) {',
  '    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
  '}',
].join('\n');

interface Star {
  x: number;
  y: number;
  ignition: number;
  frontAge: number;
  frontAmp: number;
  travel: number;
}

const candidate: VisualizerPreset = {
  id: 'g12-nursery-beat',
  name: 'g12 nursery-beat',
  hiRes: true,
  params: [
    { id: 'density', label: 'gas density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'filaments', label: 'filament gain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'drift', label: 'drift speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'glow', label: 'emission memory', min: 0, max: 1.5, step: 0.05, default: 0.9 },
  ],
  create: () => {
    let lastTime = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSustain = 0;
    // Supernova state (parent).
    let nova = 0;
    let novaAge = 999;
    let novaPos: [number, number] = [0, 0];
    // Phrase / section tracking.
    let lastBarInPhrase = -1;
    let phraseStartBar = 0;
    let lastSection = -1;

    // Spectral color state (parent).
    let slowCentroid = 0.5;
    let hueNew = 0.5;
    let hueOld = 0.5;
    let novaMix = 1;
    let smoothBreadth = 0.3;
    let smoothSat = 0.85;
    let sectionHueMean = 0.5;

    const centroidToHue = (cn: number): number => {
      const c = Math.min(1, Math.max(0, cn));
      return 0.02 + 0.5 * c;
    };

    const rand = (seed: number) => {
      const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    // --- CONSTELLATION FIGURE: a genome-chosen set of STAR_COUNT slot positions
    // (off-axis, biased toward the pillar region). Re-rolled each new phrase so
    // a fresh figure forms. `figureGen` seeds the layout.
    const layoutFigure = (gen: number): Star[] => {
      const out: Star[] = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        out.push({
          x: (rand(i * 3.7 + gen * 11.3) - 0.4) * 1.4,
          y: (rand(i * 5.1 + gen * 7.9) - 0.35) * 1.1,
          ignition: 0,
          frontAge: 999,
          frontAmp: 0,
          travel: rand(i * 2.3 + gen * 4.1),
        });
      }
      return out;
    };
    let figureGen = 0;
    let stars: Star[] = layoutFigure(0);
    // How many slots are lit so far in the current figure (advances per beat).
    let litCount = 0;
    // Drawn line strengths (segment i -> i+1). Drawn on the downbeat, fade out.
    const lineOn = new Float32Array(LINE_COUNT);
    // Beat tracking.
    let prevBeatInBar: number | null = null;
    let freeBeatPhase = 0;

    // Shooting star (snare): head position, direction, life.
    let shootX = 0;
    let shootY = 0;
    let shootDirX = 1;
    let shootDirY = 0;
    let shootLife = 0;
    let shootAge = 999;

    const starArr = new Float32Array(STAR_COUNT * 3);
    const frontArr = new Float32Array(STAR_COUNT * 3);

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
        const motion = frame.bandsSlow ?? bands;

        const lowPresence = Math.min(1, Math.max(0, (bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustainTarget = Math.min(1, energy * 1.4);
        smoothSustain += (sustainTarget - smoothSustain) * alpha;

        // Spectral color (parent).
        const slowAlpha = 1 - Math.exp(-dt / 1.0);
        slowCentroid += (frame.centroid - slowCentroid) * slowAlpha;
        const paletteAlpha = 1 - Math.exp(-dt / 0.6);
        const breadthTarget = 0.05 + 0.55 * Math.min(1, Math.max(0, frame.spread));
        smoothBreadth += (breadthTarget - smoothBreadth) * paletteAlpha;
        const satTarget = 0.25 + 0.75 * (1 - Math.min(1, Math.max(0, frame.flatness)));
        smoothSat += (satTarget - smoothSat) * paletteAlpha;

        const trackedHue = centroidToHue(slowCentroid);
        if (novaMix >= 1) {
          hueNew += (trackedHue - hueNew) * slowAlpha;
          hueOld = hueNew;
        }
        sectionHueMean += (hueNew - sectionHueMean) * (1 - Math.exp(-dt / 2.0));

        // Phrase / section tiers.
        const barIndex = beat ? (beat.ladderBarIndex ?? beat.barIndex) : 0;
        const section = Math.floor(barIndex / 16);
        const barInPhrase = ((barIndex % 4) + 4) % 4;
        let newPhrase = false;
        if (barInPhrase !== lastBarInPhrase) {
          if (barInPhrase === 0) {
            phraseStartBar = barIndex;
            newPhrase = true;
          }
          lastBarInPhrase = barInPhrase;
        }
        const barPhase = beat ? beat.barPhase : 0;
        const phraseProgress = Math.min(1, ((barIndex - phraseStartBar) + barPhase) / 4);

        // NEW PHRASE -> re-roll the constellation figure; it forms afresh.
        if (newPhrase && lastSection >= 0) {
          figureGen += 1;
          stars = layoutFigure(figureGen);
          litCount = 0;
          for (let i = 0; i < LINE_COUNT; i++) lineOn[i] = 0;
        }

        // SECTION BOUNDARY -> SUPERNOVA (parent): detonate a slot, recolor.
        if (section !== lastSection) {
          if (lastSection >= 0) {
            hueOld = hueNew;
            const complement = (((sectionHueMean + 0.5) % 1) + 1) % 1;
            hueNew = complement;
            novaMix = 0;
            sectionHueMean = hueNew;
            nova = 1;
            novaAge = 0;
            const detonate = stars[0] ?? { x: 0, y: 0 };
            novaPos = [detonate.x, detonate.y];
          }
          lastSection = section;
        }
        novaMix = Math.min(1, novaMix + dt / 1.2);
        novaAge += dt;
        nova = Math.max(0, nova - dt / 1.6);

        // ---- BEAT DETECTION.
        let beatCrossed = false;
        let downbeat = false;
        if (beat) {
          const bi = beat.beatInBar;
          if (prevBeatInBar !== null && bi !== prevBeatInBar) {
            beatCrossed = true;
            downbeat = bi === 0;
          }
          prevBeatInBar = bi;
        } else {
          const prev = freeBeatPhase;
          freeBeatPhase += dt * (120 / 60);
          if (Math.floor(freeBeatPhase) !== Math.floor(prev)) {
            beatCrossed = true;
            downbeat = Math.floor(freeBeatPhase) % 4 === 0;
          }
        }

        const kick = impulse.low;
        const kickHit = kick > 0.28;

        // ---- CONSTELLATION SEQUENCER: one ignition per beat.
        if (beatCrossed) {
          const slot = litCount % STAR_COUNT;
          const st = stars[slot];
          // Ignite this slot. KICK = MASSIVE ignition (bigger core + front).
          const massive = kickHit ? 1.0 : 0.55;
          st.ignition = Math.max(st.ignition, massive);
          st.frontAge = 0;
          st.frontAmp = Math.min(1, (kickHit ? kick * 1.4 : 0.7));
          litCount += 1;
          // On the DOWNBEAT, connect the stars lit so far with drawn lines.
          if (downbeat) {
            const n = Math.min(litCount, STAR_COUNT);
            for (let i = 0; i < n - 1; i++) lineOn[i] = 1;
          }
        }

        // ---- DROP: the WHOLE constellation ignites at once + all lines drawn.
        const dropAll = Math.max(smoothDrop, energy);
        if (dropAll > 0.55) {
          for (let i = 0; i < STAR_COUNT; i++) {
            stars[i].ignition = Math.max(stars[i].ignition, dropAll);
          }
          for (let i = 0; i < LINE_COUNT; i++) lineOn[i] = Math.max(lineOn[i], dropAll);
        }

        // Ignition + front decay; lines fade back into the gas over ~1.2s.
        for (let i = 0; i < STAR_COUNT; i++) {
          const st = stars[i];
          // Ignition holds briefly then eases down (fades into the gas).
          st.ignition = Math.max(0, st.ignition - dt / 1.4);
          st.frontAge += dt;
          starArr[i * 3 + 0] = st.x;
          starArr[i * 3 + 1] = st.y;
          starArr[i * 3 + 2] = st.ignition;
          frontArr[i * 3 + 0] = st.frontAge;
          frontArr[i * 3 + 1] = st.frontAmp;
          frontArr[i * 3 + 2] = st.travel;
        }
        for (let i = 0; i < LINE_COUNT; i++) {
          lineOn[i] = Math.max(0, lineOn[i] - dt / 1.2);
        }

        // ---- SHOOTING STAR (snare): one discrete streak. Retrigger on a snare
        // (rate-limited). It crosses the field along a fresh random direction.
        shootAge += dt;
        const snare = impulse.mid;
        if (snare > 0.3 && shootAge > 0.25) {
          shootAge = 0;
          const ang = Math.random() * Math.PI * 2;
          shootDirX = Math.cos(ang);
          shootDirY = Math.sin(ang);
          // Start off one edge, cross toward the other.
          shootX = -shootDirX * 0.9 + (Math.random() - 0.5) * 0.4;
          shootY = -shootDirY * 0.7 + (Math.random() - 0.5) * 0.4;
          shootLife = Math.min(1, snare * 1.3);
        }
        // Advance the head and decay life.
        const shootSpeed = 2.2;
        shootX += shootDirX * shootSpeed * dt;
        shootY += shootDirY * shootSpeed * dt;
        shootLife = Math.max(0, shootLife - dt / 0.5);

        return {
          u_time: frame.time,
          u_low: bands.low,
          u_mid: bands.mid,
          u_midSlow: motion.mid,
          u_high: bands.high,
          u_kick: impulse.low,
          u_snare: impulse.mid,
          u_centroid: frame.centroid,
          u_spread: frame.spread,
          u_drop: smoothDrop,
          u_sustain: smoothSustain,
          u_buildup: smoothBuildup,
          u_phrase: phraseProgress,
          u_novaMix: novaMix,
          u_nova: nova,
          u_novaAge: novaAge,
          u_novaPos: novaPos,
          u_seed: Math.floor(frame.time * 20),
          u_density: frame.params.density ?? 1,
          u_filaments: frame.params.filaments ?? 1,
          u_drift: frame.params.drift ?? 1,
          u_glow: frame.params.glow ?? 0.9,
          u_hueOld: hueOld,
          u_hueNew: hueNew,
          u_breadth: smoothBreadth,
          u_sat: smoothSat,
          u_stars: starArr,
          u_starFront: frontArr,
          u_lineOn: lineOn,
          u_shoot: [shootX, shootY, shootLife],
          u_shootDir: [shootDirX, shootDirY],
        };
      },
    });
  },
};

export default candidate;
