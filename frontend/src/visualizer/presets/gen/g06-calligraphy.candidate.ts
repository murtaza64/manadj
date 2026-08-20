/**
 * g06-calligraphy (gen-6 NOVEL — sol-review concept "Stereo Calligraphy";
 * waveform-family fossil recombination). Raids g05-voyage-ribbon for the
 * wantsWave plumbing + waveform-uniform technique; raids the scope fossils
 * only to learn what NOT to do (no axes, no centered horizontal trace, no
 * gonio).
 *
 * The stereo waveform is a FORCE FIELD that draws two continuous calligraphic
 * strokes ACROSS a diagonal page. Left/right are spatial TRAJECTORIES, not two
 * scopes:
 *   - CORRELATION (⟨L·R⟩) braids the two strokes toward one another.
 *   - DIVERGENCE (1 - correlation) pulls them apart and opens negative space.
 *   - PHASE DISAGREEMENT (signed L−R energy) twists loops into the strokes.
 *
 * Ink dynamics:
 *   - LOW energy sets stroke WEIGHT + a solid PAPER-DEFORMATION pulse on
 *     kicks (a lit press into the page), gated on impulse.low.
 *   - MIDS set stroke CURVATURE (how much the nib bends).
 *   - HIGHS add edge FIBRILS and brief ink FLICKS — gated AWAY from kicks so
 *     they read as pen flicks, not spray/dust.
 *
 * Composition over phrases (ladder tier): establish → elaborate → compress →
 * then one heavy decisive DROP STROKE; ink keeps flowing on sustained energy.
 * Buildups raise pen velocity + saturated ink travel on a CALM luminance
 * floor. Section boundaries WASH / FOLD the page into a new writing direction.
 *
 * The page is a persistent canvas (feedback, chroma-preserving soft knee).
 * Never an oscilloscope: strokes run corner-to-corner on a rotating writing
 * axis, no centered horizontal trace, no axes, no radial layout, no dust.
 * Photosensitivity floor: no full-field flash, no rapid polarity inversion,
 * no white background; the drop stroke is a localized lit press.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

/** Waveform resolution handed to GLSL as uniform float[WAVE_N] (per channel). */
const WAVE_N = 96;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_flick;       // high-transient flick energy (gated off kicks)
uniform float u_centroid;
uniform float u_corr;         // stereo correlation -1..1 (braid strength)
uniform float u_diverge;      // 1 - |corr| (negative-space opening)
uniform float u_phase;        // signed L-R energy (loop twist)
uniform float u_drop;         // bass-weighted excitement (smoothed)
uniform float u_buildup;      // excitement without bass (pen velocity)
uniform float u_phraseStage;  // 0 establish .. 1 compress (within phrase)
uniform float u_dropStroke;   // decisive drop-stroke pulse 0..1 (decays)
uniform float u_wash;         // section wash/fold pulse 0..1 (decays)
uniform float u_writeAxis;    // page writing direction (radians, drifts + section jumps)
uniform float u_penVel;       // pen advance phase
uniform float u_weight;       // stroke weight slider
uniform float u_flow;         // ink flow slider
uniform float u_decay;
uniform float u_press;        // paper-deformation press amount (kick)
uniform float u_pressAge;
uniform float u_palPhase;     // ink palette phase (genome)
uniform float u_waveL[96];
uniform float u_waveR[96];

const float TWO_PI = 6.28318530718;
const float WAVE_COUNT = 96.0;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Constant-loop lookup (GLSL ES 1.0 forbids dynamic array indexing).
float waveLAt(int i) { float v = 0.0; for (int k = 0; k < 96; k++) { if (k == i) v = u_waveL[k]; } return v; }
float waveRAt(int i) { float v = 0.0; for (int k = 0; k < 96; k++) { if (k == i) v = u_waveR[k]; } return v; }

// Bright saturated ink palette; wide phase span so color travels along the
// stroke (never monochrome, never pastel).
vec3 ink(float t) {
  return vec3(0.5) + vec3(0.55) * cos(TWO_PI * (vec3(1.0, 0.85, 0.7) * t
    + vec3(0.0, 0.28, 0.6) + u_palPhase));
}

