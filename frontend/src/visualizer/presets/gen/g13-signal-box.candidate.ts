/**
 * "g13 signal box" (genetic arena g13, NOVEL; URBAN/MECHANICAL territory).
 *
 * A flat, diagrammatic RAILWAY INTERLOCKING. A signal gantry of colored aspect
 * lamps sits up top; a schematic TRACK with mechanical POINTS runs the middle;
 * a bright TRAIN pulse marches the track locked to the beat, lighting each
 * signal it passes; a FLIP-DOT departure board spells the spectrum at the base.
 * FLAT-appetite compliant: solid matte fills, hard-edged shapes, binary
 * lamps/dots, committed liveries, flat near-black floor. No feedback, no glow.
 *
 * The grammar (DISTINCT per band, quantized states):
 *   - LOW  = TRAIN mass/speed + point machinery. Kick (impulse.low, gated
 *            broadband) THROWS a point (lever snaps, two-state hard flip) and
 *            lurches the train one cell.
 *   - MID  = SIGNAL ASPECTS: each gantry head steps danger/caution/clear with
 *            its band; snare (impulse.mid) cycles one head's aspect (hard flip).
 *   - HIGH = flip-dot board rows fill (impulse.high, discrete dots) + a crisp
 *            lamp GLINT on the lit aspect (single highlight, gated — not dust).
 *   - BEAT = train advances one integer track cell; board scrolls one column;
 *            the passed signal clears then resets.
 *   - BAR  = route re-locks (which branch the points favour flips); next-
 *            departure highlighted row rotates.
 *   - PHRASE(%4) = track LAYOUT recomposes from genome (hard cut).
 *   - SECTION(%16) = livery PALETTE swap across committed schemes (hard cut).
 *   - DROP = ALL signals go CLEAR (green blaze, staged head-by-head), train
 *            runs flat-out, board fills; brightness rides max(drop, energy).
 *   - BUILDUP = signals hold DANGER and flutter danger/caution; points twitch —
 *            the interlocking "waiting", tense-but-alive.
 *
 * Genome: dominant deck trackId seeds head count, branch topology + point
 * positions, phrase recomposition sequence, starting livery.
 *
 * Assigned tech: 24-band spectrum (aspects + board), bandsSlow (train speed/
 * fills), per-band impulses (kick point-throw, snare aspect-flip, hat dots),
 * beat phase + beatInBar (train march / board scroll), ladder bar/phrase/
 * section tiers, trend drop/buildup split, deck trackId genome.
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
const TRACK_CELLS = 32; // integer cells the train marches across

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

/** Aspect states: 0 danger(red) 1 caution(yellow) 2 double-yellow 3 clear(green). */
const ASPECT_DANGER = 0;
const ASPECT_CAUTION = 1;
const ASPECT_DOUBLE = 2;
const ASPECT_CLEAR = 3;

/**
 * Committed railway liveries. floor = flat near-black; lamps are the earned
 * brightness. aspect[] indexes danger/caution/double/clear.
 */
interface Livery {
  floor: string;
  frame: string; // gantry / track / board structure color (matte, dim)
  aspects: [string, string, string, string];
  train: string;
  dot: string; // flip-dot lit color
  dotOff: string; // flip-dot unlit face
}

const LIVERIES: Livery[] = [
  // heritage BR signalling on near-black
  {
    floor: '#070707',
    frame: '#2a2a2e',
    aspects: ['#ff2020', '#ffb020', '#ffe020', '#20ff58'],
    train: '#f2f2f2',
    dot: '#ffcf20',
    dotOff: '#1a1a1e',
  },
  // hazard amber + white on charcoal
  {
    floor: '#0a0a0c',
    frame: '#33302a',
    aspects: ['#ff2a2a', '#ffa010', '#ffd010', '#40ff70'],
    train: '#ffef50',
    dot: '#ffffff',
    dotOff: '#201d18',
  },
  // neon transit magenta/cyan on deep-indigo
  {
    floor: '#080614',
    frame: '#2a2450',
    aspects: ['#ff2f6e', '#ff9f2f', '#ffe02f', '#2fff9f'],
    train: '#2fd8ff',
    dot: '#ff2fb0',
    dotOff: '#161030',
  },
  // blueprint on navy
  {
    floor: '#04101f',
    frame: '#123a5a',
    aspects: ['#ff5a3c', '#ffc23f', '#ffe83f', '#3fffcf'],
    train: '#ffffff',
    dot: '#2fd8ff',
    dotOff: '#0a2438',
  },
];

interface Point {
  cell: number; // track cell where the switch sits (integer)
  thrown: boolean; // two-state
  branchUp: boolean; // branch diverges up or down
}

