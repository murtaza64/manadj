/**
 * g09-organ (gen-9 NOVEL): a COLOR ORGAN. The purest embodiment of
 * spectrally-informed color — the frame IS the spectrum. Twenty-four flowing
 * luminous ribbons cross the frame DIAGONALLY, one per spectral band, ordered
 * by frequency (low bands lower-left, high bands upper-right). Each ribbon
 * PERMANENTLY OWNS ITS HUE: a hue wheel walked across the 24 bands so a
 * musician could read the mix off the picture — low bass ribbon red, mids
 * green, brilliance ribbon violet.
 *
 * Band loudness lives in three couplings of ONE ribbon (never a bar chart):
 *   - WIDTH: quiet band = thin dark thread; loud = broad current.
 *   - LUMINOSITY: quiet = dim; loud = blazing.
 *   - FLOW SPEED: quiet ribbons crawl; loud ribbons race along their length.
 *
 * Meter / dynamics:
 *   - KICK = ONE solid transverse PRESSURE WAVE — a single physical bulge that
 *     travels ACROSS the diagonal, bending ALL 24 ribbons together (one event,
 *     not 24). Gated on impulse.low so it never reads as "kick powder"; the
 *     whole-field brightness bump stays tiny (photosensitivity floor).
 *   - SNARE = the loudest mid/high ribbon WHIPS (a lateral crack on that one
 *     ribbon), mid/high only.
 *   - BEAT = a faint TICK races along the downbeat ribbon.
 *   - PHRASE (ladder tier) = the ribbon WEAVE pattern hard-cuts (quantized) —
 *     parallel / interleaved / braided / fanned.
 *   - SECTION = the hue wheel ROTATES ONE NOTCH: every ribbon recolors at once
 *     (palette swap as spectacle), the ownership order preserved.
 *   - DROP = the ribbons BRAID into ONE broad full-spectrum RIVER riding
 *     max(drop, energy); buildup = ribbons TAUTEN + compress toward the
 *     diagonal axis.
 *
 * REFINEMENT (human note, in place): "in practice its just always green and
 * red, very little blue. green quite overpowering during drops". Three fixes,
 * see the tagged comments below:
 *   1. HUE WHEEL rotated onto the golden-ratio conjugate (bandHue) so adjacent
 *      bands own distant hues — a cluster of loud (low/mid) bands or a drop now
 *      lights a full rainbow, not one red->green region. This scatter also caps
 *      any single hue family's width share: energy-dense contiguous bands can
 *      no longer share a hue neighbourhood, so no one family can flood the frame.
 *   2. PER-RIBBON PROMINENCE normalization (spectrum fill): log-compressed band
 *      scaling + a per-band adaptive ceiling so quiet high (blue/violet) bands
 *      still read instead of being swamped by the loud low/mid ones.
 *   3. GRADE scattered onto the same golden wheel so the whole-field tint isn't
 *      pinned to the red->green arc either.
 *
 * Dark floor, saturated ribbons, NO dust, non-centered (diagonal composition).
 * Persistence via feedback with a chroma-preserving soft knee; contractive
 * (whole-field field*decay with decay < 1, drama in the fresh injection
 * bounded by (1 - decay)). GL plumbing template: g06-loom (u_spectrum[24] in
 * lockstep, constant-loop indexing per GLSL ES 1.0).
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;

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
uniform float u_hat;
uniform float u_centroid;
uniform float u_drop;         // bass-weighted excitement (smoothed)
uniform float u_buildup;      // excitement without bass (tautness)
uniform float u_energy;       // overall band energy (sustained loudness)
uniform float u_braid;        // 0..1 ribbons -> single full-spectrum river
uniform float u_decay;
uniform float u_weave;        // 0 parallel,1 interleave,2 braid,3 fan (blended)
uniform float u_weaveMix;     // 0..1 phrase weave hard-cut settle
uniform float u_hueOffset;    // section hue-wheel rotation (turns, quantized)
uniform float u_kickAge;      // seconds since the pressure wave launched
uniform float u_kickAmp;      // that wave's strength
uniform float u_beatTick;     // faint downbeat tick 0..1 (decays)
uniform float u_beatBand;     // which band index owns the downbeat tick
uniform float u_snareBand;    // loudest mid/high band index (snare whip target)
uniform float u_ribbonGain;   // brightness slider
uniform float u_flowGain;     // flow-speed slider
uniform float u_spectrum[24];

const float TWO_PI = 6.28318530718;
const float NBANDS = 24.0;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// HSV -> RGB (bright, fully saturated). Hue in turns (0..1).
vec3 hsv2rgb(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

// Constant-loop lookup (GLSL ES 1.0 forbids dynamic indexing).
float specAt(int idx) {
  float v = 0.0;
  for (int k = 0; k < 24; k++) {
    if (k == idx) v = u_spectrum[k];
  }
  return v;
}

// FIX (human note "just always green and red, very little blue"): the old
// linear wheel (hue = fb / 24) put the energy-dense low/mid bands in the
// red->green arc (hue 0..0.5) and left blue/violet (hue ~0.6..0.8) on the
// high bands, which are rarely loud — so a typical spectrum lit only red+green
// and a drop lit one region. Now the hue owned by a band is scattered by the
// GOLDEN-RATIO CONJUGATE (0.618...): fb * phi mod 1 gives adjacent bands
// maximally-distant hues, so any cluster of loud bands (low/mid energy, a
// drop) spreads across the FULL wheel instead of piling into one family.
// Band identity is still permanent; only the section notch spins the whole set.
const float PHI_CONJ = 0.6180339887; // golden-ratio conjugate
float bandHue(float fb) {
  return fract(fb * PHI_CONJ + u_hueOffset);
}

// Diagonal coordinate system. s = distance ALONG the diagonal (0..1 corner to
// corner); n = signed distance ACROSS the diagonal (the axis ribbons stack on
// and the kick pressure wave travels along). The frame is composed on this
// tilted axis so nothing is centered/radial.
void diagCoords(vec2 uv, out float s, out float n) {
  // Lower-left -> upper-right diagonal (normalized ~[0,1] range).
  s = clamp((uv.x + uv.y) * 0.5, 0.0, 1.0);
  n = (uv.x - uv.y) * 0.70710678 + 0.5; // ~[0,1] across the diagonal
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 px = 1.0 / u_res;
  float t = u_time;

  float s, n;
  diagCoords(uv, s, n);

  // ---- Persistence: sample the previous frame with a gentle ALONG-flow drift
  // (ribbons stream along their length) + the kick pressure wave's transverse
  // shove. Contractive: field = max(prev*sharpen - blur) * decay, decay < 1.
  // Flow direction is along the diagonal (increasing s).
  vec2 flowDir = normalize(vec2(1.0, 1.0));
  float flow = (0.010 + 0.045 * u_energy) * u_flowGain;
  // Kick pressure wave: a transverse bulge travelling ACROSS the diagonal in
  // n; where it passes it shoves the field sideways (physical, not a flash).
  float kf = 1.0 - u_kickAge * 1.5;             // wavefront position in n
  float kick = exp(-pow((n - kf) * 6.0, 2.0)) * exp(-u_kickAge * 2.0) * u_kickAmp;
  vec2 transDir = normalize(vec2(1.0, -1.0));   // perpendicular to the diagonal
  vec2 src = uv - flowDir * flow + transDir * kick * 0.05;
  vec3 sampled = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 field = max(vec3(0.0), sampled * 1.28 - blur * 0.28) * u_decay;

  // ---- The 24 ribbons. Each ribbon is a stripe at its own home position n0
  // across the diagonal; loudness = width + luminosity + flow. Weave topology
  // (u_weave) morphs the home spacing / interleave; braid (u_braid) collapses
  // all ribbons toward one shared river so a drop becomes a full-spectrum flow.
  vec3 fresh = vec3(0.0);
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float lvl = clamp(specAt(b), 0.0, 1.0);

    // Home position across the diagonal, edge-margined. Weave patterns:
    //   plain: evenly spaced.     interleave: odd bands nudged.
    //   braid: paired bands cross. fan: spacing widens with frequency.
    float even = 0.05 + 0.90 * (fb + 0.5) / NBANDS;
    float interleave = even + (mod(fb, 2.0) - 0.5) * 0.03;
    float braidW = even + 0.035 * sin(fb * 1.7 + t * 0.8 + s * 6.0);
    float fan = 0.05 + 0.90 * pow((fb + 0.5) / NBANDS, 1.35);
    // Blend the four weave modes by the (settled) topology selector.
    float w = clamp(u_weave, 0.0, 3.0);
    float n0 = mix(even, interleave, clamp(w, 0.0, 1.0));
    n0 = mix(n0, braidW, clamp(w - 1.0, 0.0, 1.0));
    n0 = mix(n0, fan, clamp(w - 2.0, 0.0, 1.0));
    // Phrase hard-cut still settling: cross-fade from the previous layout by
    // damping the excursion (weaveMix 0 = mid-cut, 1 = fully arrived).
    n0 = mix(even, n0, u_weaveMix);

    // DROP BRAID: collapse every ribbon toward one shared river centered on
    // the diagonal, so a drop reads as a broad full-spectrum flow.
    n0 = mix(n0, 0.5 + 0.03 * sin(fb * 0.9 + s * 3.0 + t), u_braid);

    // A slow lateral waver so ribbons feel like flowing streams, not bars.
    float waver = 0.012 * sin(s * (5.0 + fb * 0.15) * TWO_PI + t * 0.6 + fb);
    // Snare whip: the loudest mid/high ribbon cracks laterally (mid/high only).
    float isSnareBand = 1.0 - step(0.5, abs(fb - u_snareBand));
    waver += isSnareBand * u_snare * 0.05 * sin(s * 30.0 - t * 20.0);

    float nc = n0 + waver;
    float d = abs(n - nc);

    // WIDTH from loudness (quiet = hairline thread, loud = broad current).
    float width = mix(0.004, 0.045, lvl) * (1.0 - 0.4 * u_braid + 0.6 * u_braid);
    float body = smoothstep(width, width * 0.15, d);

    // FLOW along the ribbon: loud ribbons race, quiet ones crawl. The flow
    // phase modulates brightness along s so the current visibly streams.
    float speed = (0.4 + 3.0 * lvl) * u_flowGain;
    float flowPhase = 0.5 + 0.5 * sin(s * (18.0 + fb * 0.6) - t * speed - fb);

    // BEAT TICK: a faint bright pip racing along the downbeat ribbon.
    float isBeatBand = 1.0 - step(0.5, abs(fb - u_beatBand));
    float tickPos = fract(t * 0.8);
    float tick = isBeatBand * u_beatTick
      * exp(-pow((s - tickPos) * 12.0, 2.0));

    // LUMINOSITY from loudness. Ribbon owns its hue permanently (bandHue).
    float hue = bandHue(fb);
    vec3 rc = hsv2rgb(hue, 0.95, 1.0);
    float lumin = (0.06 + 1.05 * lvl) * (0.55 + 0.55 * flowPhase);
    fresh += rc * body * lumin;
    fresh += rc * body * tick * 1.4;
    // Snare whip flare on its ribbon.
    fresh += rc * body * isSnareBand * u_snare * 0.8;
  }

  // Inject fresh at (1 - decay) so the persistent field stays contractive;
  // drop/energy scale the INJECTION (bounded), not the memory. Buildup keeps
  // it tense-but-alive.
  fresh *= u_ribbonGain;
  field += fresh * (1.0 - u_decay)
    * (2.6 + 2.0 * max(u_drop, 0.55 * u_energy) + 0.9 * u_buildup);

  // Whole-frame kick punch stays tiny + gated (photosensitivity floor).
  field *= 1.0 + 0.06 * u_kick;

  // Grade: lean the running color toward the centroid-biased wheel position so
  // the section recolor reads across the field; keep a dim-but-alive floor.
  // FIX (green/red dominance): scatter the centroid onto the golden wheel too
  // (map the centroid band onto the same PHI_CONJ distribution as the ribbons)
  // so the whole-field grade is not pinned to the red->green arc either.
  float centroidBand = clamp(u_centroid, 0.0, 1.0) * (NBANDS - 1.0);
  vec3 grade = hsv2rgb(fract(centroidBand * PHI_CONJ + u_hueOffset), 0.85, 1.0);
  field = mix(field, field * (0.5 + grade * 1.3), 0.18);
  field *= 0.82 + 0.4 * max(u_drop, 0.45 * u_energy) + 0.1 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.85) {
    field *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

const candidate: VisualizerPreset = {
  id: 'g09-organ',
  name: 'g09 organ',
  hiRes: true,
  params: [
    { id: 'ribbon', label: 'ribbon brightness', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'flow', label: 'flow speed', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothEnergy = 0;
    // Kick pressure wave.
    let kickAge = 999;
    let kickAmp = 0;
    // Beat tick.
    let beatTick = 0;
    let lastBarPhase = 1;
    // Weave topology (phrase) + hue-wheel notch (section).
    let weave = 0;
    let weaveMix = 1;
    let hueNotch = 0;
    let lastPhraseIndex = -1;
    let lastSectionIndex = -1;
    // Drop braid.
    let braid = 0;
    const spectrum = new Float32Array(SPECTRUM_BANDS);
    // FIX (human note "just always green and red, very little blue"): a running
    // per-band adaptive ceiling. Low/mid bands carry most spectral energy, so a
    // raw spectrum makes their (red/green) ribbons blaze while the quiet high
    // (blue/violet) ribbons never read. Each band's prominence is normalized
    // against its OWN slowly-tracked ceiling so a quiet-but-present high band
    // reads as loud on ITS ribbon — the blue end lights up. Seed at a floor so
    // silent bands don't blow up to full.
    const bandCeil = new Float32Array(SPECTRUM_BANDS).fill(0.15);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);

        // Bass-weighted, smoothed drop signal (trend has no drop field).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        smoothEnergy += (energy - smoothEnergy) * smoothAlpha;

        // DROP BRAID: ribbons braid into one river riding max(drop, energy).
        const braidTarget = Math.min(1, Math.max(smoothDrop, 0.55 * smoothEnergy));
        // Only a strong sustained state actually braids (soft threshold).
        const braidGate = Math.max(0, (braidTarget - 0.45) / 0.55);
        braid += (Math.min(1, braidGate) - braid) * (1 - Math.exp(-dt / 0.5));

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        // Also find the loudest mid/high band for the snare whip target.
        // FIX (green/red dominance): PER-RIBBON PROMINENCE NORMALIZATION.
        //   (a) log/compressed band scaling — spectral energy is heavily tilted
        //       toward the low/mid, so a linear map lets those ribbons dominate;
        //       log1p compression flattens the tilt so mids/highs read.
        //   (b) per-band ADAPTIVE GAIN — divide by each band's own running
        //       ceiling (fast attack, slow release) so a quiet-but-present high
        //       band still reads loud on its (blue/violet) ribbon.
        // The snare-whip target still tracks the loudest RAW mid/high band (the
        // whip should fire on real energy, not normalized prominence).
        const src = frame.spectrum;
        let snareBand = 12;
        let snareMax = -1;
        const ceilAtkA = 1 - Math.exp(-dt / 0.08); // fast catch of new peaks
        const ceilRelA = 1 - Math.exp(-dt / 4.0); // slow ceiling decay
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const raw = Math.min(1, Math.max(0, i < src.length ? src[i] : 0));
          // (a) log compression (log1p, normalized so 1 -> 1).
          const comp = Math.log1p(raw * 6) / Math.log1p(6);
          // (b) adaptive per-band ceiling.
          if (comp > bandCeil[i]) bandCeil[i] += (comp - bandCeil[i]) * ceilAtkA;
          else bandCeil[i] += (comp - bandCeil[i]) * ceilRelA;
          bandCeil[i] = Math.max(0.12, bandCeil[i]); // floor: silence stays dim
          const prom = Math.min(1, comp / bandCeil[i]);
          spectrum[i] = prom;
          if (i >= 8 && raw > snareMax) {
            snareMax = raw;
            snareBand = i;
          }
        }

        // Phrase / section tiers via the ladder-correct ordinal.
        let phraseIndex = lastPhraseIndex;
        let sectionIndex = lastSectionIndex;
        let beatBand = 0;
        if (frame.beat) {
          const barOrdinal = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          phraseIndex = Math.floor(barOrdinal / PHRASE_BARS);
          sectionIndex = Math.floor(barOrdinal / SECTION_BARS);
          // Downbeat tick: fire on the wrap of barPhase (start of each bar).
          const bp = frame.beat.barPhase;
          if (bp < lastBarPhase - 0.4) {
            beatTick = 1;
            // The tick rides the band nearest the current centroid.
            beatBand = Math.min(23, Math.max(0, Math.round(frame.centroid * 23)));
          }
          lastBarPhase = bp;
        } else {
          lastBarPhase = 1;
        }
        beatTick = Math.max(0, beatTick - dt / 0.5);

        // PHRASE boundary: hard-cut the weave pattern (quantized). weaveMix
        // dips then settles so the cut is a snap, not a slow morph.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          weave = (weave + 1) % 4;
          weaveMix = 0;
        }
        lastPhraseIndex = phraseIndex;
        weaveMix = Math.min(1, weaveMix + dt / 0.25);

        // SECTION boundary: rotate the hue wheel ONE notch (all ribbons
        // recolor at once; ownership order preserved). 24-step wheel so a
        // notch is a clean 1/24-turn recolor spectacle.
        if (sectionIndex !== lastSectionIndex && lastSectionIndex >= 0) {
          hueNotch = (hueNotch + 1) % SPECTRUM_BANDS;
        }
        lastSectionIndex = sectionIndex;

        // KICK pressure wave: one transverse wave through all ribbons. Gated
        // on impulse.low so it never reads as "kick powder".
        kickAge += dt;
        if (frame.impulse.low > 0.35 && kickAge > 0.12) {
          kickAge = 0;
          kickAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // Decay: dim-but-alive; buildups hold the field a touch longer.
        const baseDecay = 0.955 - 0.012 * smoothEnergy - 0.006 * smoothBuildup;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_centroid: frame.centroid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_energy: smoothEnergy,
          u_braid: braid,
          u_decay: Math.min(0.99, 1 - (1 - baseDecay) / persistence),
          u_weave: weave,
          u_weaveMix: Math.max(0, Math.min(1, weaveMix)),
          u_hueOffset: hueNotch / SPECTRUM_BANDS,
          u_kickAge: kickAge,
          u_kickAmp: kickAmp,
          u_beatTick: beatTick,
          u_beatBand: beatBand,
          u_snareBand: snareBand,
          u_ribbonGain: frame.params.ribbon ?? 1,
          u_flowGain: frame.params.flow ?? 1,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default candidate;
