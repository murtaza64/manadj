/**
 * "g12 strobe-column" (genetic arena g12, NOVEL — TECHNO WAVE: dark,
 * monochromatic, kinetic). A row of massive COLUMNS (8..16, flat, monochrome
 * grays). The whole piece is a strobing colonnade that never actually flashes.
 *
 *   BEAT     — a genome-SEQUENCED SUBSET of columns inverts state
 *             (dark<->lit gray). PHOTOSAFE: the inversion is SPATIAL
 *             ALTERNATION — for every column that lights, a paired one darkens,
 *             so total field luminance stays near-constant (checkerboard logic,
 *             never full-field). The subset completes one cycle per bar → bar
 *             position is readable in the pattern.
 *   MIDS     — column HEIGHTS (bandsSlow.mid, slow glide — motion law).
 *   HIGHS    — thin edge-flicker detail on LIT columns only (discrete hairline).
 *   KICK     — the whole colonnade SHIFTS one column-width sideways (hard
 *             transform — the room strides). Gated on impulse.low.
 *   BUILDUP  — columns NARROW (compression → tension).
 *   DROP     — double-time inversions, still <=2 state changes/sec PER REGION
 *             via spatial partitioning (each region toggles at most every
 *             other beat); ONE accent hue floods the lit set. Rides
 *             max(drop, energy).
 *   SECTION  — column count + gray ramp + accent swap (hard cut).
 *
 * Dust is BACK (human ask), diversified per band, sparse. Canvas 2D — crisp.
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
/** Regions for the double-time drop rate limit: each region toggles at most
 * once per 2 beats, so no region exceeds 2 state changes/sec at techno BPM. */
const REGIONS = 4;

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
  { hue: 0, sat: 0 }, // white
  { hue: 200, sat: 90 },
  { hue: 32, sat: 95 },
  { hue: 285, sat: 80 },
  { hue: 150, sat: 85 },
];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: 0 | 1 | 2;
}

class StrobeColumnRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private count = 10;
  /** dark gray + lit gray for the columns — a LUMINANCE-PAIRED ramp: when a
   * column flips lit<->dark its partner flips the opposite way, net constant. */
  private darkGray = 20;
  private litGray = 55;
  private accent = ACCENTS[0];

  /** current lit state per column (boolean via 0/1). */
  private state: number[] = [];
  /** eased height per column (mids). */
  private heights: number[] = [];
  private targetHeights: number[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;
  private shift = 0; // eased sideways offset in column-widths
  private shiftTarget = 0;
  private width_ = 1; // eased column width factor (buildup narrows)
  private beatCounter = 0;
  private pseudoBeat = 0;
  private motes: Mote[] = [];

  private reseed(key: number): void {
    const r = splitmix(key);
    this.count = 8 + Math.floor(r() * 9); // 8..16
    // luminance-paired grays; comparable mean across sections.
    this.darkGray = 14 + Math.floor(r() * 10); // 14..23
    this.litGray = 48 + Math.floor(r() * 16); // 48..63
    this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
    // seed a balanced checker so total luminance starts near mean.
    this.state = [];
    for (let i = 0; i < this.count; i++) this.state.push(i % 2);
    this.heights = new Array(this.count).fill(0.5);
    this.targetHeights = new Array(this.count).fill(0.5);
    this.seedMotes(r);
  }

  private seedMotes(r: () => number): void {
    const list: Mote[] = [];
    const counts = [8, 6, 5];
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
    if (this.lastTrackId === null && trackId === null && this.prevBar === null && this.state.length === 0) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.state.length === 0) this.reseed(1);

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
      const beatsPerBar = beat!.beatsPerBar || 4;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        this.beatCounter++;
        this.invertSubset(barIndex, beatInBar, beatsPerBar, dropOn);
        this.prevBeatInBar = beatInBar;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const pBeat = Math.floor(this.pseudoBeat);
      if (this.prevBeatInBar === null || pBeat !== this.prevBeatInBar) {
        this.beatCounter++;
        this.invertSubset(Math.floor(pBeat / 4), pBeat % 4, 4, dropOn);
        this.prevBeatInBar = pBeat;
      }
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- KICK: shift the whole colonnade one column-width sideways --------
    if (frame.impulse.low > 0.28) {
      this.shiftTarget += 1; // one column-width stride
    }
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt / 0.05));

    // --- MIDS: column heights (slow) --------------------------------------
    // each column gets a slowly-varying height tied to slow mid + its index.
    for (let i = 0; i < this.count; i++) {
      const wobble = 0.5 + 0.5 * Math.sin(frame.time * 0.6 + i * 0.9);
      this.targetHeights[i] = clamp01(0.4 + 0.5 * bandsSlow.mid * wobble);
      this.heights[i] += (this.targetHeights[i] - this.heights[i]) * (1 - Math.exp(-dt / 0.4));
    }

    // --- BUILDUP: narrow columns (compression) ----------------------------
    const widthTarget = 1 - 0.4 * buildup;
    this.width_ += (widthTarget - this.width_) * (1 - Math.exp(-dt / 0.3));

    // --- Draw -------------------------------------------------------------
    const scale = frame.params.scale ?? 1;
    const heightGain = frame.params.heightGain ?? 1;
    const dustGain = frame.params.dust ?? 1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const colPitch = width / this.count;
    const colW = colPitch * this.width_ * scale * 0.86;
    const gap = colPitch - colW;
    const baseY = height * 0.92;
    const shiftPx = mod(this.shift, this.count) * colPitch;

    const accentCss = (l: number) =>
      this.accent.sat === 0 ? `hsl(0,0%,${l}%)` : `hsl(${this.accent.hue},${this.accent.sat}%,${l}%)`;

    const highDetail = clamp01(frame.impulse.high * 0.8 + frame.bands.high * 0.2);

    // Draw two wrapped passes so the sideways stride tiles seamlessly.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.count; i++) {
        const x = i * colPitch + gap / 2 + shiftPx - pass * this.count * colPitch;
        if (x + colW < 0 || x > width) continue;
        const lit = this.state[i] === 1;
        const h = height * 0.6 * (0.3 + 0.7 * this.heights[i]) * heightGain;
        const topY = baseY - h;

        // body: dark or lit gray; drop floods lit set with the accent hue.
        if (lit) {
          ctx.fillStyle = dropOn && this.accent.sat > 0 ? accentCss(this.litGray) : `hsl(0,0%,${this.litGray}%)`;
        } else {
          ctx.fillStyle = `hsl(0,0%,${this.darkGray}%)`;
        }
        ctx.fillRect(x, topY, colW, h);

        // a thin cap line (grayscale) to read the column as a solid block.
        ctx.fillStyle = `hsl(0,0%,${lit ? this.litGray + 12 : this.darkGray + 8}%)`;
        ctx.fillRect(x, topY, colW, Math.max(2, unit * 0.006));

        // HIGH edge-flicker on LIT columns only (discrete hairline).
        if (lit && highDetail > 0.08) {
          ctx.strokeStyle = dropOn && this.accent.sat > 0 ? accentCss(80) : '#e8ecf2';
          ctx.lineWidth = Math.max(1, unit * 0.0018);
          ctx.globalAlpha = clamp01(0.3 + 0.6 * highDetail);
          const edgeX = ((i + this.beatCounter) % 2 === 0) ? x : x + colW;
          ctx.beginPath();
          ctx.moveTo(edgeX, topY);
          ctx.lineTo(edgeX, baseY);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Floor line (grounds the colonnade).
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, baseY, width, height - baseY);

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
        const sy = height * 0.45 + m.y * height * 0.4;
        ctx.fillStyle = speciesTint[m.species];
        ctx.globalAlpha = clamp01(0.12 + 0.4 * lvl) * dustGain;
        const r = unit * (0.001 + 0.0015 * (m.species + 1) * lvl);
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Invert a genome-sequenced, LUMINANCE-BALANCED subset. Photosafety:
   *  - spatial alternation: for each column flipped ON, a paired column flips
   *    OFF (net field luminance constant — checkerboard, never full-field).
   *  - drop double-time is rate-limited PER REGION: a region toggles only when
   *    its parity matches the beat, capping any region to <=1 change / 2 beats
   *    (<=2/s at techno BPM).
   */
  private invertSubset(
    barIndex: number,
    beatInBar: number,
    beatsPerBar: number,
    dropOn: boolean
  ): void {
    // deterministic per-bar sequence: which columns are "active" this beat.
    const seq = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex * 131 + beatInBar);
    // choose a set of flip PAIRS: pick equal numbers to light and darken so
    // total lit count (hence luminance) is preserved.
    const flips: number[] = [];
    // Map the beat's position within the bar onto a region so the active
    // region sweeps through all REGIONS across the bar → the inversion pattern
    // completes one full cycle per bar (bar position readable in the pattern).
    const region = Math.floor((beatInBar / Math.max(1, beatsPerBar)) * REGIONS) % REGIONS;
    for (let i = 0; i < this.count; i++) {
      const inRegion = i % REGIONS === region;
      // base rate: flip columns in this region. drop: also flip a second
      // region on alternate beats (still <=1 change / 2 beats per region).
      const dropRegion = dropOn && (i % REGIONS === (region + 2) % REGIONS) && (this.beatCounter % 2 === 0);
      if ((inRegion || dropRegion) && seq() < 0.7) flips.push(i);
    }
    // Pair flips: invert BOTH members of each pair. A pair is only inverted
    // when its two columns hold OPPOSITE states, so one goes on exactly as the
    // other goes off — lit count (hence total luminance) is preserved. Pairs
    // in the same state are skipped (a same-state flip would move luminance).
    for (let k = 0; k + 1 < flips.length; k += 2) {
      const a = flips[k];
      const b = flips[k + 1];
      if (this.state[a] !== this.state[b]) {
        this.state[a] ^= 1;
        this.state[b] ^= 1;
      }
    }
    // Any odd column left over is left untouched (no unpaired luminance move).
  }

  private onBarCut(barIndex: number): void {
    if (mod(barIndex, SECTION_BARS) === 0) {
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      const newCount = 8 + Math.floor(r() * 9);
      this.count = newCount;
      this.darkGray = 14 + Math.floor(r() * 10);
      this.litGray = 48 + Math.floor(r() * 16);
      this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
      this.state = [];
      for (let i = 0; i < this.count; i++) this.state.push(i % 2);
      this.heights = new Array(this.count).fill(0.5);
      this.targetHeights = new Array(this.count).fill(0.5);
      this.shiftTarget = 0;
      this.shift = 0;
    } else if (mod(barIndex, PHRASE_BARS) === 0) {
      const r = splitmix((this.lastTrackId ?? 1) * 40503 + barIndex);
      this.accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'column width', min: 0.6, max: 1.3, step: 0.05, default: 1 },
  { id: 'heightGain', label: 'column height', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'dust', label: 'dust', min: 0, max: 1.5, step: 0.05, default: 0.6 },
];

const g12StrobeColumnPreset: VisualizerPreset = {
  id: 'g12-strobe-column',
  name: 'g12 strobe-column',
  params,
  create: () => new StrobeColumnRenderer(),
};

export default g12StrobeColumnPreset;