interface Genome {
  heads: number; // 4..8 signal heads
  points: number; // 2..4 switches
  pointCells: number[];
  branchDirs: boolean[];
  schemeStart: number;
  phraseSeq: number[];
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const heads = 4 + Math.floor(r() * 5); // 4..8
  const points = 2 + Math.floor(r() * 3); // 2..4
  const pointCells: number[] = [];
  const branchDirs: boolean[] = [];
  for (let i = 0; i < points; i++) {
    pointCells.push(4 + Math.floor(r() * (TRACK_CELLS - 8)));
    branchDirs.push(r() > 0.5);
  }
  const phraseSeq = [0, 1, 2, 3].map(() => Math.floor(r() * 4));
  return {
    heads,
    points,
    pointCells,
    branchDirs,
    schemeStart: Math.floor(r() * LIVERIES.length),
    phraseSeq,
  };
}

class SignalBoxRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);
  private schemeIndex = 0;

  private aspects: number[] = []; // per head: current aspect state (0..3)
  private aspectGlint: number[] = []; // per head: glint envelope (high)
  private points: Point[] = [];

  private trainCell = 0; // integer cell along the track
  private trainBranch = false; // currently routed onto a branch
  private boardScroll = 0; // integer column offset
  private nextDepRow = 0; // highlighted departure row

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;
  private beatCounter = 0;

  private kickLatched = false;
  private snareLatched = false;
  private hatLatched = false;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private trainSpeedAccum = 0; // fractional cells accumulated (bandsSlow.low)
  private dropStage = 0; // how many heads have gone clear on the drop blaze

  private pseudoBeat = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.schemeIndex = this.genome.schemeStart;
    this.rebuild(0);
  }

  private rebuild(_variant: number): void {
    const g = this.genome;
    this.aspects = new Array(g.heads).fill(ASPECT_DANGER);
    this.aspectGlint = new Array(g.heads).fill(0);
    this.points = [];
    const r = splitmix(_variant * 7331 + g.heads * 13 + 3);
    for (let i = 0; i < g.points; i++) {
      this.points.push({
        cell: mod(g.pointCells[i] + Math.floor(r() * 3), TRACK_CELLS),
        thrown: r() > 0.5,
        branchUp: g.branchDirs[i],
      });
    }
    this.dropStage = 0;
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
    const spectrum = frame.spectrum;

    // --- Identity / genome ------------------------------------------------
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

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) ----------
    const lowPresence = clamp01((bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    // sustained brightness rides max(drop, energy) where used below.

    // --- Train speed rides bandsSlow.low (glides; no per-frame jerk) -------
    const speedParam = frame.params.speed ?? 1;
    const cellsPerSec = (0.8 + slow.low * 3.5 + drop * 2.5) * speedParam;

    // --- Metric tiers -----------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * beat!.beatsPerBar);
      const beatCell = barIndex * beat!.beatsPerBar + beatWithinBar;
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
      this.pseudoBeat += dt * (0.6 + 2.2 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        if (mod(beatCell, 4) === 0) this.onBar(Math.floor(beatCell / 4));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Train marches continuously in integer cells (rides slow speed) ---
    this.trainSpeedAccum += cellsPerSec * dt;
    while (this.trainSpeedAccum >= 1) {
      this.trainSpeedAccum -= 1;
      this.trainCell = mod(this.trainCell + 1, TRACK_CELLS);
      // passing a signal head clears it briefly then it drops back.
      const headAt = Math.floor((this.trainCell / TRACK_CELLS) * this.genome.heads);
      if (headAt >= 0 && headAt < this.aspects.length) {
        this.aspects[headAt] = ASPECT_CLEAR;
        this.aspectGlint[headAt] = 1;
      }
      // routing: if the train reaches a thrown point, toggle branch.
      for (const p of this.points) {
        if (p.cell === this.trainCell && p.thrown) this.trainBranch = p.branchUp;
      }
    }

    // --- Aspects step with their mid band unless recently cleared ---------
    const n = this.aspects.length;
    for (let i = 0; i < n; i++) {
      const specIdx = Math.floor((i / Math.max(1, n)) * spectrum.length);
      const specLvl = spectrum[Math.min(spectrum.length - 1, specIdx)] ?? 0;
      const level = clamp01(specLvl * 0.7 + slow.mid * 0.4);
      // quantize band level -> aspect (danger .. clear), unless drop blaze.
      let target: number;
      if (level < 0.22) target = ASPECT_DANGER;
      else if (level < 0.45) target = ASPECT_CAUTION;
      else if (level < 0.7) target = ASPECT_DOUBLE;
      else target = ASPECT_CLEAR;
      // buildup holds danger, fluttering danger/caution (tense).
      if (buildup > 0.25) {
        target = ((i + this.beatCounter) % 2 === 0) ? ASPECT_DANGER : ASPECT_CAUTION;
      }
      // drop stages heads to clear one at a time (rate-limited blaze).
      if (drop > 0.4 && i < this.dropStage) target = ASPECT_CLEAR;
      // don't overwrite a fresh clear-on-pass glint immediately.
      if (this.aspectGlint[i] < 0.6) this.aspects[i] = target;
      if (this.aspectGlint[i] > 0) this.aspectGlint[i] = Math.max(0, this.aspectGlint[i] - dt / 0.25);
    }

    // --- Kick: THROW a point (two-state flip) + lurch train ---------------
    if (frame.impulse.low > 0.33 && !this.kickLatched) {
      this.kickLatched = true;
      if (this.points.length > 0) {
        const p = this.points[mod(this.beatCounter, this.points.length)];
        p.thrown = !p.thrown;
      }
      this.trainCell = mod(this.trainCell + 1, TRACK_CELLS);
    } else if (frame.impulse.low < 0.15) {
      this.kickLatched = false;
    }

    // --- Snare: cycle one head's aspect (hard flip) -----------------------
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.snareLatched = true;
      if (n > 0) {
        const h = mod(this.beatCounter + 1, n);
        this.aspects[h] = mod(this.aspects[h] + 1, 4);
        this.aspectGlint[h] = 1;
      }
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

    // --- Hat: scroll the flip-dot board a tick (discrete) -----------------
    if (frame.impulse.high > 0.3 && !this.hatLatched) {
      this.hatLatched = true;
      this.boardScroll = mod(this.boardScroll + 1, 64);
    } else if (frame.impulse.high < 0.14) {
      this.hatLatched = false;
    }

    // --- Draw =============================================================
    const scheme = LIVERIES[mod(this.schemeIndex, LIVERIES.length)];
    ctx.fillStyle = scheme.floor;
    ctx.fillRect(0, 0, width, height);

    const headsParam = frame.params.heads ?? 1;
    const boardParam = frame.params.board ?? 1;

    // Layout regions (top gantry / mid track / bottom board).
    const gantryY = height * 0.16;
    const trackY = height * 0.5;
    const boardTop = height * 0.66;

    // ---- Signal gantry: heads with stacked aspect lamps ------------------
    const headW = width / (n + 1);
    const lampR = Math.min(headW * 0.16, height * 0.03) * (0.8 + headsParam * 0.4);
    for (let i = 0; i < n; i++) {
      const cx = headW * (i + 1);
      // post (matte dim frame).
      ctx.strokeStyle = scheme.frame;
      ctx.lineWidth = Math.max(2, lampR * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, gantryY - lampR * 2);
      ctx.lineTo(cx, trackY - height * 0.02);
      ctx.stroke();
      // stacked lamps: 4 discs, only the current aspect is lit.
      const aspect = this.aspects[i];
      for (let a = 0; a < 4; a++) {
        const ly = gantryY - lampR * 2 + a * lampR * 2.4;
        const lit = a === aspect;
        ctx.beginPath();
        ctx.arc(cx, ly, lampR, 0, Math.PI * 2);
        ctx.fillStyle = lit ? scheme.aspects[a] : this.mixHex(scheme.floor, scheme.frame, 0.5);
        ctx.fill();
        // glint: a hard bright highlight square on the lit lamp (high band).
        if (lit && this.aspectGlint[i] > 0.05) {
          ctx.fillStyle = '#ffffff';
          const gs = lampR * 0.4 * this.aspectGlint[i];
          ctx.fillRect(Math.round(cx - lampR * 0.35), Math.round(ly - lampR * 0.35), Math.ceil(gs), Math.ceil(gs));
        }
      }
    }

    // ---- Track: schematic line + points (switches) -----------------------
    const trackLeft = width * 0.04;
    const trackRight = width * 0.96;
    const trackSpan = trackRight - trackLeft;
    const cellPx = trackSpan / TRACK_CELLS;
    // main line
    ctx.strokeStyle = scheme.frame;
    ctx.lineWidth = Math.max(3, height * 0.006);
    ctx.beginPath();
    ctx.moveTo(trackLeft, trackY);
    ctx.lineTo(trackRight, trackY);
    ctx.stroke();
    // branch stubs at points, angled to their thrown state (hard two-state).
    const branchDY = height * 0.06;
    for (const p of this.points) {
      const bx = trackLeft + p.cell * cellPx;
      const dy = p.branchUp ? -branchDY : branchDY;
      ctx.strokeStyle = p.thrown ? scheme.aspects[ASPECT_CLEAR] : scheme.frame;
      ctx.lineWidth = Math.max(3, height * 0.006);
      ctx.beginPath();
      ctx.moveTo(bx, trackY);
      ctx.lineTo(bx + cellPx * 4, trackY + (p.thrown ? dy : 0));
      ctx.stroke();
      // point lever: a small hard rectangle snapped to one of two angles.
      ctx.save();
      ctx.translate(bx, trackY);
      ctx.rotate(p.thrown ? (p.branchUp ? -0.5 : 0.5) : 0);
      ctx.fillStyle = p.thrown ? scheme.train : scheme.frame;
      ctx.fillRect(0, -cellPx * 0.12, cellPx * 1.8, cellPx * 0.24);
      ctx.restore();
    }

    // ---- Train: solid rounded block at its integer cell ------------------
    const trainX = trackLeft + this.trainCell * cellPx;
    const trainY = trackY + (this.trainBranch ? (this.points[0]?.branchUp ? -branchDY : branchDY) : 0);
    const trainW = cellPx * 3.2;
    const trainH = Math.max(cellPx * 0.9, height * 0.03);
    ctx.fillStyle = scheme.train;
    this.roundRect(ctx, trainX - trainW * 0.5, trainY - trainH * 0.5, trainW, trainH, trainH * 0.3);
    ctx.fill();
    // headlamp: a bright square at the leading edge.
    ctx.fillStyle = scheme.aspects[ASPECT_CLEAR];
    ctx.fillRect(Math.round(trainX + trainW * 0.5 - trainH * 0.35), Math.round(trainY - trainH * 0.2), Math.ceil(trainH * 0.35), Math.ceil(trainH * 0.4));

    // ---- Flip-dot departure board: rows spell the 24-band spectrum -------
    if (boardParam > 0.05) {
      const rows = Math.min(spectrum.length, Math.round(12 * boardParam));
      const boardH = (height - boardTop) * 0.94;
      const rowH = boardH / rows;
      const dotCols = 40;
      const boardLeft = width * 0.06;
      const boardW = width * 0.88;
      const dotSpace = boardW / dotCols;
      const dotR = Math.min(dotSpace * 0.36, rowH * 0.36);
      for (let row = 0; row < rows; row++) {
        const specIdx = Math.floor((row / rows) * spectrum.length);
        const lvl = clamp01((spectrum[Math.min(spectrum.length - 1, specIdx)] ?? 0) * 1.2 + (drop > 0.4 ? 0.4 : 0));
        const litN = Math.round(lvl * dotCols);
        const highlight = row === mod(this.nextDepRow, rows);
        const ry = boardTop + row * rowH + rowH * 0.5;
        for (let c = 0; c < dotCols; c++) {
          const scrolled = mod(c + this.boardScroll, dotCols);
          const lit = scrolled < litN;
          const cx = boardLeft + c * dotSpace + dotSpace * 0.5;
          ctx.beginPath();
          ctx.arc(cx, ry, dotR, 0, Math.PI * 2);
          ctx.fillStyle = lit
            ? (highlight ? scheme.aspects[ASPECT_CAUTION] : scheme.dot)
            : scheme.dotOff;
          ctx.fill();
        }
      }
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  private mixHex(a: string, b: string, t: number): string {
    const pa = this.parseHex(a);
    const pb = this.parseHex(b);
    return `rgb(${Math.round(lerp(pa[0], pb[0], t))}, ${Math.round(
      lerp(pa[1], pb[1], t)
    )}, ${Math.round(lerp(pa[2], pb[2], t))})`;
  }
  private parseHex(h: string): [number, number, number] {
    const s = h.replace('#', '');
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ];
  }

  // --- Boundary handlers -------------------------------------------------
  private onBeat(): void {
    this.beatCounter++;
    // drop blaze stages heads to clear one per beat (rate-limited).
    if (this.smoothDrop > 0.4) {
      this.dropStage = Math.min(this.aspects.length, this.dropStage + 1);
    } else {
      this.dropStage = Math.max(0, this.dropStage - 1);
    }
  }

  private onBar(barIndex: number): void {
    // route re-locks: which branch the points favour flips; next-dep rotates.
    if (this.points.length > 0) {
      const p = this.points[mod(barIndex, this.points.length)];
      p.branchUp = !p.branchUp;
    }
    this.nextDepRow = mod(this.nextDepRow + 1, 12);
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      const variant = this.genome.phraseSeq[
        mod(Math.floor(barIndex / PHRASE_BARS), this.genome.phraseSeq.length)
      ];
      this.rebuild(variant);
    }
    if (isSection) {
      this.schemeIndex = mod(
        this.genome.schemeStart + Math.floor(barIndex / SECTION_BARS),
        LIVERIES.length
      );
    }
  }
}

const params: PresetParam[] = [
  { id: 'heads', label: 'signal heads', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'speed', label: 'train speed', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'board', label: 'departure board', min: 0, max: 1.4, step: 0.05, default: 1 },
];

const g13SignalBoxPreset: VisualizerPreset = {
  id: 'g13-signal-box',
  name: 'g13 signal box',
  params,
  create: () => new SignalBoxRenderer(),
};

export default g13SignalBoxPreset;
