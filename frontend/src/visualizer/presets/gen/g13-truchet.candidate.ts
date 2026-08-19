/**
 * "g13 truchet" (genetic arena g13, ABSTRACT MATHEMATICS territory, NOVEL).
 * A TRUCHET tile grid: each cell holds one of two rotations of a tile
 * (quarter-arc pair OR diagonal), and the arcs join across cell edges into
 * flowing maze/weave contours. Cells FLIP orientation on quantized metric
 * events, re-routing the contour network each beat — the archetypal
 * quantized-grammar geometry with legible per-cell causality.
 *
 * Anti-resemblance: NOT a hypno spiral, NOT stained glass (Voronoi), NOT
 * mirror strata, NOT flat Vissonance concentric/columnar families. This is a
 * discrete tiling automaton on a metric grid.
 *
 * FLAT LAW: two committed contrasting arc colors + a dark tile floor, hard
 * edges, no glow, no blur, no feedback buffer. Canvas 2D, source-over.
 *
 * Flips are DISCRETE and quantized — a cell snaps to its new orientation; a
 * brief localized highlight marks it (legible causality). Motion (grid
 * breathing, arc-weight velocity) rides bandsSlow; instantaneous
 * bands/impulse drive flip counts and highlight pops only.
 *
 * Per-band vocabulary (EQ-killable):
 *   LOW  = kicks flip a BLOCK of cells (a square patch snaps) — structural,
 *          solid (gated impulse.low so not kick-powder) + arc weight rides
 *          low.
 *   MID  = snares flip a full ROW or COLUMN (a hard sweep).
 *   HIGH = hats flip scattered SINGLE cells + set a thin seam-arc accent on
 *          flipped cells.
 *
 * Quantized grammar (beat.ladderBarIndex ?? barIndex; pseudo-meter when
 * gridless):
 *   BEAT    = a marching flip wave advances one column (always evolving).
 *   BAR     = tile STYLE cycles quarter-arc <-> diagonal (hard topology step).
 *   PHRASE  = arc colors swap / palette rotates.
 *   SECTION = scheme SWAP + full-grid RESHUFFLE to a new seeded field +
 *             density may step (theatre).
 *   DROP    = flip liveliness lifts (dense re-routing) riding max(drop,
 *             energy); a CHROMA-only, luminance-held, <=2 Hz arc-color
 *             alternation across the grid (photosafe).
 *
 * Genome: dominant audible deck trackId seeds the base orientation field,
 * style-cycle phase, block-flip pattern, and section reshuffle orbit. No
 * trackId => frozen pseudo-seed.
 *
 * Assigned tech: bandsSlow (arc-weight/drift velocity), per-band impulses,
 * trend drop/buildup split, ladder tiers, trackId genome.
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
const DROP_STROBE_HZ = 2; // photosafe chroma alternation ceiling
const MAX_COLS = 40;
const MAX_ROWS = 40;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same maze skeleton. */
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

