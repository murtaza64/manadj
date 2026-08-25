/**
 * "g10 barred" (genetic arena g10, FLAT wave, NOVEL; Vissonance 'Barred' +
 * HillFog tradition): a one-point-perspective FLOOR GRID of solid flat bars.
 * Rows recede into depth; each row is a beat of HISTORY (newest at the front),
 * so the 24-band spectrum EXTRUDES a landscape that scrolls away from the
 * camera. 24 bars across; heights = band levels (bandsSlow-smoothed for the
 * resting motion). Classic flat-3D shading: each bar's TOP face is a light
 * tone, its FRONT face a darker tone of the same flat color — two matte fills,
 * hard edges, no gradient.
 *
 * FLAT LAW: solid matte fills, hard edges, a committed 3-color scheme (bar
 * tops / bar sides / background), hard-swapped at section boundaries. NO
 * glow/bloom/additive haze/feedback smear/noise/particles. All motion is
 * TRANSFORMS (scroll, height pops, camera yaw, row compression) and COLOR
 * SWAPS. Dark FLAT background tone. `source-over` only.
 *
 * Metric grammar:
 *   KICK   — the whole NEWEST (front) row slams up one unit and settles
 *            (transform pop, gated on impulse.low). No flash.
 *   SNARE  — a single column flashes its ACCENT tone for one captured row
 *            (mid/high impulse): a clean per-column color swap.
 *   PHRASE — camera YAW snaps a few quantized degrees (hard cut), cycling.
 *   SECTION— the 3-color scheme hard-swaps (chroma event; photosafe — mean
 *            luminance comparable across schemes, no full-field flash).
 *   DROP   — scroll speed doubles + scheme INVERTS (tops <-> sides/bg) for the
 *            plateau; rides max(drop, energy) so it holds.
 *   BUILDUP— rows COMPRESS (shorter depth spacing): visual acceleration
 *            without blur. Tense but alive.
 *
 * Assigned tech: 24-band spectrum (primary) + bandsSlow motion; per-band
 * impulses (kick row-slam / snare column flash); beat clock (row capture);
 * ladder tiers (phrase yaw, section scheme swap); trend drop/buildup split;
 * trackId genome (scheme order). Canvas 2D flat-shaded quads — crisp fills.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const BAND_COUNT = 24;
const PHRASE_BARS = 4;
const SECTION_BARS = 16;
const MAX_ROWS = 16;
/** phrase yaw steps (radians): a small quantized set the camera snaps through. */
const YAW_STEPS = [-0.18, -0.06, 0.06, 0.18];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same scheme order. */
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

/** A committed flat 3-color scheme: background, bar TOP face, bar SIDE face,
 * plus one accent for snare column flashes. Bright/saturated (project taste),
 * comparable mean luminance so section swaps are chroma events. */
interface FlatScheme {
  bg: string;
  top: string;
  side: string;
  accent: string;
}

const SCHEMES: FlatScheme[] = [
  // teal field / coral top / maroon side / cream accent
  { bg: '#132026', top: '#ff6b5e', side: '#b23a30', accent: '#ffd98a' },
  // indigo / lime top / olive side / magenta accent
  { bg: '#161326', top: '#b6ff2a', side: '#5f8a17', accent: '#ff2e88' },
  // deep sea / cyan top / teal side / amber accent
  { bg: '#0c1826', top: '#25d0ff', side: '#127a99', accent: '#ffb000' },
  // wine / peach top / brown side / mint accent
  { bg: '#22111a', top: '#ff9d6b', side: '#a5583a', accent: '#4be6a0' },
  // forest / gold top / bronze side / sky accent
  { bg: '#101c12', top: '#ffcf3f', side: '#a5851a', accent: '#5fc8ff' },
  // slate / violet top / plum side / chartreuse accent
  { bg: '#151626', top: '#9a6bff', side: '#5a3aa5', accent: '#c6ff3a' },
];

interface RowSnapshot {
  /** captured band heights, 0..1 (bandsSlow-smoothed at capture time). */
  heights: number[];
  /** column index flashed by a snare on capture, or -1. */
  accentCol: number;
  /** kick-slam bonus on this row at capture (settles as it scrolls). */
  slam: number;
}

class BarredRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  /** genome: order sections walk through the scheme table. */
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;
  /** phrase-owned camera yaw. */
  private yaw = 0;

  /** ring buffer of captured rows; index 0 = newest (front). */
  private rows: RowSnapshot[] = [];

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  /** continuous scroll offset in row-units (fractional advance between beats). */
  private scroll = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** gridless pseudo-beat clock. */
  private pseudoBeat = 0;
  /** pending snare column for the next captured row. */
  private pendingAccentCol = -1;
  /** pending kick slam for the next captured row. */
  private pendingSlam = 0;

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
  }

  private captureRow(frame: VisualizerFrameData): void {
    const bandsSlow = frame.bandsSlow ?? frame.bands;
    const heights: number[] = new Array(BAND_COUNT);
    for (let i = 0; i < BAND_COUNT; i++) {
      // Resting height rides the smoothed spectrum; blend a little 3-band
      // slow envelope so quiet passages still ripple smoothly.
      const s = frame.spectrum[i] ?? 0;
      const region = i < 8 ? bandsSlow.low : i < 16 ? bandsSlow.mid : bandsSlow.high;
      heights[i] = clamp01(0.7 * s + 0.3 * region);
    }
    this.rows.unshift({
      heights,
      accentCol: this.pendingAccentCol,
      slam: this.pendingSlam,
    });
    if (this.rows.length > MAX_ROWS) this.rows.pop();
    this.pendingAccentCol = -1;
    this.pendingSlam = 0;
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

    // --- Identity / genome --------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (this.lastTrackId === null && trackId === null && this.prevBeatCell === null) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
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

    // --- Pending per-row events (armed between captures) --------------------
    if (frame.impulse.low > 0.18) this.pendingSlam = 1;
    const snare = frame.impulse.mid * 0.7 + frame.impulse.high * 0.3;
    if (snare > 0.06) {
      // flash the loudest instantaneous column.
      let col = 0;
      let best = -1;
      for (let i = 0; i < BAND_COUNT; i++) {
        const s = frame.spectrum[i] ?? 0;
        if (s > best) {
          best = s;
          col = i;
        }
      }
      this.pendingAccentCol = col;
    }

    // --- Row capture on the beat cell (each row = a beat of history) --------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * PHRASE_BARS);
      const beatCell = barIndex * PHRASE_BARS + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.captureRow(frame);
        this.scroll = 0;
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.captureRow(frame);
        this.scroll = 0;
        if (mod(beatCell, PHRASE_BARS) === 0) this.onBarCut(Math.floor(beatCell / PHRASE_BARS));
        this.prevBeatCell = beatCell;
      }
    }

    if (this.rows.length === 0) this.captureRow(frame);

    // --- Continuous scroll (RATE rides bandsSlow, doubles on drop) ---------
    const scrollRate = (0.9 + 1.2 * bandsSlow.low) * (dropOn ? 2 : 1);
    this.scroll = Math.min(1, this.scroll + dt * scrollRate);

    // Settle kick slams as rows age.
    for (const row of this.rows) {
      row.slam = Math.max(0, row.slam - dt / 0.35);
    }

    // --- Scene setup --------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    // Drop inverts tops <-> sides/bg for the plateau (held).
    const bg = dropOn ? scheme.side : scheme.bg;
    const topCol = dropOn ? scheme.bg : scheme.top;
    const sideCol = dropOn ? scheme.top : scheme.side;
    const accentCol = scheme.accent;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const scaleParam = frame.params.scale ?? 1;
    const heightGain = frame.params.heightGain ?? 1;
    const depthParam = frame.params.depth ?? 1;

    // One-point perspective. The vanishing point sits on the horizon; yaw
    // pans it horizontally (camera yaw). Rows narrow and rise toward it.
    const horizonY = height * 0.30;
    const vpX = width * 0.5 + Math.sin(this.yaw) * width * 0.42;
    const frontY = height * 0.98;
    const centerX = width * 0.5;
    const frontHalfW = width * 0.54 * scaleParam;

    // Depth compression under buildup (visual acceleration, no blur).
    const depthCompress = 1 - 0.35 * buildup;

    /** project a depth d in [0..1] (0 front, 1 horizon) → {y, persp}. persp is
     * the fraction of the way toward the vanishing point (0 front .. 1 VP). */
    const project = (d: number): { y: number; persp: number } => {
      const t = clamp01(d);
      // Curve so far rows bunch toward the horizon; depth param spreads them.
      const persp = t / (1 + (1 - depthParam * depthCompress) * (1 - t) * 1.6 + 0.0001);
      const y = frontY + (horizonY - frontY) * persp;
      return { y, persp };
    };

    /** an x-edge in [-1,1] at depth persp: flat ground x lerped toward the VP. */
    const xAt = (edge: number, persp: number): number => {
      const flat = centerX + edge * frontHalfW;
      return flat + (vpX - flat) * persp;
    };

    const colW = 1 / BAND_COUNT;

    // Draw far rows first (painter's algorithm), front row last.
    const rowCount = this.rows.length;
    for (let ri = rowCount - 1; ri >= 0; ri--) {
      const row = this.rows[ri];
      // depth of this row's FRONT and BACK edges (scroll pushes rows back).
      const dFront = (ri + this.scroll) / MAX_ROWS;
      const dBack = (ri + this.scroll + 1) / MAX_ROWS;
      if (dFront > 1) continue;

      const pf = project(dFront);
      const pb = project(dBack);

      const rowHeightScale = pf.y - pb.y; // pixels of one depth cell (>0)

      for (let c = 0; c < BAND_COUNT; c++) {
        let h = row.heights[c];
        if (ri === 0) {
          // front row still gets the live kick slam pop on top of its capture.
          h = clamp01(h + 0.18 * row.slam);
        } else {
          h = clamp01(h + 0.12 * row.slam);
        }
        const barH = h * heightGain * (rowHeightScale * 3.2 + 4);

        const eL = c * colW * 2 - 1;
        const eR = (c + 1) * colW * 2 - 1;
        const gap = colW * 0.28; // hard flat gap between bars
        const eLg = eL + gap;
        const eRg = eR - gap;

        // Four ground corners (front-left, front-right, back-left, back-right).
        const flx = xAt(eLg, pf.persp), frx = xAt(eRg, pf.persp);
        const blx = xAt(eLg, pb.persp), brx = xAt(eRg, pb.persp);
        const fy = pf.y;
        const by = pb.y;

        const isAccent = row.accentCol === c;
        const colTop = isAccent ? accentCol : topCol;
        const colSide = isAccent ? accentCol : sideCol;

        // FRONT face (facing camera): a matte quad rising by barH.
        ctx.beginPath();
        ctx.moveTo(flx, fy);
        ctx.lineTo(frx, fy);
        ctx.lineTo(frx, fy - barH);
        ctx.lineTo(flx, fy - barH);
        ctx.closePath();
        ctx.fillStyle = colSide;
        ctx.fill();

        // TOP face (light tone): the trapezoid connecting front-top to
        // back-top edge — gives the flat-3D read.
        ctx.beginPath();
        ctx.moveTo(flx, fy - barH);
        ctx.lineTo(frx, fy - barH);
        ctx.lineTo(brx, by - barH);
        ctx.lineTo(blx, by - barH);
        ctx.closePath();
        ctx.fillStyle = colTop;
        ctx.fill();
      }
    }
  }

  // --- Boundary cuts ------------------------------------------------------

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      const phraseIndex = Math.floor(barIndex / PHRASE_BARS);
      this.yaw = YAW_STEPS[mod(phraseIndex, YAW_STEPS.length)];
    }
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'grid scale', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'heightGain', label: 'bar height', min: 0.6, max: 2, step: 0.05, default: 1.15 },
  { id: 'depth', label: 'depth spacing', min: 0.5, max: 1.5, step: 0.05, default: 1 },
];

const g10BarredPreset: VisualizerPreset = {
  id: 'g10-barred',
  name: 'g10 barred',
  params,
  create: () => new BarredRenderer(),
};

export default g10BarredPreset;
