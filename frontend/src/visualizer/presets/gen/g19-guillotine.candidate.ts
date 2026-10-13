/**
 * "g19 guillotine" (gen-19 NOVEL, nested-timescale abstract geometry —
 * ROTATION-FREE: only cuts move). A guillotine partition of the screen
 * (axis-aligned recursive splits) painted in committed flat 5-color schemes
 * with thick dark seams. Nothing rotates, nothing translates, nothing
 * eases — the strobe-column/hardcut lesson generalized: ALL motion is
 * discrete cut moves snapped to the meter.
 *
 * Nested timescales:
 *   BEAT    = one existing cut RE-SNAPS to a new eighth-fraction (single
 *             frame; the flanking panels pop on the next kick).
 *   BAR     = one cut ADDED (largest panel splits) on even epochs, one cut
 *             REMOVED (panels merge) on odd epochs.
 *   PHRASE  = panel colors re-deal (4 bars).
 *   SECTION = the partition REBUILDS at a planned cut budget — the arc
 *             [3,6,9,12,16,20,25,30] across the epoch's 8 sections
 *             (reversed on odd epochs) — plus a scheme slam.
 *   EPOCH   = 128 bars: build/dissolve direction inverts, palette family
 *             steps. Minute-1 is three vast panels; minute-10 a dense mosaic
 *             dissolving back to slabs.
 *
 * Band identity without motion: each panel hashes to low/mid/high and its
 * fill brightness rides that band — kill an EQ and its panels dim. Kick =
 * flanking-panel pop (localized); snare = one seam flashes thick; hats =
 * intersection ticks. Flat law: no glow, no blur, no dust, no feedback.
 */

import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const SECTION_BARS = 16;
const EPOCH_SECTIONS = 8;
const EPOCH_BARS = SECTION_BARS * EPOCH_SECTIONS;
const BUDGETS = [3, 6, 9, 12, 16, 20, 25, 30];
const FRACS = [0.25, 0.375, 0.5, 0.625, 0.75];
const MAX_PANELS = 48;

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

function hsl(h: number, s: number, l: number, alpha = 1): string {
  return `hsla(${mod(h, 360).toFixed(1)}, ${s}%, ${Math.min(72, Math.max(0, l))}%, ${alpha})`;
}

/** Committed flat schemes: [h, s, l] x5 panels + a dark seam floor. Panel
 * lightness kept comparable across schemes (luminance parity). */
interface Scheme {
  seam: [number, number, number];
  panels: [number, number, number][];
}

const SCHEMES: Scheme[] = [
  {
    seam: [230, 40, 7],
    panels: [[4, 90, 55], [42, 96, 54], [200, 90, 50], [330, 85, 55], [150, 80, 46]],
  },
  {
    seam: [260, 35, 7],
    panels: [[190, 92, 52], [320, 88, 56], [55, 95, 55], [265, 80, 58], [95, 85, 48]],
  },
  {
    seam: [20, 40, 7],
    panels: [[16, 94, 54], [46, 96, 55], [355, 85, 52], [28, 90, 58], [205, 82, 50]],
  },
  {
    seam: [210, 45, 6],
    panels: [[210, 90, 54], [175, 88, 48], [250, 82, 60], [195, 95, 55], [45, 92, 55]],
  },
  {
    seam: [140, 35, 6],
    panels: [[95, 88, 50], [160, 90, 46], [70, 95, 55], [300, 80, 56], [40, 92, 54]],
  },
  {
    seam: [310, 35, 7],
    panels: [[315, 90, 56], [275, 85, 58], [350, 88, 52], [220, 85, 55], [55, 95, 56]],
  },
];

interface Split {
  horizontal: boolean; // cut line runs horizontally (splits height)
  frac: number;
  a: Node;
  b: Node;
}

interface Node {
  split: Split | null;
  colorIdx: number;
  band: 'low' | 'mid' | 'high';
}

