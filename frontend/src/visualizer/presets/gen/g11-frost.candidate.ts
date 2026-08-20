/**
 * "g11 frost" (genetic arena g11, NOVEL — INVERTED band roles: crystalline
 * growth vs thermal mass). The frame is a living negotiation between
 * high-frequency COLD and low-frequency HEAT. Legible thermodynamics, ZERO
 * dust. The win condition is legible causality (the pinball lesson): a
 * branching SKELETON is ALWAYS on screen — never a blank frame — and frost
 * accretes onto it while heat eats it away.
 *
 * INVERTED representation (highs build, bass destroys):
 *   HIGHS  — FROST: dendritic ice grows along the skeleton's branches.
 *            Growth RATE from bandsSlow.high; sustained highs slowly frost
 *            the whole skeleton (per-node frost level rises toward 1). Hard
 *            crystal facets rendered as solid diamonds/chevrons — no dust,
 *            no glow.
 *   BASS   — HEAT: a thermal mass sits at the base. Its warmth (size +
 *            palette warmth) from bandsSlow.low MELTS frost from below:
 *            nodes below the rising heat line lose frost, and the mass
 *            glows a solid warm fill.
 *   KICK   — thermal SHOCK: a heat pulse cracks the nearest frost. Solid
 *            fracture lines shoot from the mass to a frosted node, dropping
 *            its frost. Gated on impulse.low.
 *   MIDS   — the branching SKELETON itself: a genome tree/lattice grows
 *            (more visible branches) with mid content, palette-colored.
 *
 * DROP / SECTION grammar (beat.ladderBarIndex ?? beat.barIndex):
 *   DROP   — chosen by spectral balance AT the drop: a BRIGHT drop (high
 *            centroid) = instant FULL FROST (flash-freeze, all nodes → 1);
 *            a BASSY drop (low centroid) = molten CLEARING (heat line
 *            surges up, frost stripped). Rides max(drop, energy).
 *   SECTION— new skeleton genome + palette family (hard swap; comparable
 *            mean luminance — no strobe).
 *
 * FLAT-ADJACENT: solid matte fills, hard-edged facets/cracks, committed
 * palette families, source-over. No feedback buffer (nothing to contract),
 * no dust/particles/bloom. Per-frame melt/freeze are bounded envelopes on
 * per-node state, not accumulating additive fields.
 *
 * Assigned tech: bandsSlow.high (frost growth) + bands.high (freeze punch);
 * bandsSlow.low (heat/melt) + impulse.low (shock cracks); bandsSlow.mid
 * (skeleton growth); centroid (drop flavor); trend drop/buildup split;
 * ladder tiers (section skeleton+palette); trackId genome (skeleton shape).
 * Canvas 2D flat facets — crisp fills, motion by transforms + fills.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const SECTION_BARS = 16;
const MAX_CRACKS = 10;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same skeleton + palette. */
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

/** A palette family: dark bg, skeleton branch tone (mid-colored), the two
 * frost facet tones (bright cold), heat mass tone (warm), crack tone. All
 * solid/saturated, comparable mean luminance across families. */
interface Palette {
  bg: string;
  branch: string;
  frostA: string;
  frostB: string;
  heat: string;
  heatCore: string;
  crack: string;
}

const PALETTES: Palette[] = [
  // cyan/steel frost over teal skeleton, orange heat
  { bg: '#050e14', branch: '#2a9d8f', frostA: '#8ff0ff', frostB: '#3fd0ff', heat: '#ff6a1f', heatCore: '#ffd24a', crack: '#ff3b1f' },
  // violet frost over indigo skeleton, magenta heat
  { bg: '#0a0616', branch: '#6a4fd0', frostA: '#c9a8ff', frostB: '#8a5fff', heat: '#ff2e88', heatCore: '#ffb0e0', crack: '#ff4fae' },
  // white/mint frost over green skeleton, amber heat
  { bg: '#04120a', branch: '#3fbf6a', frostA: '#d8ffe6', frostB: '#5fffab', heat: '#ffab1f', heatCore: '#fff04a', crack: '#ff6a1f' },
  // ice blue frost over slate skeleton, red heat
  { bg: '#0a0e18', branch: '#4a6fbf', frostA: '#bfe6ff', frostB: '#6aa8ff', heat: '#ff3b3b', heatCore: '#ffcf6a', crack: '#ff2020' },
];

