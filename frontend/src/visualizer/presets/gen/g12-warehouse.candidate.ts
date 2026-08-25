/**
 * "g12 warehouse" (genetic arena g12, NOVEL — TECHNO WAVE: dark,
 * monochromatic, kinetic). A near-black concrete WAREHOUSE seen in hard
 * perspective: charcoal pillars, a beam grid overhead, a raked floor grid.
 * The whole scene is grayscale; ONE cold accent hue (genome-chosen per
 * section) touches only LIT edges. The protagonist is a single industrial
 * LIGHT BAR (a linear fixture) — the room re-lights when it moves, but the
 * geometry never flashes.
 *
 *   KICK    — the bar SLAMS to a new station (hard cut): position + angle
 *             snap, every lit edge in the room re-picks at once. Gated on
 *             impulse.low. PHOTOSAFE: only the DIRECTION of lighting swaps;
 *             the lit-edge budget (how many edges glow) is held constant, so
 *             total frame luminance does not jump — a re-light, not a flash.
 *   BASS     — the bar's THROW: spread/reach of its lit cone. bandsSlow.low
 *             (a slow attribute — glides, does not jerk).
 *   MIDS     — geometry sway (slow lean) + the bar's slow TRAVEL rate between
 *             slams. bandsSlow.mid drives the rates (motion-smoothness law).
 *   HIGHS    — spark ticks: a discrete bright pip where the bar's line meets
 *             a pillar edge (hairline, not glow).
 *   BUILDUP  — the bar flickers DARKER (light-starving — dread by removal,
 *             the inverse of glow). Lit-edge budget shrinks.
 *   DROP     — strobe-WALK: one hard reposition per beat riding
 *             max(drop, energy), rate-limited to <=2 repositions/sec, each
 *             luminance-constant (same budget, re-angled). Accent floods the
 *             lit edges.
 *   SECTION  — new pillar layout + gray ramp + accent hue (hard cut).
 *
 * Dust is BACK (human ask) but DIVERSIFIED: three species keyed to the three
 * bands, each its own gray + faint tint, drifting — never the old wash.
 *
 * FLAT LAW: solid matte fills, hard edges, no glow/bloom/additive/feedback.
 * >=90% of the frame is grayscale; accent is edge-only. Canvas 2D — crisp.
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
/** Discrete stations the light bar JUMPS between (legible, not smear). */
const BAR_STATIONS = 8;
/** Minimum seconds between hard repositions — the <=2/s photosafety gate. */
const MIN_REPOSITION_S = 0.5;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same layout/palette. */
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

/** A monochrome ramp + ONE accent hue. Grays are near-black concrete; the
 * accent only ever paints lit edges. Ramp means comparable across sections
 * (a section swap is a chroma/geometry event, not a luminance flash). */
interface Scheme {
  /** the accent hue in HSL degrees (cold: white-ish or a single cool hue). */
  accentHue: number;
  /** accent saturation 0..100 (0 = pure white accent). */
  accentSat: number;
}

const SCHEMES: Scheme[] = [
  { accentHue: 0, accentSat: 0 }, // pure white
  { accentHue: 200, accentSat: 90 }, // cold cyan
  { accentHue: 28, accentSat: 95 }, // sodium amber (industrial)
  { accentHue: 275, accentSat: 80 }, // cold violet
  { accentHue: 150, accentSat: 85 }, // toxic green
];

/** Charcoal ground tones — deliberately near-black. */
const GROUND = '#08090b';
const CONCRETE_DARK = '#141619';
const CONCRETE_MID = '#1e2126';
const EDGE_UNLIT = '#2a2e34';

interface Pillar {
  /** normalized floor x in [-1, 1]. */
  x: number;
  /** depth 0 (near) .. 1 (far). */
  depth: number;
  hw: number;
  h: number;
  phase: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: 0 | 1 | 2; // low / mid / high
}

class WarehouseRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;
  private pillars: Pillar[] = [];
  private motes: Mote[] = [];
  private grayRamp = 0; // 0..1 nudges concrete brightness per section

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;

  /** light bar station (eased current + hard target). */
  private station = 0;
  private barX = 0; // eased screen-normalized x of the bar
  private barXTarget = 0;
  private barAngle = 0;
  private barAngleTarget = 0;
  private lastRepositionAt = -10;

  /** eased throw (bass) and lit-edge budget (buildup starves it). */
  private throw_ = 0.5;
  private litBudget = 1;
  private sway = 0;

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
    this.grayRamp = r();
    this.relayout(r);
    this.seedMotes(r);
  }

  private relayout(r: () => number): void {
    const cols = 4 + Math.floor(r() * 3); // 4..6
    const list: Pillar[] = [];
    for (let c = 0; c < cols; c++) {
      const depth = c / (cols - 1);
      const x = (r() - 0.5) * 1.7;
      list.push({
        x,
        depth,
        hw: 0.05 + r() * 0.04,
        h: 0.45 + r() * 0.35,
        phase: r() * Math.PI * 2,
      });
    }
    // far pillars first (painter's order).
    list.sort((a, b) => b.depth - a.depth);
    this.pillars = list;
  }

  private seedMotes(r: () => number): void {
    const list: Mote[] = [];
    // diversified dust: distinct species per band, sparse (industrial, not wash).
    const counts = [10, 8, 6];
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
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null &&
      this.pillars.length === 0
    ) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.pillars.length === 0) this.reseed(1);

    // --- Regime: drop rides max(drop, energy); buildup = trend w/o low ----
    const drop = clamp01(Math.max(frame.trend.excitement, energy));
    const dropOn = drop > 0.42 && frame.bands.low > 0.25;
    const buildup = clamp01(frame.trend.excitement * (1 - clamp01(frame.bands.low * 1.5)));

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
        if (dropOn) this.tryReposition(frame.time, 3);
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

    // --- Kick slam (hard reposition, only when NOT drop-walking) ----------
    if (!dropOn && frame.impulse.low > 0.25) {
      this.tryReposition(frame.time, 3);
    }

    // --- Ease bar toward its station (fast = reads as a hard cut) ---------
    {
      const az = 1 - Math.exp(-dt / 0.05);
      this.barX += (this.barXTarget - this.barX) * az;
      let d = this.barAngleTarget - this.barAngle;
      const azA = 1 - Math.exp(-dt / (0.05 + 0.25 * (1 - bandsSlow.mid)));
      this.barAngle += d * azA;
    }

    // --- Throw (bass, slow), lit budget (buildup starves) -----------------
    const throwTarget = 0.35 + 0.6 * bandsSlow.low;
    this.throw_ += (throwTarget - this.throw_) * (1 - Math.exp(-dt / 0.4));
    // buildup flickers darker: budget dips with a fast oscillation gated by
    // buildup magnitude (light-starving). Never fully black — geometry holds.
    const flick = 1 - buildup * (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(frame.time * 22)));
    const budgetTarget = clamp01(flick);
    this.litBudget += (budgetTarget - this.litBudget) * (1 - Math.exp(-dt / 0.08));

    this.sway += dt * (0.2 + 1.4 * bandsSlow.mid);

    // --- Draw -------------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    const scale = frame.params.scale ?? 1;
    const throwGain = frame.params.throwGain ?? 1;
    const sparkGain = frame.params.sparkGain ?? 1;
    const dustGain = frame.params.dustGain ?? 1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const cx = width / 2;
    const horizon = height * 0.42;

    // The light bar's screen position: horizontal fixture that slides.
    const barPx = cx + this.barX * width * 0.42 * scale;
    const barPy = height * (0.16 + 0.05 * Math.sin(this.barAngle));
    const throwReach = this.throw_ * throwGain * this.litBudget;

    // FLOOR grid (raked perspective lines) — charcoal, unlit.
    ctx.strokeStyle = CONCRETE_DARK;
    ctx.lineWidth = Math.max(1, unit * 0.002);
    const floorTop = horizon;
    const floorBot = height;
    const rows = 9;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = floorTop + (floorBot - floorTop) * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const verts = 9;
    for (let i = 0; i <= verts; i++) {
      const fx = (i / verts) * 2 - 1;
      ctx.beginPath();
      ctx.moveTo(cx + fx * width * 0.12, floorTop);
      ctx.lineTo(cx + fx * width * 0.7, floorBot);
      ctx.stroke();
    }

    // OVERHEAD beams — thin charcoal bars near the top.
    ctx.fillStyle = CONCRETE_DARK;
    for (let i = 0; i < 6; i++) {
      const y = height * (0.04 + i * 0.02);
      ctx.fillRect(0, y, width, Math.max(1, unit * 0.004));
    }

    // PILLARS: solid charcoal blocks; a lit EDGE glows when the bar faces it.
    // Photosafe: only a FIXED FRACTION of edges are lit at once (budget), so
    // total luminance is stable across slams — only WHICH edges flip.
    const lean = 0.04 * Math.sin(this.sway);
    // pick lit set deterministically from station so a slam re-angles, not flashes.
    const litCount = Math.max(1, Math.round(this.pillars.length * 0.5 * this.litBudget));
    const rgen = splitmix(this.station * 2654435761 + this.schemeIndex);
    const litFlags = this.pillars.map(() => false);
    // choose litCount distinct pillars nearest the bar's throw side.
    const order = this.pillars
      .map((p, idx) => ({ idx, key: Math.abs(p.x - this.barX * 1.5) + rgen() * 0.3 }))
      .sort((a, b) => a.key - b.key);
    for (let i = 0; i < litCount && i < order.length; i++) litFlags[order[i].idx] = true;

    const spark = clamp01((frame.impulse.high * 0.85 + frame.bands.high * 0.15) * sparkGain);
    const accentCss = (l: number) =>
      `hsl(${scheme.accentHue}, ${scheme.accentSat}%, ${l}%)`;

    for (let pi = 0; pi < this.pillars.length; pi++) {
      const p = this.pillars[pi];
      const persp = 0.45 + 0.55 * (1 - p.depth);
      const px = cx + p.x * width * 0.42 * persp;
      const baseY = floorTop + (floorBot - floorTop) * (1 - p.depth) * 0.9;
      const hw = p.hw * width * persp;
      const ph = p.h * height * persp;
      const leanX = (lean + 0.02 * Math.sin(this.sway + p.phase)) * width * persp;
      const topY = baseY - ph;

      // body — matte concrete, brightness by depth (grayscale).
      const bodyShade = 0.5 < this.grayRamp ? CONCRETE_MID : CONCRETE_DARK;
      ctx.fillStyle = p.depth < 0.4 ? CONCRETE_MID : bodyShade;
      ctx.beginPath();
      ctx.moveTo(px - hw + leanX, topY);
      ctx.lineTo(px + hw + leanX, topY);
      ctx.lineTo(px + hw, baseY);
      ctx.lineTo(px - hw, baseY);
      ctx.closePath();
      ctx.fill();

      // lit edge: the vertical facing the bar. Accent-tinted when in the lit
      // set, else a dim gray edge. Reach scales the glow LENGTH not intensity.
      const facingLeft = px > barPx;
      const ex = facingLeft ? px - hw : px + hw;
      const exTop = facingLeft ? px - hw + leanX : px + hw + leanX;
      if (litFlags[pi]) {
        const litLen = 0.4 + 0.6 * throwReach;
        ctx.strokeStyle = scheme.accentSat === 0 ? '#e8ecf2' : accentCss(62);
        ctx.lineWidth = Math.max(1.5, unit * 0.004);
        ctx.beginPath();
        ctx.moveTo(exTop, topY);
        ctx.lineTo(ex, baseY - ph * (1 - litLen));
        ctx.stroke();

        // HIGH spark pip where the bar's line crosses this pillar edge.
        if (spark > 0.08) {
          ctx.fillStyle = scheme.accentSat === 0 ? '#ffffff' : accentCss(80);
          ctx.globalAlpha = clamp01(0.4 + 0.6 * spark);
          const py = topY + ph * (0.3 + 0.4 * ((this.station + pi) % 3) / 3);
          ctx.beginPath();
          ctx.arc(exTop, py, unit * 0.004 * (0.6 + spark), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.strokeStyle = EDGE_UNLIT;
        ctx.lineWidth = Math.max(1, unit * 0.002);
        ctx.beginPath();
        ctx.moveTo(exTop, topY);
        ctx.lineTo(ex, baseY);
        ctx.stroke();
      }
    }

    // THE LIGHT BAR itself — a horizontal linear fixture (the protagonist).
    // Bright but SMALL area (a thin bar), rotated by barAngle. Its brightness
    // is held constant (photosafe); only position/angle move.
    ctx.save();
    ctx.translate(barPx, barPy);
    ctx.rotate(this.barAngle * 0.5);
    const barW = width * (0.12 + 0.1 * throwReach);
    const barH = Math.max(2, unit * 0.008);
    ctx.fillStyle = scheme.accentSat === 0 ? '#f4f6fa' : accentCss(70);
    ctx.globalAlpha = 0.9 * this.litBudget;
    ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    // a faint downward throw wedge (grayscale, low alpha — direction cue).
    ctx.globalAlpha = 0.06 * this.litBudget * throwReach;
    ctx.fillStyle = scheme.accentSat === 0 ? '#c8ccd4' : accentCss(50);
    ctx.beginPath();
    ctx.moveTo(-barW / 2, 0);
    ctx.lineTo(barW / 2, 0);
    ctx.lineTo(barW * (0.6 + throwReach), height * 0.5);
    ctx.lineTo(-barW * (0.6 + throwReach), height * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // DUST — diversified species per band; each own gray + faint tint, drift.
    if (dustGain > 0.01) {
      const bandLevels = [frame.bands.low, frame.bands.mid, frame.bands.high];
      const speciesTint = ['#3a3f47', '#4a4048', '#40484a'];
      for (const m of this.motes) {
        m.x += m.vx * dt * (0.5 + bandLevels[m.species]);
        m.y += m.vy * dt * (0.5 + bandLevels[m.species]) + dt * 0.008;
        if (m.x < -1) m.x = 1;
        if (m.x > 1) m.x = -1;
        if (m.y < -1) m.y = 1;
        if (m.y > 1) m.y = -1;
        const lvl = bandLevels[m.species];
        if (lvl < 0.04) continue;
        const sx = cx + m.x * width * 0.5;
        const sy = height * 0.5 + m.y * height * 0.45;
        ctx.fillStyle = speciesTint[m.species];
        ctx.globalAlpha = clamp01(0.15 + 0.45 * lvl) * dustGain;
        const r = unit * (0.0012 + 0.0016 * (m.species + 1) * lvl);
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Reposition the bar to a fresh station, respecting the <=2/s gate. */
  private tryReposition(now: number, step: number): void {
    if (now - this.lastRepositionAt < MIN_REPOSITION_S) return;
    this.lastRepositionAt = now;
    this.station = mod(this.station + step, BAR_STATIONS);
    this.barXTarget = (this.station / (BAR_STATIONS - 1)) * 1.6 - 0.8;
    this.barAngleTarget = (this.station / BAR_STATIONS) * Math.PI - Math.PI / 2;
  }

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.grayRamp = r();
      this.relayout(r);
    } else if (isPhrase) {
      // phrase nudge: re-angle the room even outside drops.
      this.station = mod(this.station + 2, BAR_STATIONS);
      this.barXTarget = (this.station / (BAR_STATIONS - 1)) * 1.6 - 0.8;
      this.barAngleTarget = (this.station / BAR_STATIONS) * Math.PI - Math.PI / 2;
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'field scale', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'throwGain', label: 'light throw', min: 0.5, max: 1.8, step: 0.05, default: 1 },
  { id: 'sparkGain', label: 'edge sparks', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'dustGain', label: 'dust', min: 0, max: 1.5, step: 0.05, default: 0.7 },
];

const g12WarehousePreset: VisualizerPreset = {
  id: 'g12-warehouse',
  name: 'g12 warehouse',
  params,
  create: () => new WarehouseRenderer(),
};

export default g12WarehousePreset;