// Distance from p to the polyline of a stroke sampled along the writing axis.
// s is the parametric position along the page [0,1]; the stroke's lateral
// offset comes from the waveform. side = +1 (right) / -1 (left). braid pulls
// the two strokes together by correlation; diverge pushes them apart.
float strokeCoverage(vec2 p, vec2 axis, vec2 normal, float side, float t, out vec3 col) {
  // Sample the waveform at the projection of p onto the writing axis so the
  // stroke is a continuous ribbon across the page (NOT a time-scan scope).
  float along = clamp(dot(p, axis) + 0.5, 0.0, 1.0);
  float fpos = along * (WAVE_COUNT - 1.0);
  int i0 = int(floor(fpos));
  float wf = fract(fpos);
  float wl0 = waveLAt(i0), wl1 = waveLAt(i0 + 1 >= 96 ? 95 : i0 + 1);
  float wr0 = waveRAt(i0), wr1 = waveRAt(i0 + 1 >= 96 ? 95 : i0 + 1);
  float wl = mix(wl0, wl1, wf);
  float wr = mix(wr0, wr1, wf);
  float wv = side > 0.0 ? wr : wl;

  // Baseline: strokes sit OFF-CENTRE and OPEN with divergence (negative
  // space), never on a centred axis. Correlation braids them inward.
  float spread = (0.22 + 0.28 * u_diverge) * (0.7 + 0.3 * u_dropStroke);
  float baseOff = side * spread;
  float braid = -side * u_corr * 0.12 * sin(along * TWO_PI * (1.5 + 2.0 * u_mid) + u_penVel);

  // CURVATURE from mids; loop TWIST from phase disagreement.
  float curve = (0.05 + 0.5 * u_mid) * sin(along * TWO_PI * (0.8 + u_phraseStage)
      + u_penVel * 0.7 + side);
  float twist = u_phase * 0.18 * sin(along * TWO_PI * 3.0 + u_penVel * 1.3);

  // WEIGHT from low energy; the wave rides as the fine excursion of the nib.
  float off = baseOff + braid + curve + twist + wv * (0.10 + 0.06 * u_low);

  // Perpendicular distance from the fragment to the stroke ribbon.
  float lateral = dot(p, normal);
  float d = abs(lateral - off);

  // Nib WEIGHT: low energy thickens; drop stroke thickens hard; taper at ends.
  float taper = smoothstep(0.0, 0.12, along) * smoothstep(0.0, 0.12, 1.0 - along);
  float weight = (0.010 + 0.045 * u_low + 0.05 * u_dropStroke) * u_weight * taper;
  float cov = smoothstep(weight, weight * 0.2, d);

  // Edge FIBRILS from highs (fine hairs along the edge — not spray).
  float fib = 0.5 + 0.5 * sin(along * 120.0 + t * 5.0 + side * 3.0);
  cov += smoothstep(weight * 2.2, weight, d) * fib * u_high * 0.35;

  // Ink color travels along the stroke + with centroid; side tints hue.
  col = ink(along * 1.3 + t * 0.05 + u_centroid * 0.3 + side * 0.15);
  return cov * (0.5 + 0.7 * u_low + 0.4 * abs(wv));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;
  float t = u_time;

  // Rotating WRITING AXIS (diagonal, drifts + jumps on section washes) — the
  // stroke runs corner-to-corner, killing the scope's horizontal read.
  float ax = u_writeAxis;
  vec2 axis = vec2(cos(ax), sin(ax));
  vec2 normal = vec2(-sin(ax), cos(ax));

  // ---- Page persistence: gentle advection ALONG the writing axis (ink dries
  // as it flows), plus a paper-deformation PRESS ripple on kicks. Feedback +
  // chroma-preserving soft knee keep the composition continuous.
  float drift = 0.0025 * (0.5 + u_buildup) * (0.6 + 0.6 * u_drop);
  float pressWave = exp(-pow((dot(p, normal) - 0.0) * 3.0, 2.0))
      * exp(-u_pressAge * 3.0) * u_press;
  vec2 srcOff = -axis * drift + normal * pressWave * 0.02;
  vec2 src = uv + srcOff / vec2(aspect, 1.0);

  vec3 sampled = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 page = max(vec3(0.0), sampled * 1.22 - blur * 0.22) * u_decay;

  // ---- Draw the two calligraphic strokes.
  vec3 fresh = vec3(0.0);
  vec3 colL; float covL = strokeCoverage(p, axis, normal, -1.0, t, colL);
  vec3 colR; float covR = strokeCoverage(p, axis, normal, 1.0, t, colR);
  float flowGain = u_flow * (0.6 + 0.8 * max(u_drop, 0.5 * (u_low + u_mid)));
  fresh += colL * covL * flowGain;
  fresh += colR * covR * flowGain;

  // Braid weld: where correlation is high the strokes fuse into one dark line.
  float weld = covL * covR * clamp(u_corr, 0.0, 1.0);
  fresh += mix(colL, colR, 0.5) * weld * 1.5;

  // ---- Ink FLICKS: brief high-transient flecks placed ALONG the strokes
  // (not sprayed across the field) — gated away from kicks (u_flick).
  float flickField = hash(floor(uv * vec2(40.0, 40.0) + floor(t * 12.0)));
  float onStroke = max(covL, covR);
  float flick = step(0.94, flickField) * onStroke * u_flick;
  fresh += ink(0.6 + t * 0.1) * flick * (0.8 + 1.2 * u_high);

  // ---- Paper-deformation PRESS glow (kick): a lit lateral crease pressed
  // into the page (localized, rate-limited — photosensitivity floor).
  float crease = exp(-pow(dot(p, normal) * 6.0, 2.0)) * pressWave;
  fresh += ink(0.1 + u_centroid * 0.2) * crease * (0.4 + 0.6 * u_low);

  // ---- Section WASH: a diagonal ink wash sweeps the page as the writing
  // direction turns (never a full white field — a colored wash on the floor).
  float washPos = fract(u_wash * 1.4);
  float wash = exp(-pow((dot(p, axis) + 0.5 - washPos) * 3.0, 2.0));
  fresh += ink(dot(p, normal) * 0.5 + t * 0.08) * wash * u_wash * 0.6;

  // Compose. Buildups add saturated ink travel on a CALM luminance floor.
  page += fresh * (1.0 - u_decay) * (2.6 + 1.4 * max(u_drop, 0.4 * (u_low + u_mid)));
  page += ink(t * 0.03) * u_buildup * 0.05; // calm colored floor, not a flash

  // Small kick punch, gated + tiny (photosensitivity floor).
  page *= 1.0 + 0.06 * u_kick;

  // Grade toward saturated ink; keep a dark paper floor (no white background).
  vec3 grade = ink(0.25 + u_centroid * 0.2);
  page = mix(page, page * (0.5 + grade * 1.4), 0.22);
  page *= 0.82 + 0.4 * max(u_drop, 0.4 * (u_low + u_mid + u_high));

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(page.r, max(page.g, page.b));
  if (m > 0.85) {
    page *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(page, 0.0), 1.0);
}
`;

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

/** splitmix32-style scalar hash → stable [0,1). Same trackId ⇒ same ink. */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

const candidate: VisualizerPreset = {
  id: 'g06-calligraphy',
  name: 'g06 calligraphy',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'weight', label: 'stroke weight', min: 0.4, max: 2.5, step: 0.05, default: 1 },
    { id: 'flow', label: 'ink flow', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'penSpeed', label: 'pen velocity', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'ink', label: 'ink hue phase', min: 0, max: 1, step: 0.02, default: 0 },
  ],
  create: () => {
    let lastTime = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothCorr = 0;
    let smoothPhase = 0;
    let penVel = 0;
    let writeAxis = 0.6;
    let flick = 0;
    let press = 0;
    let pressAge = 999;
    let dropStroke = 0;
    let wash = 0;
    let lastSectionIndex = -1;
    let lastPhraseIndex = -1;
    const waveL = new Float32Array(WAVE_N);
    const waveR = new Float32Array(WAVE_N);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const penSpeed = frame.params.penSpeed ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // ---- Downsample the stereo waveform (per channel) + derive stereo
        // correlation / divergence / phase from the two channels directly.
        const w = frame.wave;
        let corr = 0;
        let phaseSig = 0;
        if (w && w.left.length > 0 && w.right.length > 0) {
          const L = w.left;
          const R = w.right;
          const n = Math.min(L.length, R.length);
          const step = n / WAVE_N;
          for (let i = 0; i < WAVE_N; i++) {
            const idx = Math.min(n - 1, Math.floor(i * step));
            waveL[i] = L[idx];
            waveR[i] = R[idx];
          }
          // Pearson-ish correlation and signed L-R energy over the snapshot.
          let dotLR = 0;
          let magL = 0;
          let magR = 0;
          let energyL = 0;
          let energyR = 0;
          for (let i = 0; i < n; i++) {
            const l = L[i];
            const r = R[i];
            dotLR += l * r;
            magL += l * l;
            magR += r * r;
            energyL += Math.abs(l);
            energyR += Math.abs(r);
          }
          const denom = Math.sqrt(magL * magR) + 1e-6;
          corr = dotLR / denom; // -1 anti-phase .. 1 mono
          phaseSig = (energyR - energyL) / (energyR + energyL + 1e-6);
        } else {
          waveL.fill(0);
          waveR.fill(0);
        }
        smoothCorr += (corr - smoothCorr) * smoothAlpha;
        smoothPhase += (phaseSig - smoothPhase) * smoothAlpha;
        const diverge = 1 - Math.abs(smoothCorr);

        // Bass-weighted, smoothed drop signal (trend has no drop field).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);

        // ---- Ink FLICKS: high transients ONLY, gated AWAY from kicks so they
        // read as pen flicks, not spray. Suppress while a kick is landing.
        const kickGate = Math.max(0, 1 - frame.impulse.low * 3);
        const flickHit = frame.impulse.high * kickGate;
        flick = Math.max(flickHit, flick - dt * 4);

        // ---- Paper-deformation PRESS on kicks (gated on impulse.low).
        pressAge += dt;
        if (frame.impulse.low > 0.35 && pressAge > 0.1) {
          pressAge = 0;
          press = Math.min(1, frame.impulse.low * 1.3);
        }
        press = Math.max(press - dt * 2.5, 0);

        // ---- Pen velocity rises in buildups; BPM-locked drift otherwise.
        const beatHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 1.2;
        penVel += dt * beatHz * (0.8 + 1.4 * smoothBuildup + 0.6 * energy) * penSpeed;

        // ---- Phrase composition + section wash via ladder-correct ordinal.
        let phraseStage = 0;
        let sectionIndex = lastSectionIndex;
        let phraseIndex = lastPhraseIndex;
        if (frame.beat) {
          const barOrdinal = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((barOrdinal % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phraseStage = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          sectionIndex = Math.floor(barOrdinal / SECTION_BARS);
          phraseIndex = Math.floor(barOrdinal / PHRASE_BARS);
        } else {
          phraseStage = 0.5 - 0.5 * Math.cos(frame.time * 0.12);
        }

        // Decisive DROP STROKE at each phrase boundary (heavy, then decays).
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          dropStroke = Math.max(dropStroke, 0.6 + 0.4 * smoothDrop);
        }
        lastPhraseIndex = phraseIndex;
        dropStroke = Math.max(0, dropStroke - dt / 0.9);

        // Section boundary: wash/fold the page + turn the writing direction.
        if (sectionIndex !== lastSectionIndex && lastSectionIndex >= 0) {
          wash = 1;
          // Jump the writing axis to a new diagonal (never axis-aligned).
          writeAxis += 0.6 + splitmix(sectionIndex) * 1.4;
        }
        lastSectionIndex = sectionIndex;
        wash = Math.max(0, wash - dt / 1.3);
        // Slow drift so the page is never a static scope.
        writeAxis += dt * 0.05 * (0.5 + smoothBuildup);

        // Genome ink hue: stable per dominant trackId, plus the slider.
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }
        const trackId = dom?.trackId ?? null;
        const seedKey =
          trackId !== null
            ? trackId
            : Math.floor((frame.centroid * 331 + frame.spread * 271) * 101);
        const palPhase = ((frame.params.ink ?? 0) + splitmix(seedKey)) * 6.28318;

        // Decay: dry-but-persistent page; slower in buildups (ink lingers).
        const baseDecay = 0.968 - 0.008 * energy - 0.006 * smoothBuildup;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_flick: flick,
          u_centroid: frame.centroid,
          u_corr: smoothCorr,
          u_diverge: diverge,
          u_phase: smoothPhase,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_phraseStage: Math.min(1, phraseStage),
          u_dropStroke: Math.max(0, Math.min(1, dropStroke)),
          u_wash: Math.max(0, Math.min(1, wash)),
          u_writeAxis: writeAxis,
          u_penVel: penVel,
          u_weight: frame.params.weight ?? 1,
          u_flow: frame.params.flow ?? 1,
          u_decay: Math.min(0.99, 1 - (1 - baseDecay) / persistence),
          u_press: press,
          u_pressAge: pressAge,
          u_palPhase: palPhase,
          u_waveL: waveL,
          u_waveR: waveR,
        };
      },
    });
  },
};

export default candidate;