interface Node {
  x: number;
  y: number;
  /** index of parent node (-1 for root nodes at the base). */
  parent: number;
  /** depth in the tree, 0 = base. */
  depth: number;
  /** per-node frost accretion 0..1 (grows with highs, melts with heat). */
  frost: number;
  /** how "grown" this branch is (mids reveal deeper branches) 0..1. */
  grown: number;
  /** facet orientation seed. */
  seed: number;
}

interface Crack {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  life: number;
}

class FrostRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private nodes: Node[] = [];
  private paletteIndex = 0;
  private paletteOrder: number[] = PALETTES.map((_, i) => i);

  private prevBar: number | null = null;

  /** heat mass envelope (bass) and the rising melt line (0 base .. 1 top). */
  private heat = 0;
  private meltLine = 0;

  private cracks: Crack[] = [];

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private dropLatched = false;

  private reseed(key: number): void {
    const r = splitmix(key);
    // Build a branching skeleton rooted at the base (bottom center-ish),
    // growing upward/outward — a genome tree. Nodes carry frost/grown state.
    this.nodes = [];
    const roots = 2 + Math.floor(r() * 2); // 2..3 trunks
    for (let t = 0; t < roots; t++) {
      const rootX = 0.5 + (t - (roots - 1) / 2) * 0.22 + (r() - 0.5) * 0.06;
      this.growBranch(r, rootX, 0.98, -Math.PI / 2 + (r() - 0.5) * 0.3, 0, -1);
    }
    // Palette walk order (genome).
    const order = PALETTES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    this.paletteOrder = order;
    this.paletteIndex = order[0];
    this.heat = 0;
    this.meltLine = 0;
    this.cracks = [];
  }

  /** recursive branch grower; positions in [0,1] normalized space. */
  private growBranch(
    r: () => number,
    x: number,
    y: number,
    angle: number,
    depth: number,
    parent: number
  ): void {
    if (depth > 5 || this.nodes.length > 120) return;
    const len = (0.14 - depth * 0.016) * (0.8 + r() * 0.5);
    const nx = clamp01(x + Math.cos(angle) * len);
    const ny = clamp01(y + Math.sin(angle) * len * 1.2);
    const idx = this.nodes.length;
    this.nodes.push({
      x: nx,
      y: ny,
      parent,
      depth,
      frost: 0,
      grown: depth === 0 ? 1 : 0,
      seed: r() * Math.PI * 2,
    });
    // Branch into 1..2 children with angular spread.
    const branches = depth < 2 ? 2 : r() < 0.6 ? 2 : 1;
    for (let b = 0; b < branches; b++) {
      const spread = (0.5 + r() * 0.5) * (b === 0 ? -1 : 1);
      this.growBranch(r, nx, ny, angle + spread * 0.5, depth + 1, idx);
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

    // --- Identity / genome --------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (this.nodes.length === 0) {
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
    const drive = Math.max(drop, clamp01(energy * 1.4));

    // --- DROP event: flash-freeze OR molten clearing by centroid ----------
    if (drive > 0.55 && !this.dropLatched) {
      this.dropLatched = true;
      if (frame.centroid > 0.5) {
        // bright drop → instant full frost.
        for (const n of this.nodes) n.frost = 1;
      } else {
        // bassy drop → molten clearing: heat surges, frost stripped low.
        this.meltLine = 0.85;
        for (const n of this.nodes) {
          if (1 - n.y < this.meltLine) n.frost *= 0.1;
        }
      }
    }
    if (drive < 0.35) this.dropLatched = false;

    // --- HEAT (bass): thermal mass at base; melt line rises with it -------
    const heatGain = frame.params.heat ?? 1;
    const targetHeat = clamp01(bandsSlow.low * heatGain);
    this.heat += (targetHeat - this.heat) * (1 - Math.exp(-dt / 0.4));
    // melt line tracks heat (0 = base only .. up the frame). Smoothed.
    const targetMelt = 0.12 + 0.5 * this.heat + 0.25 * drop * (frame.centroid < 0.5 ? 1 : 0);
    this.meltLine += (targetMelt - this.meltLine) * (1 - Math.exp(-dt / 0.5));

    // --- FROST (highs): growth rate from bandsSlow.high -------------------
    const frostGain = frame.params.frostGrowth ?? 1;
    const growRate = bandsSlow.high * frostGain * 0.9;
    for (const n of this.nodes) {
      // mids reveal deeper branches (skeleton grows/prunes).
      const revealTarget = clamp01((bandsSlow.mid * 1.4) - n.depth * 0.14 + 0.2);
      n.grown += (revealTarget - n.grown) * (1 - Math.exp(-dt / 0.6));
      // frost grows on grown branches; melts below the heat line.
      const nodeHeightFromBase = 1 - n.y;
      if (nodeHeightFromBase < this.meltLine) {
        // in the warm zone: melt (rate rises with heat).
        n.frost = Math.max(0, n.frost - dt * (0.4 + 1.6 * this.heat));
      } else {
        n.frost = clamp01(n.frost + dt * growRate * n.grown);
      }
    }

    // --- KICK: thermal shock crack on nearest frosted node ----------------
    if (frame.impulse.low > 0.18 && this.cracks.length < MAX_CRACKS) {
      // find the most-frosted node above the heat line and crack it.
      let best = -1;
      let bestFrost = 0.15;
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        if (n.frost > bestFrost) {
          bestFrost = n.frost;
          best = i;
        }
      }
      if (best >= 0) {
        const n = this.nodes[best];
        this.cracks.push({
          fromX: 0.5,
          fromY: 0.98,
          toX: n.x,
          toY: n.y,
          life: 1,
        });
        n.frost *= 0.35; // shock drops the frost
      }
    }
    for (const c of this.cracks) c.life -= dt / 0.22;
    this.cracks = this.cracks.filter((c) => c.life > 0);

    // --- Render -------------------------------------------------------------
    const pal = PALETTES[mod(this.paletteIndex, PALETTES.length)];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    const px = (nx: number) => nx * width;
    const py = (ny: number) => ny * height;

    // 1) SKELETON branches (mids): solid lines, palette-colored. Always
    //    present — the frame is never blank.
    ctx.lineCap = 'round';
    for (const n of this.nodes) {
      if (n.parent < 0) continue;
      const p = this.nodes[n.parent];
      const g = clamp01(n.grown);
      if (g < 0.04) continue;
      ctx.strokeStyle = pal.branch;
      ctx.lineWidth = Math.max(1, (6 - n.depth) * g);
      ctx.globalAlpha = 0.55 + 0.45 * g;
      ctx.beginPath();
      ctx.moveTo(px(p.x), py(p.y));
      ctx.lineTo(px(n.x), py(n.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 2) FROST facets (highs): solid diamonds/chevrons on frosted nodes.
    //    Facet SIZE = frost level; two cold tones for flat depth. No dust.
    for (const n of this.nodes) {
      if (n.frost < 0.05) continue;
      const cx = px(n.x);
      const cy = py(n.y);
      const s = n.frost * width * 0.022 * (0.7 + 0.6 * n.grown);
      // primary facet (bright) — a hard diamond.
      ctx.fillStyle = pal.frostA;
      drawDiamond(ctx, cx, cy, s, n.seed);
      // secondary smaller facet offset (darker cold tone) for crystalline
      // read.
      ctx.fillStyle = pal.frostB;
      drawDiamond(ctx, cx + s * 0.5, cy - s * 0.4, s * 0.55, n.seed + 1.2);
      // dendritic spurs: two short chevrons off the node when heavily frosted.
      if (n.frost > 0.55) {
        ctx.strokeStyle = pal.frostA;
        ctx.lineWidth = Math.max(1, s * 0.18);
        const a = n.seed;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * s * 1.4, cy + Math.sin(a) * s * 1.4);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a + 2.2) * s * 1.2, cy + Math.sin(a + 2.2) * s * 1.2);
        ctx.stroke();
      }
    }

    // 3) HEAT mass (bass): a solid warm dome at the base whose size/warmth
    //    ride bandsSlow.low. Buildup keeps it tense-but-alive (a low ember).
    const massW = width * (0.3 + 0.4 * this.heat);
    const massH = height * (0.06 + 0.28 * this.heat + 0.03 * buildup);
    const baseY = height * 0.99;
    // outer warm dome
    ctx.fillStyle = pal.heat;
    ctx.beginPath();
    ctx.moveTo(width * 0.5 - massW / 2, baseY);
    ctx.quadraticCurveTo(width * 0.5, baseY - massH * 1.6, width * 0.5 + massW / 2, baseY);
    ctx.closePath();
    ctx.fill();
    // inner core (hotter tone) — solid, size rides heat.
    ctx.fillStyle = pal.heatCore;
    ctx.beginPath();
    ctx.moveTo(width * 0.5 - massW * 0.28, baseY);
    ctx.quadraticCurveTo(
      width * 0.5,
      baseY - massH * (0.9 + 0.4 * this.heat),
      width * 0.5 + massW * 0.28,
      baseY
    );
    ctx.closePath();
    ctx.fill();

    // Melt-line indicator: a faint warm horizontal band showing the front
    // where heat is stripping frost (legible thermodynamics).
    const mlY = height * (1 - this.meltLine);
    ctx.fillStyle = pal.heat;
    ctx.globalAlpha = 0.12 + 0.12 * this.heat;
    ctx.fillRect(0, mlY, width, height - mlY);
    ctx.globalAlpha = 1;

    // 4) CRACKS (kick shock): solid fracture lines from mass to node.
    for (const c of this.cracks) {
      const life = clamp01(c.life);
      ctx.strokeStyle = pal.crack;
      ctx.globalAlpha = life;
      ctx.lineWidth = Math.max(1.5, width * 0.004 * life);
      ctx.beginPath();
      ctx.moveTo(px(c.fromX), py(c.fromY));
      // a jagged 2-segment crack toward the target.
      const midX = (c.fromX + c.toX) / 2 + (c.toY - c.fromY) * 0.12;
      const midY = (c.fromY + c.toY) / 2;
      ctx.lineTo(px(midX), py(midY));
      ctx.lineTo(px(c.toX), py(c.toY));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Section boundary: new skeleton + palette family (hard swap).
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    if (tierBar !== null) {
      const barIndex = tierBar as number;
      if (this.prevBar === null) this.prevBar = barIndex;
      if (barIndex !== this.prevBar) {
        if (mod(barIndex, SECTION_BARS) === 0) {
          const sectionIndex = Math.floor(barIndex / SECTION_BARS);
          // new skeleton keyed off track + section, new palette from order.
          const key = (this.lastTrackId ?? 1) * 131 + sectionIndex * 977;
          this.reseed(key);
          this.paletteIndex =
            this.paletteOrder[mod(sectionIndex, this.paletteOrder.length)];
        }
        this.prevBar = barIndex;
      }
    }
  }
}

/** a hard-edged solid diamond facet (rotated square) — crystalline, no blur. */
function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  rot: number
): void {
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  // four corners of a diamond (square rotated 45° + rot).
  const pts: [number, number][] = [
    [0, -s],
    [s * 0.7, 0],
    [0, s],
    [-s * 0.7, 0],
  ];
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [dx, dy] = pts[i];
    const rx = dx * c - dy * sn;
    const ry = dx * sn + dy * c;
    if (i === 0) ctx.moveTo(cx + rx, cy + ry);
    else ctx.lineTo(cx + rx, cy + ry);
  }
  ctx.closePath();
  ctx.fill();
}

const params: PresetParam[] = [
  { id: 'frostGrowth', label: 'frost growth', min: 0.4, max: 2, step: 0.05, default: 1.1 },
  { id: 'heat', label: 'heat mass', min: 0.5, max: 1.8, step: 0.05, default: 1 },
];

const g11FrostPreset: VisualizerPreset = {
  id: 'g11-frost',
  name: 'g11 frost',
  params,
  create: () => new FrostRenderer(),
};

export default g11FrostPreset;