interface LeafRect {
  x: number;
  y: number;
  w: number;
  h: number;
  node: Node;
  hot: boolean;
}

interface SeamLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  node: Node;
}

const BANDS: ('low' | 'mid' | 'high')[] = ['low', 'mid', 'high'];

class GuillotineRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genomeSeed = 1;
  private schemeStart = 0;

  private root: Node = { split: null, colorIdx: 0, band: 'low' };
  private rng: () => number = splitmix(1);
  private lastSnap: Node | null = null;
  private snapLife = 0;

  private prevBeatCell: number | null = null;
  private prevBar: number | null = null;
  private prevSectionKey: number | null = null;

  private kickEnv = 0;
  private snareEnv = 0;
  private hatEnv = 0;

  private pseudoBeat = 0;

  private makeLeaf(): Node {
    return {
      split: null,
      colorIdx: Math.floor(this.rng() * 5),
      band: BANDS[Math.floor(this.rng() * 3)],
    };
  }

  /** Traverse: collect leaf rects + seam lines. `hot` marks descendants of
   * the last-snapped cut (kick pop targets). */
  private walk(
    node: Node,
    x: number,
    y: number,
    w: number,
    h: number,
    hot: boolean,
    leaves: LeafRect[],
    seams: SeamLine[]
  ): void {
    const isHot = hot || node === this.lastSnap;
    if (!node.split) {
      leaves.push({ x, y, w, h, node, hot: isHot });
      return;
    }
    const s = node.split;
    if (s.horizontal) {
      const cy = y + h * s.frac;
      seams.push({ x1: x, y1: cy, x2: x + w, y2: cy, node });
      this.walk(s.a, x, y, w, h * s.frac, isHot, leaves, seams);
      this.walk(s.b, x, cy, w, h * (1 - s.frac), isHot, leaves, seams);
    } else {
      const cx = x + w * s.frac;
      seams.push({ x1: cx, y1: y, x2: cx, y2: y + h, node });
      this.walk(s.a, x, y, w * s.frac, h, isHot, leaves, seams);
      this.walk(s.b, cx, y, w * (1 - s.frac), h, isHot, leaves, seams);
    }
  }

  private collectLeaves(node: Node, out: Node[]): void {
    if (!node.split) {
      out.push(node);
      return;
    }
    this.collectLeaves(node.split.a, out);
    this.collectLeaves(node.split.b, out);
  }

  private collectSplits(node: Node, out: Node[]): void {
    if (!node.split) return;
    out.push(node);
    this.collectSplits(node.split.a, out);
    this.collectSplits(node.split.b, out);
  }

  /** BAR (even epochs): split the largest panel at a quantized fraction. */
  private addCut(width: number, height: number): void {
    const leaves: LeafRect[] = [];
    this.walk(this.root, 0, 0, width, height, false, leaves, []);
    if (leaves.length >= MAX_PANELS) return;
    let best = leaves[0];
    for (const l of leaves) if (l.w * l.h > best.w * best.h) best = l;
    const node = best.node;
    node.split = {
      horizontal: best.h >= best.w,
      frac: FRACS[Math.floor(this.rng() * FRACS.length)],
      a: { split: null, colorIdx: node.colorIdx, band: node.band },
      b: this.makeLeaf(),
    };
  }

  /** BAR (odd epochs): merge two sibling panels — a cut vanishes. */
  private removeCut(): void {
    const candidates: Node[] = [];
    const gather = (node: Node) => {
      if (!node.split) return;
      if (!node.split.a.split && !node.split.b.split) candidates.push(node);
      gather(node.split.a);
      gather(node.split.b);
    };
    gather(this.root);
    if (candidates.length === 0) return;
    const leaves: Node[] = [];
    this.collectLeaves(this.root, leaves);
    if (leaves.length <= 2) return;
    const node = candidates[Math.floor(this.rng() * candidates.length)];
    node.colorIdx = node.split!.a.colorIdx;
    node.band = node.split!.a.band;
    node.split = null;
    if (this.lastSnap === node) this.lastSnap = null;
  }

  /** BEAT: one existing cut re-snaps to a different eighth (single frame). */
  private resnap(): void {
    const splits: Node[] = [];
    this.collectSplits(this.root, splits);
    if (splits.length === 0) return;
    const node = splits[Math.floor(this.rng() * splits.length)];
    const s = node.split!;
    let frac = s.frac;
    for (let tries = 0; tries < 4 && frac === s.frac; tries++) {
      frac = FRACS[Math.floor(this.rng() * FRACS.length)];
    }
    s.frac = frac;
    this.lastSnap = node;
    this.snapLife = 1;
  }

  /** PHRASE: re-deal panel colors (the partition holds still). */
  private redeal(): void {
    const leaves: Node[] = [];
    this.collectLeaves(this.root, leaves);
    for (const leaf of leaves) {
      leaf.colorIdx = Math.floor(this.rng() * 5);
      leaf.band = BANDS[Math.floor(this.rng() * 3)];
    }
  }

  /** SECTION: rebuild the whole partition at the planned budget. */
  private rebuild(budget: number, seedKey: number, width: number, height: number): void {
    this.rng = splitmix(this.genomeSeed ^ Math.imul(seedKey + 1, 0x9e3779b1));
    this.root = this.makeLeaf();
    this.lastSnap = null;
    this.snapLife = 0;
    for (let i = 0; i < budget; i++) this.addCut(width, height);
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const bands = frame.bands;
    const energy = Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);

    // --- Genome -------------------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (!this.seeded) {
      this.genomeSeed =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      this.schemeStart = Math.floor(splitmix(this.genomeSeed)() * SCHEMES.length);
      this.lastTrackId = trackId;
      this.seeded = true;
      this.prevSectionKey = null; // force initial rebuild
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.genomeSeed = trackId;
      this.schemeStart = Math.floor(splitmix(this.genomeSeed)() * SCHEMES.length);
      this.prevSectionKey = null;
    }

    // --- Meter (ladder tiers; pseudo-meter fallback) --------------------------
    const beat = frame.beat;
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    let bar: number;
    let barPhase: number;
    if (beat && tierBar !== null) {
      bar = tierBar;
      barPhase = clamp01(beat.barPhase);
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      bar = Math.floor(this.pseudoBeat / 4);
      barPhase = clamp01(mod(this.pseudoBeat, 4) / 4);
    }
    const epoch = Math.floor(bar / EPOCH_BARS);
    const barInEpoch = mod(bar, EPOCH_BARS);
    const section = Math.floor(barInEpoch / SECTION_BARS);
    const building = mod(epoch, 2) === 0;
    const sectionKey = epoch * EPOCH_SECTIONS + section;

    // SECTION: rebuild at the planned budget (arc reversed on odd epochs).
    if (sectionKey !== this.prevSectionKey) {
      const budget = BUDGETS[building ? section : EPOCH_SECTIONS - 1 - section];
      this.rebuild(budget, sectionKey, width, height);
      this.prevSectionKey = sectionKey;
      this.prevBar = bar;
      this.prevBeatCell = bar * 4 + Math.floor(barPhase * 4);
    }

    // BAR: add (build) / remove (dissolve) one cut; PHRASE: re-deal colors.
    if (this.prevBar === null) this.prevBar = bar;
    if (bar !== this.prevBar) {
      if (building) this.addCut(width, height);
      else this.removeCut();
      if (mod(bar, 4) === 0) this.redeal();
      this.prevBar = bar;
    }

    // BEAT: one cut re-snaps.
    const beatCell = bar * 4 + Math.floor(barPhase * 4);
    if (this.prevBeatCell === null) this.prevBeatCell = beatCell;
    if (beatCell !== this.prevBeatCell) {
      this.resnap();
      this.prevBeatCell = beatCell;
    }

    // --- Envelopes ------------------------------------------------------------
    this.kickEnv = Math.max(this.kickEnv * Math.exp(-dt / 0.16), frame.impulse.low);
    this.snareEnv = Math.max(this.snareEnv * Math.exp(-dt / 0.2), frame.impulse.mid);
    this.hatEnv = Math.max(this.hatEnv * Math.exp(-dt / 0.1), frame.impulse.high);
    this.snapLife *= Math.exp(-dt / 0.35);

    // --- Draw -------------------------------------------------------------------
    const scheme =
      SCHEMES[mod(this.schemeStart + section + epoch * 3, SCHEMES.length)];
    ctx.fillStyle = hsl(...scheme.seam);
    ctx.fillRect(0, 0, width, height);

    const leaves: LeafRect[] = [];
    const seams: SeamLine[] = [];
    this.walk(this.root, 0, 0, width, height, false, leaves, seams);

    const seamW = Math.max(
      2,
      Math.min(width, height) * 0.008 * (frame.params.seam ?? 1)
    );
    const half = seamW / 2;

    for (const leaf of leaves) {
      const [h, s, l] = scheme.panels[mod(leaf.node.colorIdx, scheme.panels.length)];
      // Band identity: panel brightness rides its band (the only continuous
      // life in a rotation-free composition).
      const level = bands[leaf.node.band];
      ctx.fillStyle = hsl(h, s, l * (0.72 + 0.4 * level));
      ctx.fillRect(leaf.x + half, leaf.y + half, Math.max(0, leaf.w - seamW), Math.max(0, leaf.h - seamW));
      // Kick pop on panels flanking the last-snapped cut (localized).
      const pop = this.kickEnv * this.snapLife;
      if (leaf.hot && pop > 0.04) {
        ctx.fillStyle = `hsla(0, 0%, 100%, ${(0.22 * pop).toFixed(3)})`;
        ctx.fillRect(leaf.x + half, leaf.y + half, Math.max(0, leaf.w - seamW), Math.max(0, leaf.h - seamW));
      }
    }

    // Snare: the last-snapped seam flashes thick + bright.
    if (this.lastSnap && this.snareEnv > 0.05) {
      for (const seam of seams) {
        if (seam.node !== this.lastSnap) continue;
        ctx.strokeStyle = hsl(scheme.panels[1][0], 100, 66, 0.8 * this.snareEnv);
        ctx.lineWidth = seamW * 2.2;
        ctx.beginPath();
        ctx.moveTo(seam.x1, seam.y1);
        ctx.lineTo(seam.x2, seam.y2);
        ctx.stroke();
      }
    }

    // Hats: intersection ticks at seam endpoints (small crosses).
    if (this.hatEnv > 0.06) {
      const t = Math.max(3, seamW * 1.6);
      ctx.strokeStyle = hsl(scheme.panels[2][0], 95, 68, 0.7 * this.hatEnv);
      ctx.lineWidth = Math.max(1, seamW * 0.4);
      ctx.beginPath();
      for (const seam of seams) {
        for (const [px, py] of [
          [seam.x1, seam.y1],
          [seam.x2, seam.y2],
        ] as const) {
          ctx.moveTo(px - t, py);
          ctx.lineTo(px + t, py);
          ctx.moveTo(px, py - t);
          ctx.lineTo(px, py + t);
        }
      }
      ctx.stroke();
    }
  }
}

const params: PresetParam[] = [
  { id: 'seam', label: 'seam weight', min: 0.4, max: 2.5, step: 0.05, default: 1 },
];

const g19GuillotinePreset: VisualizerPreset = {
  id: 'g19-guillotine',
  name: 'g19 guillotine',
  params,
  create: () => new GuillotineRenderer(),
};

export default g19GuillotinePreset;
