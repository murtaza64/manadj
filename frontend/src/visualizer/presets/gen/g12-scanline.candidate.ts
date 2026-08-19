/**
 * "g12 scanline" (genetic arena g12, NOVEL — TECHNO WAVE: dark,
 * monochromatic, kinetic). A black field with ONE horizontal white SCANLINE
 * sweeping downward like a seismograph drum: the line displaces vertically by
 * the live low/mid spectrum as it sweeps, DRAWING the music's terrain, and
 * leaves dim phosphor traces of previous sweeps.
 *
 *   SWEEP    — one pass top→bottom. RATE = bandsSlow.low (bar-rational on a
 *             grid: one sweep per bar). Motion-smoothness law: rate rides the
 *             slow bands, never the jerky instantaneous ones.
 *   TERRAIN  — the line's vertical displacement is the live spectrum sampled
 *             across x (low/mid), so the sweep literally traces the sound.
 *   TRACES   — each completed sweep leaves a phosphor trace; MAX ~8, decaying
 *             (feedback CONTRACTION — bounded trace count, no runaway).
 *   KICK     — the line FRACTURES into a staircase step for one beat (hard
 *             vertical displacement). Gated on impulse.low.
 *   SNARE    — a vertical glitch slice crosses the line (thin, transient).
 *   HIGHS    — fine white noise ticks riding the line's CREST only (discrete).
 *   BUILDUP  — leading edge brightens + sweeps tighten (tension).
 *   DROP     — the field splits into 4 parallel scanlines sweeping in opposite
 *             directions, riding max(drop, energy). PHOTOSAFE: the lines are
 *             thin (hairline area), never a full-field flash; brightness is
 *             constant, only their count/direction changes.
 *   SECTION  — the sweep AXIS rotates 90 degrees (hard cut).
 *
 * Monochrome white-on-black; ONE accent hue touches the DROP lines only.
 * Dust is BACK (human ask), diversified per band. Canvas 2D — crisp lines.
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
const MAX_TRACES = 8;
/** Samples along the sweep line (terrain resolution). */
const LINE_SAMPLES = 64;

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

const ACCENTS: { hue: number; sat: number }[] = [
  { hue: 200, sat: 90 }, // cold cyan
  { hue: 32, sat: 95 }, // sodium
  { hue: 285, sat: 80 }, // violet
  { hue: 150, sat: 85 }, // toxic green
];

interface Trace {
  /** captured terrain samples (normalized displacement -1..1). */
  terrain: number[];
  life: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: 0 | 1 | 2;
}

class ScanlineRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private accent = ACCENTS[0];
  /** sweep axis: 0 = horizontal line sweeping down; 1 = vertical sweeping right. */
  private axis: 0 | 1 = 0;
  private traces: Trace[] = [];
  private motes: Mote[] = [];

  private prevBar: number | null = null;
  private sweepPos = 0; // 0..1 progress of the current sweep
  private liveTerrain: number[] = new Array(LINE_SAMPLES).fill(0);
  private fracture = 0; // kick staircase amount, decays
  private glitchX = -1; // snare glitch position (normalized), -1 = none
  private glitchLife = 0;
  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
    this.axis = r() < 0.5 ? 0 : 1;
    this.traces = [];
    this.seedMotes(r);
  }

  private seedMotes(r: () => number): void {
    const list: Mote[] = [];
    const counts = [8, 7, 5];
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < counts[s]; i++) {
        list.push({
          x: r() * 2 - 1,
          y: r() * 2 - 1,
          vx: (r() - 0.5) * 0.02,
          vy: (r() - 0.5) * 0.02,
          species: s as 0 | 1 | 2,
        });
      }
    }
    this.motes = list;
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
    if (this.lastTrackId === null && trackId === null && this.prevBar === null && this.motes.length === 0) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.motes.length === 0) this.reseed(1);

    // --- Regime -----------------------------------------------------------
    const drop = clamp01(Math.max(frame.trend.excitement, energy));
    const dropOn = drop > 0.42 && frame.bands.low > 0.25;
    const buildup = clamp01(frame.trend.excitement * (1 - clamp01(frame.bands.low * 1.5)));

    // --- Sweep rate: bandsSlow.low; buildup tightens (faster) -------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    // base rate ~0.35..1.6 sweeps/sec off slow low; buildup up to +0.8.
    const sweepRate = 0.35 + 1.25 * bandsSlow.low + 0.8 * buildup;
    this.sweepPos += dt * sweepRate;
    const wrapped = this.sweepPos >= 1;
    if (wrapped) {
      this.sweepPos -= 1;
      this.commitTrace();
    }

    // --- Bar / section tiers ----------------------------------------------
    if (hasGrid) {
      const barIndex = tierBar as number;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- Live terrain: sample low/mid spectrum across the line ------------
    const spec = frame.spectrum;
    const specN = spec.length;
    for (let i = 0; i < LINE_SAMPLES; i++) {
      const t = i / (LINE_SAMPLES - 1);
      // bias toward low/mid: map [0,1] into the lower ~2/3 of the spectrum.
      const si = Math.min(specN - 1, Math.floor(t * specN * 0.66));
      const raw = (spec[si] ?? 0) * 2 - 0.0; // 0..1
      const target = clamp01(raw) * 2 - 1; // -1..1
      // smooth the terrain slightly (spatial), and ease in time.
      this.liveTerrain[i] += (target - this.liveTerrain[i]) * (1 - Math.exp(-dt / 0.05));
    }

    // --- KICK fracture (staircase for ~one beat) --------------------------
    if (frame.impulse.low > 0.28) this.fracture = 1;
    this.fracture *= Math.exp(-dt / 0.18);

    // --- SNARE glitch slice ------------------------------------------------
    if (frame.impulse.mid > 0.32) {
      this.glitchX = Math.random();
      this.glitchLife = 1;
    }
    this.glitchLife *= Math.exp(-dt / 0.1);

    // --- Draw -------------------------------------------------------------
    const ampGain = frame.params.amplitude ?? 1;
    const traceGain = frame.params.traces ?? 1;
    const dustGain = frame.params.dust ?? 1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const along = this.axis === 0 ? width : height;
    const across = this.axis === 0 ? height : width;
    const amp = across * 0.06 * ampGain;

    // Map a (t along 0..1, disp -1..1) into screen coords for the given axis
    // and a sweep progress p (0..1) placing the line across the field.
    const place = (t: number, disp: number, p: number): [number, number] => {
      const a = t * along;
      const b = p * across + disp * amp;
      return this.axis === 0 ? [a, b] : [b, a];
    };

    // PHOSPHOR TRACES first (dim, decaying, bounded to MAX_TRACES).
    for (let ti = 0; ti < this.traces.length; ti++) {
      const tr = this.traces[ti];
      // traces are pinned at evenly spaced positions behind the sweep.
      const p = clamp01(this.sweepPos - (ti + 1) * (1 / (MAX_TRACES + 1)) * 1.0 + 1) % 1;
      const bright = 12 + 28 * tr.life * traceGain;
      ctx.strokeStyle = `hsl(0,0%,${bright}%)`;
      ctx.lineWidth = Math.max(1, unit * 0.0015);
      ctx.globalAlpha = clamp01(0.2 + 0.6 * tr.life);
      ctx.beginPath();
      for (let i = 0; i < tr.terrain.length; i++) {
        const t = i / (tr.terrain.length - 1);
        const [sx, sy] = place(t, tr.terrain[i], p);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // DROP: 4 parallel scanlines sweeping opposite directions (accent-tinted).
    const lineCount = dropOn ? 4 : 1;
    const accentCss = (l: number) => `hsl(${this.accent.hue},${this.accent.sat}%,${l}%)`;

    for (let ln = 0; ln < lineCount; ln++) {
      // each drop line offset in phase; alternate direction.
      const dir = ln % 2 === 0 ? 1 : -1;
      const phase = lineCount > 1 ? (this.sweepPos * dir + ln / lineCount) : this.sweepPos;
      const p = mod(phase, 1);
      const isCrestLine = ln === 0;

      ctx.beginPath();
      let crestX = 0;
      let crestY = 0;
      let crestDisp = -2;
      for (let i = 0; i < LINE_SAMPLES; i++) {
        const t = i / (LINE_SAMPLES - 1);
        let disp = this.liveTerrain[i];
        // KICK staircase: quantize the displacement into steps.
        if (this.fracture > 0.02) {
          const steps = 5;
          const q = Math.round(disp * steps) / steps;
          disp = disp + (q - disp) * this.fracture;
        }
        const [sx, sy] = place(t, disp, p);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
        if (disp > crestDisp) {
          crestDisp = disp;
          crestX = sx;
          crestY = sy;
        }
      }
      // leading edge brightens with buildup; drop lines carry the accent.
      const lead = 82 + 14 * buildup;
      ctx.strokeStyle = dropOn ? accentCss(60) : `hsl(0,0%,${lead}%)`;
      ctx.lineWidth = Math.max(1.5, unit * (0.0022 + 0.001 * buildup));
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // HIGH ticks on the CREST only (of the primary line).
      if (isCrestLine && frame.bands.high > 0.08) {
        const tk = clamp01(frame.impulse.high);
        if (tk > 0.06) {
          ctx.fillStyle = dropOn ? accentCss(88) : '#ffffff';
          ctx.globalAlpha = clamp01(0.4 + 0.6 * tk);
          for (let k = 0; k < 3; k++) {
            const jx = (Math.random() - 0.5) * unit * 0.02;
            const jy = (Math.random() - 0.5) * unit * 0.01;
            const s = unit * 0.0035;
            ctx.fillRect(crestX + jx - s / 2, crestY + jy - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // SNARE glitch slice: a thin vertical (or cross-axis) white slash.
    if (this.glitchLife > 0.05 && this.glitchX >= 0) {
      ctx.fillStyle = '#e8ecf2';
      ctx.globalAlpha = clamp01(0.3 + 0.5 * this.glitchLife);
      if (this.axis === 0) {
        const gx = this.glitchX * width;
        ctx.fillRect(gx, 0, Math.max(1, unit * 0.002), height);
      } else {
        const gy = this.glitchX * height;
        ctx.fillRect(0, gy, width, Math.max(1, unit * 0.002));
      }
      ctx.globalAlpha = 1;
    }

    // DUST — diversified per band.
    if (dustGain > 0.01) {
      const bandLevels = [frame.bands.low, frame.bands.mid, frame.bands.high];
      const speciesTint = ['#2c3036', '#36303a', '#303a38'];
      for (const m of this.motes) {
        m.x += m.vx * dt * (0.5 + bandLevels[m.species]);
        m.y += m.vy * dt * (0.5 + bandLevels[m.species]);
        if (m.x < -1) m.x = 1;
        if (m.x > 1) m.x = -1;
        if (m.y < -1) m.y = 1;
        if (m.y > 1) m.y = -1;
        const lvl = bandLevels[m.species];
        if (lvl < 0.04) continue;
        const sx = width / 2 + m.x * width * 0.5;
        const sy = height / 2 + m.y * height * 0.5;
        ctx.fillStyle = speciesTint[m.species];
        ctx.globalAlpha = clamp01(0.12 + 0.4 * lvl) * dustGain;
        const r = unit * (0.001 + 0.0015 * (m.species + 1) * lvl);
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Snapshot the current terrain as a phosphor trace; cap to MAX_TRACES. */
  private commitTrace(): void {
    this.traces.unshift({ terrain: this.liveTerrain.slice(), life: 1 });
    if (this.traces.length > MAX_TRACES) this.traces.length = MAX_TRACES;
    // decay all existing traces one step (staggered aging).
    for (let i = 0; i < this.traces.length; i++) {
      this.traces[i].life = Math.max(0, 1 - i / MAX_TRACES);
    }
  }

  private onBarCut(barIndex: number): void {
    if (mod(barIndex, SECTION_BARS) === 0) {
      // section: rotate the sweep axis 90 degrees (hard cut) + accent swap.
      this.axis = this.axis === 0 ? 1 : 0;
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
      this.traces = [];
    } else if (mod(barIndex, PHRASE_BARS) === 0) {
      // phrase: swap accent hue for variety.
      const r = splitmix((this.lastTrackId ?? 1) * 40503 + barIndex);
      this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
    }
  }
}

const params: PresetParam[] = [
  { id: 'amplitude', label: 'terrain amp', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'traces', label: 'phosphor traces', min: 0, max: 1.5, step: 0.05, default: 1 },
  { id: 'dust', label: 'dust', min: 0, max: 1.5, step: 0.05, default: 0.6 },
];

const g12ScanlinePreset: VisualizerPreset = {
  id: 'g12-scanline',
  name: 'g12 scanline',
  params,
  create: () => new ScanlineRenderer(),
};

export default g12ScanlinePreset;