/** Deterministic per-cell hash → 0/1 orientation (stable for the field). */
function cellHash(seed: number, x: number, y: number): number {
  let h = (Math.round(seed) ^ Math.imul(x + 1, 0x27d4eb2f) ^ Math.imul(y + 1, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h & 1;
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

/** A committed flat scheme: dark tile floor + two contrasting arc colors +
 * a seam accent (hat flips). Stored as [h,s,l]. Saturated (no pastels). */
interface Scheme {
  bg: [number, number, number];
  arcA: [number, number, number];
  arcB: [number, number, number];
  seam: [number, number, number];
  flash: [number, number, number]; // flip highlight
}

const SCHEME_FAMILIES: Scheme[] = [
  {
    // cyan / magenta on near-black
    bg: [225, 45, 6],
    arcA: [190, 92, 55],
    arcB: [320, 90, 56],
    seam: [50, 95, 60],
    flash: [55, 100, 66],
  },
  {
    // gold / vermilion on deep brown
    bg: [24, 55, 6],
    arcA: [46, 95, 56],
    arcB: [10, 92, 54],
    seam: [190, 88, 56],
    flash: [55, 100, 66],
  },
  {
    // lime / electric blue on midnight
    bg: [210, 50, 6],
    arcA: [95, 90, 52],
    arcB: [210, 92, 56],
    seam: [320, 88, 58],
    flash: [80, 100, 66],
  },
  {
    // rose / teal on oxblood
    bg: [350, 45, 7],
    arcA: [345, 90, 56],
    arcB: [175, 88, 52],
    seam: [46, 92, 60],
    flash: [0, 100, 66],
  },
];

function hsl([h, s, l]: [number, number, number], alpha = 1): string {
  return `hsla(${mod(h, 360).toFixed(1)}, ${s}%, ${Math.min(74, Math.max(0, l))}%, ${alpha})`;
}

interface Genome {
  schemeStart: number;
  fieldSeed: number; // base orientation-field seed
  stylePhase: number; // starting style-cycle offset
  densityBase: number; // base cols (rows scale to aspect)
  reshuffleBank: number[]; // per-section field seeds
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const reshuffleBank: number[] = [];
  for (let i = 0; i < 4; i++) reshuffleBank.push(Math.floor(r() * 1e9));
  return {
    schemeStart: Math.floor(r() * SCHEME_FAMILIES.length),
    fieldSeed: Math.floor(r() * 1e9),
    stylePhase: Math.floor(r() * 2),
    densityBase: 12 + Math.floor(r() * 8), // 12..19 cols base
    reshuffleBank,
  };
}

interface GridState {
  schemeIndex: number;
  colorSwap: number; // phrase swaps arc roles (parity)
  styleIndex: number; // 0 = quarter-arc, 1 = diagonal
  fieldSeed: number; // current orientation-field seed
  cols: number;
  rows: number;
}

class TruchetRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);

  private state: GridState = {
    schemeIndex: 0,
    colorSwap: 0,
    styleIndex: 0,
    fieldSeed: 1,
    cols: 14,
    rows: 8,
  };

  /** Per-cell flip parity overlay (XORed onto the field hash). Sized to the
   * current grid; rebuilt on reshuffle/density change. */
  private flip: Uint8Array = new Uint8Array(MAX_COLS * MAX_ROWS);
  /** Per-cell highlight life (0..1), decays; marks recently flipped cells. */
  private hot: Float32Array = new Float32Array(MAX_COLS * MAX_ROWS);

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  private marchCol = 0; // beat-advanced flip wave column
  private kickLatched = false;
  private snareLatched = false;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private breath = 0;
  private pseudoBeat = 0;

  private idx(x: number, y: number): number {
    return y * MAX_COLS + x;
  }

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.state.schemeIndex = this.genome.schemeStart;
    this.state.styleIndex = this.genome.stylePhase;
    this.state.fieldSeed = this.genome.fieldSeed;
    this.state.colorSwap = 0;
    this.flip.fill(0);
    this.hot.fill(0);
  }

  /** Toggle one cell's flip parity + light it. */
  private flipCell(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.state.cols || y >= this.state.rows) return;
    const i = this.idx(x, y);
    this.flip[i] ^= 1;
    this.hot[i] = 1;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const bands = frame.bands;
    const slow = frame.bandsSlow ?? frame.bands;
    const energy = energyOf(bands);

    // --- Identity / genome -------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (!this.seeded) {
      const pseudo =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      this.reseed(pseudo);
      this.lastTrackId = trackId;
      this.seeded = true;
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Grid density (param + section step), clamped, aspect-matched ------
    const densityParam = frame.params.density ?? 1;
    const cols = Math.max(6, Math.min(MAX_COLS, Math.round(this.genome.densityBase * densityParam)));
    const rows = Math.max(4, Math.min(MAX_ROWS, Math.round((cols * height) / Math.max(1, width))));
    if (cols !== this.state.cols || rows !== this.state.rows) {
      this.state.cols = cols;
      this.state.rows = rows;
      this.marchCol = mod(this.marchCol, cols);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
    const lowPresence = clamp01((bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.3);
    const drive = Math.max(drop, sustain);
    // Buildups stay tense-but-alive: extra single-cell flicker rides buildup
    // so a rising section keeps re-routing even before the drop lands.
    const liveliness = (frame.params.liveliness ?? 1) * (1 + 0.4 * buildup);

    // --- LOW: kick flips a BLOCK of cells (structural, solid). Gated on
    // impulse.low so it isn't kick-powder. ---------------------------------
    if (frame.impulse.low > 0.32 && !this.kickLatched) {
      this.kickLatched = true;
      // block size grows with drive; seeded position from the genome field.
      const bs = Math.max(2, Math.round((2 + 2 * drive) * liveliness));
      const r = splitmix(this.state.fieldSeed + this.marchCol * 7 + Math.floor(frame.time * 3));
      const bx = Math.floor(r() * Math.max(1, this.state.cols - bs));
      const by = Math.floor(r() * Math.max(1, this.state.rows - bs));
      for (let y = by; y < by + bs; y++) {
        for (let x = bx; x < bx + bs; x++) this.flipCell(x, y);
      }
    } else if (frame.impulse.low < 0.16) {
      this.kickLatched = false;
    }

    // --- MID: snare flips a full ROW or COLUMN (hard sweep). ---------------
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.snareLatched = true;
      const r = splitmix(this.state.fieldSeed + 991 + Math.floor(frame.time * 5));
      if (r() < 0.5) {
        const y = Math.floor(r() * this.state.rows);
        for (let x = 0; x < this.state.cols; x++) this.flipCell(x, y);
      } else {
        const x = Math.floor(r() * this.state.cols);
        for (let y = 0; y < this.state.rows; y++) this.flipCell(x, y);
      }
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

    // --- HIGH: hats flip scattered SINGLE cells (sparse re-routes). --------
    if (frame.impulse.high > 0.3) {
      const n = Math.max(1, Math.round(3 * frame.impulse.high * liveliness));
      const r = splitmix(this.state.fieldSeed + Math.floor(frame.time * 97));
      for (let k = 0; k < n; k++) {
        this.flipCell(Math.floor(r() * this.state.cols), Math.floor(r() * this.state.rows));
      }
    }

    // --- Metric tiers ------------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * 4);
      const beatCell = barIndex * 4 + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBar(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        if (mod(beatCell, 4) === 0) this.onBar(Math.floor(beatCell / 4));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Hot highlight decay ----------------------------------------------
    const hotDecay = Math.exp(-dt / 0.22);
    for (let i = 0; i < this.hot.length; i++) {
      if (this.hot[i] > 0) this.hot[i] *= hotDecay;
    }

    // --- Breathing (rides slow.low; a bounded size term) -------------------
    this.breath += dt * (0.4 + 1.4 * slow.low);

    // --- Drop CHROMA-strobe (chroma only, luminance held, <=2 Hz). ---------
    const strobeOn = drop > 0.28 ? Math.floor(frame.time * DROP_STROBE_HZ) % 2 === 0 : false;

    // --- Scheme (phrase color swap) ----------------------------------------
    const scheme = SCHEME_FAMILIES[mod(this.state.schemeIndex, SCHEME_FAMILIES.length)];
    let arcA = scheme.arcA;
    let arcB = scheme.arcB;
    if (this.state.colorSwap === 1) {
      arcA = scheme.arcB;
      arcB = scheme.arcA;
    }
    if (strobeOn) {
      // chroma-only swap across the whole grid (luminance held by clamp).
      const t = arcA;
      arcA = arcB;
      arcB = t;
    }

    // ---- Dark flat floor --------------------------------------------------
    ctx.fillStyle = hsl(scheme.bg);
    ctx.fillRect(0, 0, width, height);

    // ---- Grid geometry ----------------------------------------------------
    const cellW = width / this.state.cols;
    const cellH = height / this.state.rows;
    const cell = Math.min(cellW, cellH);
    // arc stroke weight rides low (a size; slow low keeps it stable, small
    // instantaneous accent bounded).
    const weightParam = frame.params.weight ?? 1;
    const arcW = Math.max(1.5, cell * 0.16 * weightParam * (0.6 + 0.9 * slow.low + 0.3 * bands.low));
    // subtle breathing inset so the grid reads as living, bounded.
    const inset = cell * 0.5 * (0.02 * Math.sin(this.breath) * (0.4 + slow.mid));

    ctx.lineCap = 'round';
    const style = this.state.styleIndex;
    const R = cell * 0.5;

    for (let y = 0; y < this.state.rows; y++) {
      for (let x = 0; x < this.state.cols; x++) {
        const i = this.idx(x, y);
        const base = cellHash(this.state.fieldSeed, x, y);
        const orient = base ^ this.flip[i]; // 0 or 1
        const ox = x * cellW + cellW * 0.5;
        const oy = y * cellH + cellH * 0.5;
        const left = ox - cellW * 0.5 + inset;
        const right = ox + cellW * 0.5 - inset;
        const top = oy - cellH * 0.5 + inset;
        const bot = oy + cellH * 0.5 - inset;

        // Arc color: checker the two arc colors by (x+y) parity so contours
        // read as two interleaved thread colors (a weave), band-identity via
        // orientation-driven seam on flipped cells.
        const parity = mod(x + y, 2);
        const col = parity === 0 ? arcA : arcB;
        ctx.strokeStyle = hsl(col);
        ctx.lineWidth = arcW;

        ctx.beginPath();
        if (style === 0) {
          // Quarter-arc Truchet: two quarter circles joining opposite corners.
          if (orient === 0) {
            // arcs centered at top-left and bottom-right corners
            ctx.moveTo(left, top + R);
            ctx.arc(left, top, R, Math.PI * 0.5, 0, true);
            ctx.moveTo(right, bot - R);
            ctx.arc(right, bot, R, Math.PI * 1.5, Math.PI, true);
          } else {
            // arcs centered at top-right and bottom-left corners
            ctx.moveTo(right, top + R);
            ctx.arc(right, top, R, Math.PI * 0.5, Math.PI, false);
            ctx.moveTo(left, bot - R);
            ctx.arc(left, bot, R, Math.PI * 1.5, Math.PI * 2, false);
          }
        } else {
          // Diagonal Truchet: one of two diagonals across the cell.
          if (orient === 0) {
            ctx.moveTo(left, top);
            ctx.lineTo(right, bot);
          } else {
            ctx.moveTo(right, top);
            ctx.lineTo(left, bot);
          }
        }
        ctx.stroke();

        // HIGH seam accent: a thin secondary arc color on flipped cells so
        // hat re-routes read as a distinct thread over the base.
        if (this.flip[i] === 1) {
          ctx.strokeStyle = hsl(scheme.seam, 0.85);
          ctx.lineWidth = Math.max(1, arcW * 0.35);
          ctx.stroke();
        }

        // Flip highlight: recently flipped cells flash a localized square
        // outline (legible causality; localized, photosafe).
        const h = this.hot[i];
        if (h > 0.03) {
          ctx.strokeStyle = hsl(scheme.flash, 0.5 + 0.4 * h);
          ctx.lineWidth = Math.max(1, cell * 0.05 * h);
          ctx.strokeRect(left, top, right - left, bot - top);
        }
      }
    }
  }

  // --- Boundary handlers -------------------------------------------------

  private onBeat(): void {
    // BEAT = a marching flip wave advances one column (always evolving).
    for (let y = 0; y < this.state.rows; y++) this.flipCell(this.marchCol, y);
    this.marchCol = mod(this.marchCol + 1, this.state.cols);
  }

  private onBar(barIndex: number): void {
    // BAR = tile STYLE cycles quarter-arc <-> diagonal (hard topology step).
    this.state.styleIndex = mod(barIndex + this.genome.stylePhase, 2);
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) this.cutPhrase(Math.floor(barIndex / PHRASE_BARS));
    if (isSection) this.cutSection(Math.floor(barIndex / SECTION_BARS));
  }

  private cutPhrase(phraseIndex: number): void {
    // PHRASE = arc colors swap roles.
    this.state.colorSwap = mod(phraseIndex, 2);
  }

  private cutSection(sectionIndex: number): void {
    // SECTION = scheme SWAP + full-grid RESHUFFLE to a new seeded field.
    this.state.schemeIndex = mod(this.genome.schemeStart + sectionIndex, SCHEME_FAMILIES.length);
    this.state.fieldSeed = this.genome.reshuffleBank[mod(sectionIndex, this.genome.reshuffleBank.length)];
    this.flip.fill(0);
    // light the whole grid briefly to mark the reshuffle (localized cells,
    // not a fullscreen flash — each cell's own outline).
    for (let i = 0; i < this.hot.length; i++) this.hot[i] = 0.6;
  }
}

const params: PresetParam[] = [
  { id: 'density', label: 'grid density', min: 0.6, max: 2.2, step: 0.05, default: 1 },
  { id: 'weight', label: 'arc weight', min: 0.5, max: 2.0, step: 0.05, default: 1 },
  { id: 'liveliness', label: 'flip liveliness', min: 0.4, max: 2.5, step: 0.05, default: 1 },
];

const g13TruchetPreset: VisualizerPreset = {
  id: 'g13-truchet',
  name: 'g13 truchet',
  params,
  create: () => new TruchetRenderer(),
};

export default g13TruchetPreset;
