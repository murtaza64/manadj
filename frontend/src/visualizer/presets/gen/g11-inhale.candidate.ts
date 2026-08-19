/**
 * "g11 inhale" (genetic arena g11, NOVEL — new PULSE representation:
 * BREATH). The whole scene RESPIRES. A soft organic form — concentric
 * membranes / ribcage arcs (genome-shaped) — inflates and deflates. The
 * pulse reads as RESPIRATION, not impact:
 *
 *   BASS     — lung VOLUME. Deep bass holds the scene expanded. Rides
 *              bandsSlow (volume is a slow, held attribute).
 *   KICK     — a sharp INHALE snap: FAST expansion attack, SLOW settle back
 *              — inverted vs every pump we have (a pump punches OUT and
 *              recoils; this pulls IN air so the form EXPANDS on the hit and
 *              exhales gently between kicks). Gated on impulse.low.
 *   EXHALE   — the drift between kicks: the inhale envelope decays slowly.
 *   MIDS     — airflow RIBBONS drawn through the form: streamline curves in
 *              palette color (wave-shaped when a stereo wave is available).
 *   HIGHS    — a shimmer that appears ONLY near full inflation: discrete
 *              held-breath sparkle points (crisp dots, not glow).
 *   DROP     — hyperventilation: the breath cycle LOCKS to the beat, form at
 *              maximum, riding max(drop, energy) so it holds through the
 *              plateau. Photosafe: the membrane SCALE oscillates, mean
 *              luminance stays comparable (no full-field flash — the form
 *              breathes, it does not strobe).
 *   BUILDUP  — breath HELD: expansion frozen near full, trembling (tiny
 *              high-frequency jitter) — the silence before the plunge.
 *   SECTION  — the organism MOLTS: new membrane count + new palette family,
 *              hard cut.
 *
 * FLAT LAW: solid matte membrane rings, crisp arcs, committed palette, NO
 * glow/bloom/additive/feedback/particles. All motion is SCALE (breath) and
 * clean stroked curves, source-over.
 *
 * Assigned tech: bandsSlow (lung volume), per-band impulse (kick inhale /
 * high sparkle), trend drop/buildup split, beat phase + ladder tiers (drop
 * lock, section molt), stereo wave (ribbon shape, optional), trackId genome
 * (membrane count + palette). Canvas 2D — crisp fills.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function splitmix(key: number): () => number {
  let state = (Math.round(key) >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

/** A committed flat scheme: dark-but-not-black tissue background, two
 * membrane tones (inner/outer), an airflow-ribbon tone, a sparkle tone.
 * Comparable mean luminance across families (molts are chroma events). */
interface Scheme {
  bg: string;
  memA: string;
  memB: string;
  ribbon: string;
  sparkle: string;
}

const SCHEMES: Scheme[] = [
  // deep tissue / coral / rose / cyan ribbon / cream sparkle
  { bg: '#1c1016', memA: '#ff5a6a', memB: '#ff9d3c', ribbon: '#22e0d0', sparkle: '#fff2cf' },
  // marine / teal / lime / magenta ribbon / gold sparkle
  { bg: '#0d1e22', memA: '#1fd6b0', memB: '#a6ff2e', ribbon: '#ff2e9e', sparkle: '#ffd23f' },
  // violet / magenta / indigo / gold ribbon / mint sparkle
  { bg: '#171029', memA: '#ff2e88', memB: '#8a5cff', ribbon: '#ffcf1a', sparkle: '#4be6a0' },
  // ember / orange / red / cyan ribbon / bone sparkle
  { bg: '#241208', memA: '#ff7a1a', memB: '#ff3b30', ribbon: '#00c2ff', sparkle: '#f5efe0' },
];

class InhaleRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;
  /** membrane count (genome + molt). */
  private membranes = 5;
  /** per-membrane radial phase offsets (genome). */
  private memPhase: number[] = [];
  /** per-membrane lobe count for the ribcage-arc waviness. */
  private memLobes: number[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;

  /** INHALE envelope: fast attack on the kick, slow exhale decay. This is
   * the inverted pulse — it EXPANDS the form on the hit. */
  private inhale = 0;
  /** slow lung volume (bass, bandsSlow). */
  private volume = 0;
  /** ribbon flow phase (bandsSlow.mid drives the RATE). */
  private flow = 0;
  /** drop breath oscillator phase (beat-locked in drops). */
  private breathPhase = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    const order = SCHEMES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.schemeOrder = order;
    this.schemeIndex = order[0];
    this.molt(r);
  }

  /** New membrane count + arc shapes (genome / molt). */
  private molt(r: () => number): void {
    this.membranes = 4 + Math.floor(r() * 4); // 4..7
    this.memPhase = [];
    this.memLobes = [];
    for (let i = 0; i < this.membranes; i++) {
      this.memPhase.push(r() * Math.PI * 2);
      this.memLobes.push(3 + Math.floor(r() * 5)); // 3..7 lobes
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const energy = energyOf(frame.bands);
    const bandsSlow = frame.bandsSlow ?? frame.bands;

    // --- Identity / genome ------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null &&
      this.memPhase.length === 0
    ) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.memPhase.length === 0) this.reseed(1);

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) ----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);
    const dropOn = drive > 0.4;

    // --- Metric tiers (ladder-correct) ------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatInBar = beat!.beatInBar;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        this.prevBeatInBar = beatInBar;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- INHALE envelope: FAST attack on kick, SLOW exhale (inverted) -----
    if (frame.impulse.low > 0.2) {
      // a sharp inhale snap — expansion jumps up.
      this.inhale = Math.min(1, this.inhale + frame.impulse.low * 0.9);
    }
    // slow exhale drift between kicks (long release = the breath easing out).
    this.inhale = Math.max(0, this.inhale - dt / 0.85);

    // --- Lung volume: bass, bandsSlow (deep bass holds expanded) ----------
    const volTarget = clamp01(bandsSlow.low * 1.1 + 0.15 * drive);
    const volAlpha = 1 - Math.exp(-dt / 0.5);
    this.volume += (volTarget - this.volume) * volAlpha;

    // --- Drop breath lock: cycle to the beat exactly ----------------------
    // In a drop the whole form breathes at the beat rate; breathPhase runs
    // off beat.phase so inhale/exhale is meter-synced (hyperventilation).
    let dropBreath = 0;
    if (dropOn) {
      if (beat) {
        // 0 at downbeat swelling to full mid-beat: a smooth in/out per beat.
        this.breathPhase = beat.phase;
      } else {
        this.breathPhase = mod(this.breathPhase + dt * 2.2, 1);
      }
      dropBreath = 0.5 - 0.5 * Math.cos(this.breathPhase * Math.PI * 2);
    }

    // --- Ribbon flow rate (bandsSlow.mid) ---------------------------------
    this.flow += dt * (0.3 + 2.2 * bandsSlow.mid);

    // --- Compose the master EXPANSION scalar ------------------------------
    // base breath from volume, inhale snap on top, drop oscillation, and a
    // buildup "held breath" that freezes near full with a tiny tremble.
    let expansion = 0.34 + 0.34 * this.volume + 0.3 * this.inhale;
    if (dropOn) expansion = Math.max(expansion, 0.72 + 0.24 * dropBreath);
    if (buildup > 0.2) {
      const tremble = 0.015 * Math.sin(frame.time * 34) * buildup;
      expansion = Math.max(expansion, 0.82 + tremble);
    }
    expansion = clamp01(expansion);

    // --- Draw -------------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = scheme.bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scaleP = frame.params.scale ?? 1;
    const wobble = frame.params.wobble ?? 1;
    const ribbonGain = frame.params.ribbonGain ?? 1;

    const maxR = unit * 0.46 * scaleP;

    // Membrane radii: concentric, all scaled by the shared breath. Outer
    // membranes breathe more than inner (a lung, not a set of rings).
    const N = this.membranes;
    ctx.lineJoin = 'round';
    // paint OUTER first so inner sits on top (solid nested look).
    for (let i = N - 1; i >= 0; i--) {
      const base = (i + 1) / N;
      // outer breathes more strongly.
      const breathW = 0.55 + 0.45 * base;
      const r = maxR * base * (0.55 + 0.45 * expansion * breathW);
      const lobes = this.memLobes[i];
      const ph = this.memPhase[i];
      // membrane wobble amplitude tied to mids (alive tissue), calmer inner.
      const amp = r * 0.06 * wobble * (0.4 + 0.9 * bandsSlow.mid) * base;

      // Alternate membrane tones for legible nesting.
      ctx.fillStyle = i % 2 === 0 ? scheme.memA : scheme.memB;
      ctx.beginPath();
      const steps = 96;
      for (let s = 0; s <= steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const rr = r + amp * Math.sin(a * lobes + ph + this.flow * 0.5);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    // --- Airflow RIBBONS: streamline curves through the form (mids) -------
    // Drawn as crisp stroked curves from center outward, bent by the flow.
    // Optionally shaped by the stereo wave when present.
    const ribbonN = 5;
    const ribbonEnergy = clamp01((bandsSlow.mid * 0.7 + frame.bands.mid * 0.3) * ribbonGain);
    if (ribbonEnergy > 0.03) {
      ctx.strokeStyle = scheme.ribbon;
      ctx.lineWidth = Math.max(1, unit * 0.006 * (0.5 + ribbonEnergy));
      ctx.globalAlpha = clamp01(0.3 + 0.6 * ribbonEnergy);
      const wave = frame.wave;
      for (let k = 0; k < ribbonN; k++) {
        const a0 = (k / ribbonN) * Math.PI * 2 + this.flow * 0.4;
        const innerR = maxR * 0.1;
        const outerR = maxR * (0.35 + 0.6 * expansion);
        ctx.beginPath();
        const seg = 40;
        for (let s = 0; s <= seg; s++) {
          const t = s / seg;
          const rr = innerR + (outerR - innerR) * t;
          // swirl the streamline; wave (if any) adds fine articulation.
          let swirl = Math.sin(t * Math.PI * 2 + this.flow) * 0.35 * t;
          if (wave && wave.left.length > 0) {
            const wi = Math.floor(t * (wave.left.length - 1));
            swirl += (wave.left[wi] ?? 0) * 0.25 * t;
          }
          const a = a0 + swirl;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- HELD-BREATH sparkle: discrete points at full inflation (highs) ---
    // Only appears near max expansion (held breath). Crisp dots, not glow.
    const inflation = clamp01((expansion - 0.72) / 0.28);
    const sparkle = clamp01(frame.impulse.high * 0.7 + frame.bands.high * 0.3) * inflation;
    if (sparkle > 0.05) {
      ctx.fillStyle = scheme.sparkle;
      const rng = splitmix(Math.floor(frame.time * 6) * 2654435761 + this.schemeIndex);
      const count = Math.floor(4 + sparkle * 14);
      const ringR = maxR * (0.5 + 0.4 * expansion);
      const dotR = Math.max(1.2, unit * 0.006 * (0.5 + sparkle));
      for (let s = 0; s < count; s++) {
        const a = rng() * Math.PI * 2;
        const rr = ringR * (0.7 + 0.3 * rng());
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private onBarCut(barIndex: number): void {
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
      // MOLT: new membrane count + arc shapes (hard cut).
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.molt(r);
    } else if (isPhrase) {
      // phrase: reshuffle lobe counts slightly (gentle re-articulation).
      const r = splitmix((this.lastTrackId ?? 1) * 40503 + barIndex);
      for (let i = 0; i < this.memLobes.length; i++) {
        this.memLobes[i] = 3 + Math.floor(r() * 5);
      }
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'form scale', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'wobble', label: 'membrane wobble', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'ribbonGain', label: 'airflow ribbons', min: 0, max: 2, step: 0.05, default: 1 },
];

const g11InhalePreset: VisualizerPreset = {
  id: 'g11-inhale',
  name: 'g11 inhale',
  params,
  wantsWave: true,
  create: () => new InhaleRenderer(),
};

export default g11InhalePreset;
