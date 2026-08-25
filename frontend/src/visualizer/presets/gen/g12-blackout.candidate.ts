/**
 * "g12 blackout" (genetic arena g12, NOVEL — TECHNO WAVE: dark,
 * monochromatic, kinetic). A NEAR-BLACK field that is the MEMORY of impacts.
 *
 *   KICK    — one white geometric FIGURE flashes for ~80ms then vanishes,
 *             leaving a thin white OUTLINE afterimage that persists and slowly
 *             decays. Figures cycle a genome vocabulary (rect / X / circle /
 *             chevron) placed on a grid. PHOTOSAFE: each flash covers <20% of
 *             the frame (a single grid cell) and is RATE-LIMITED to <=2/s —
 *             localized pulse, area+rate capped, never a full-field flash.
 *   SNARE    — an existing outline JOLTS one grid cell (a hard local shake).
 *   MIDS     — the outlines breathe/skew slowly. bandsSlow.mid drives the RATE
 *             (motion-smoothness law).
 *   HIGHS    — fine white tick marks along outline edges (discrete hairline).
 *   BUILDUP  — accumulated outlines vibrate harder (tension by jitter).
 *   DROP     — all outlines pulse-FILL in beat-locked SPATIAL ALTERNATION: on
 *             each beat one checker parity fills, the other empties, so the
 *             TOTAL lit area stays constant across the flip (chroma-free,
 *             luminance-safe — not a full-field flash). Rides max(drop,energy).
 *   SECTION  — the field wipes clean; vocabulary + accent swap (white, or
 *             white + one hue, at section boundaries only).
 *
 * Dust is BACK (human ask) but DIVERSIFIED: three species keyed to bands,
 * each its own gray/tint, sparse drift — never the old wash.
 *
 * FLAT LAW: solid fills, hard edges, no glow/bloom/additive/feedback. The
 * field is >=90% grayscale; accent (if any) is section-scoped. Canvas 2D.
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
/** Rate limit on figure flashes: <=2/s. */
const MIN_FLASH_S = 0.5;
/** Flash lifetime (the bright fill window, seconds). */
const FLASH_LIFE_S = 0.08;

type Shape = 'rect' | 'x' | 'circle' | 'chevron';
const VOCAB: Shape[][] = [
  ['rect', 'x', 'circle', 'chevron'],
  ['rect', 'circle'],
  ['x', 'chevron'],
  ['rect', 'chevron', 'circle'],
];

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
  // dominant: smoothed frame.dominantChannel (layering jitter fix)
  const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (dom && dom.trackId != null) return dom.trackId;
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

/** Section accent (hue, sat). Pure white when sat === 0. */
const ACCENTS: { hue: number; sat: number }[] = [
  { hue: 0, sat: 0 },
  { hue: 200, sat: 90 },
  { hue: 32, sat: 95 },
  { hue: 285, sat: 80 },
  { hue: 150, sat: 85 },
];

interface Outline {
  col: number;
  row: number;
  shape: Shape;
  /** afterimage strength 0..1 (decays). */
  life: number;
  /** remaining bright-flash time (>0 while filled). */
  flash: number;
  /** local jolt offset (snare), decays. */
  joltX: number;
  joltY: number;
  phase: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: 0 | 1 | 2;
}

class BlackoutRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private cols = 5;
  private rows = 3;
  private vocab: Shape[] = VOCAB[0];
  private accent = ACCENTS[0];
  private outlines: Outline[] = [];
  private motes: Mote[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;
  private lastFlashAt = -10;
  private flashCursor = 0;
  private dropParity = 0;
  private breathe = 0;
  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    this.cols = 4 + Math.floor(r() * 3); // 4..6
    this.rows = 2 + Math.floor(r() * 2); // 2..3
    this.vocab = VOCAB[Math.floor(r() * VOCAB.length)];
    this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
    this.outlines = [];
    this.seedMotes(r);
  }

  private seedMotes(r: () => number): void {
    const list: Mote[] = [];
    const counts = [9, 7, 5];
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

    // --- Metric tiers -----------------------------------------------------
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
        // DROP: flip spatial-alternation parity per beat (area-constant).
        if (dropOn) this.dropParity ^= 1;
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

    // --- KICK figure flash (rate-limited, single cell = <20% area) --------
    if (frame.impulse.low > 0.28) this.tryFlash(frame.time);

    // --- SNARE jolt: shake one existing outline cell ----------------------
    if (frame.impulse.mid > 0.3 && this.outlines.length > 0) {
      const o = this.outlines[Math.floor(this.breathe * 997) % this.outlines.length];
      const dir = ((o.col + o.row) % 2) * 2 - 1;
      o.joltX = 0.02 * dir * frame.impulse.mid;
      o.joltY = -0.02 * frame.impulse.mid;
    }

    // --- Advance outlines: decay life/flash, relax jolt, breathe ----------
    this.breathe += dt * (0.3 + 1.6 * bandsSlow.mid);
    const decay = Math.exp(-dt / 3.0); // slow afterimage fade
    const joltRelax = 1 - Math.exp(-dt / 0.12);
    for (const o of this.outlines) {
      o.life *= decay;
      o.flash = Math.max(0, o.flash - dt);
      o.joltX *= 1 - joltRelax;
      o.joltY *= 1 - joltRelax;
    }
    this.outlines = this.outlines.filter((o) => o.life > 0.02);

    // --- Draw -------------------------------------------------------------
    const jitterGain = frame.params.jitter ?? 1;
    const tickGain = frame.params.ticks ?? 1;
    const dustGain = frame.params.dust ?? 1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const cellW = width / this.cols;
    const cellH = height / this.rows;
    // buildup + high vibration.
    const vib = (buildup * 0.6 + frame.impulse.high * 0.4) * jitterGain;

    const accentCss = (l: number) =>
      this.accent.sat === 0 ? `hsl(0,0%,${l}%)` : `hsl(${this.accent.hue},${this.accent.sat}%,${l}%)`;

    for (const o of this.outlines) {
      const parity = (o.col + o.row) & 1;
      // DROP fill: alternation — this cell is FILLED if its parity matches the
      // active dropParity (the other parity is empty → total area constant).
      const filled = o.flash > 0 || (dropOn && parity === this.dropParity);
      const jx = (o.joltX + (Math.random() - 0.5) * 0.004 * vib) * width;
      const jy = (o.joltY + (Math.random() - 0.5) * 0.004 * vib) * height;
      const skew = 0.06 * Math.sin(this.breathe + o.phase);
      const cxp = (o.col + 0.5) * cellW + jx;
      const cyp = (o.row + 0.5) * cellH + jy;
      const rw = cellW * 0.34 * (1 + skew);
      const rh = cellH * 0.34 * (1 - skew);

      const bright = o.flash > 0 ? 96 : 30 + 45 * o.life;
      ctx.strokeStyle = accentCss(bright);
      ctx.fillStyle = accentCss(bright);
      ctx.lineWidth = Math.max(1, unit * (0.0018 + 0.0016 * o.life));
      ctx.globalAlpha = clamp01(0.25 + 0.75 * o.life);

      this.drawShape(ctx, o.shape, cxp, cyp, rw, rh, filled);
      ctx.globalAlpha = 1;

      // HIGH ticks along the outline edges.
      if (tickGain > 0.01 && frame.bands.high > 0.1) {
        const tk = clamp01(frame.impulse.high * tickGain);
        if (tk > 0.05) {
          ctx.fillStyle = accentCss(90);
          ctx.globalAlpha = clamp01(0.3 + 0.6 * tk);
          const n = 4;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + this.breathe;
            const tx = cxp + Math.cos(a) * rw;
            const ty = cyp + Math.sin(a) * rh;
            const s = unit * 0.003;
            ctx.fillRect(tx - s / 2, ty - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // DUST — diversified species per band.
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

  private drawShape(
    ctx: CanvasRenderingContext2D,
    shape: Shape,
    cx: number,
    cy: number,
    rw: number,
    rh: number,
    filled: boolean
  ): void {
    ctx.beginPath();
    switch (shape) {
      case 'rect':
        ctx.rect(cx - rw, cy - rh, rw * 2, rh * 2);
        break;
      case 'circle':
        ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
        break;
      case 'x':
        ctx.moveTo(cx - rw, cy - rh);
        ctx.lineTo(cx + rw, cy + rh);
        ctx.moveTo(cx + rw, cy - rh);
        ctx.lineTo(cx - rw, cy + rh);
        ctx.stroke();
        return;
      case 'chevron':
        ctx.moveTo(cx - rw, cy + rh * 0.6);
        ctx.lineTo(cx, cy - rh * 0.6);
        ctx.lineTo(cx + rw, cy + rh * 0.6);
        if (filled) {
          ctx.lineTo(cx + rw, cy + rh);
          ctx.lineTo(cx - rw, cy + rh);
          ctx.closePath();
          ctx.fill();
          return;
        }
        ctx.stroke();
        return;
    }
    if (filled) ctx.fill();
    else ctx.stroke();
  }

  /** Emit a new figure flash at the next grid cell (rate-limited, one cell). */
  private tryFlash(now: number): void {
    if (now - this.lastFlashAt < MIN_FLASH_S) return;
    this.lastFlashAt = now;
    const total = this.cols * this.rows;
    this.flashCursor = (this.flashCursor + 1 + Math.floor((now * 13) % 3)) % total;
    const col = this.flashCursor % this.cols;
    const row = Math.floor(this.flashCursor / this.cols) % this.rows;
    const shape = this.vocab[(col + row) % this.vocab.length];
    // reuse an existing outline in that cell, else push a new one.
    let o = this.outlines.find((e) => e.col === col && e.row === row);
    if (!o) {
      o = { col, row, shape, life: 0, flash: 0, joltX: 0, joltY: 0, phase: (col * 7 + row * 3) };
      this.outlines.push(o);
    }
    o.shape = shape;
    o.life = 1;
    o.flash = FLASH_LIFE_S;
  }

  private onBarCut(barIndex: number): void {
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isSection) {
      // wipe clean + vocab/accent swap.
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.vocab = VOCAB[Math.floor(r() * VOCAB.length)];
      this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
      this.cols = 4 + Math.floor(r() * 3);
      this.rows = 2 + Math.floor(r() * 2);
      this.outlines = [];
    } else if (mod(barIndex, PHRASE_BARS) === 0) {
      this.dropParity ^= 1;
    }
  }
}

const params: PresetParam[] = [
  { id: 'jitter', label: 'buildup jitter', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'ticks', label: 'edge ticks', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'dust', label: 'dust', min: 0, max: 1.5, step: 0.05, default: 0.6 },
];

const g12BlackoutPreset: VisualizerPreset = {
  id: 'g12-blackout',
  name: 'g12 blackout',
  params,
  create: () => new BlackoutRenderer(),
};

export default g12BlackoutPreset;
