/**
 * "g13 chladni" (genetic arena g13, NOVEL — territory: natural phenomena /
 * physics, resonance / cymatics / standing waves).
 *
 * A square Chladni plate driven at a resonant frequency: standing waves form
 * nodal lines (amplitude zero) where sand piles up, off the antinodes. The
 * classic figure is the zero-set of
 *     f(x,y) = cos(mπx)cos(nπy) − cos(nπx)cos(mπy)
 * for integer mode numbers (m,n). We render the plate as a SOLID matte fill
 * and paint bright SAND cells in a hard band around |f| ≈ 0 — flat, crisp,
 * dark floor, no glow / feedback / additive haze.
 *
 * FLAT LAW: solid matte fills, hard edges, a committed 3-color scheme
 * (plate / sand / accent), hard-swapped at section boundaries. Motion is
 * TRANSFORMS (plate tremor, quantized 90° phrase rotation) and quantized
 * MODE FLIPS + COLOR SWAPS. `source-over` only.
 *
 * Band vocabulary (distinct):
 *   low  — primary mode m + plate DRIVE (line thickness / sand throw). KICK
 *          (impulse.low) snaps m to the next mode in the genome sequence: the
 *          whole figure re-topologizes (scene-scale hard cut). Sand migrates.
 *   mid  — secondary mode n + nodal-line thickness. SNARE (impulse.mid)
 *          tremors n by ±1 for one settle + brightens the sand accent.
 *   high — grain SHIMMER: HAT (impulse.high) sprays loose specks on the
 *          antinodes that die in a frame (sizzle, not persistent dust).
 *
 * Grammar: BUILDUP thickens lines + raises mode order (tense, never still);
 * DROP goes high-order + inverts sand⇄plate for the plateau (max(drop,
 * energy)); PHRASE snaps a quantized 90° plate rotation; SECTION hard-swaps
 * the 3-color scheme (chroma event, luminance parity → photosafe).
 *
 * Assigned tech: 24-band spectrum + bandsSlow, per-band impulses (PRIMARY),
 * trend drop/buildup split (~0.35 s), beat + ladder tiers, trackId genome
 * (mode sequence + scheme order), centroid (accent hue bias). Canvas 2D flat.
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
const PI = Math.PI;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same sequences. */
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

/** A committed flat 3-color scheme: dark plate, bright sand, accent.
 * Bright/saturated (project taste); comparable mean luminance so section
 * swaps are chroma events, not brightness flashes. */
interface FlatScheme {
  plate: string;
  sand: string;
  accent: string;
}

const SCHEMES: FlatScheme[] = [
  // deep indigo plate / electric cyan sand / magenta accent
  { plate: '#0b1026', sand: '#2fe6ff', accent: '#ff2e88' },
  // black-green plate / lime sand / orange accent
  { plate: '#08160c', sand: '#a8ff1f', accent: '#ff8a00' },
  // maroon plate / gold sand / sky accent
  { plate: '#1c0910', sand: '#ffc61a', accent: '#37c8ff' },
  // deep violet plate / white-hot sand / green accent
  { plate: '#120a24', sand: '#f2f0ff', accent: '#39ff9e' },
  // sea plate / coral sand / chartreuse accent
  { plate: '#04141a', sand: '#ff6b52', accent: '#c6ff2a' },
  // slate plate / hot pink sand / cyan accent
  { plate: '#151223', sand: '#ff44c4', accent: '#2ff0ff' },
];

/** A loose speck the hats throw; dies in a frame or two. */
interface Speck {
  x: number;
  y: number;
  life: number;
}

class ChladniRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  /** genome: order sections walk through the scheme table. */
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;
  /** genome: mode-number sequence the kick flips through. */
  private modeSeq: number[] = [1, 2, 3, 2, 4, 3, 5, 2];
  private modeStep = 0;

  /** current + target mode numbers (integer); sand migrates target→current. */
  private m = 2;
  private n = 3;
  private mTarget = 2;
  private nTarget = 3;
  /** migration weight 0..1 (1 = fully settled on target figure). */
  private settle = 1;

  /** phrase-owned quantized plate rotation (radians, multiples of π/2). */
  private rotSteps = 0;

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** brief sand-accent brighten pulse (snare). */
  private accentPulse = 0;
  /** plate tremor phase (resonance wobble). */
  private tremorPhase = 0;

  /** gridless pseudo-beat clock. */
  private pseudoBeat = 0;

  private specks: Speck[] = [];

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
    // mode sequence: distinct integers 1..6, genome-shuffled length 8.
    const seq: number[] = [];
    for (let k = 0; k < 8; k++) seq.push(1 + Math.floor(r() * 6));
    this.modeSeq = seq;
    this.modeStep = 0;
  }

  /** advance to the next mode-flip (kick). */
  private flipMode(): void {
    this.modeStep = (this.modeStep + 1) % this.modeSeq.length;
    const base = this.modeSeq[this.modeStep];
    // m and n share the sequence but offset so they rarely equal (equal m,n
    // gives a degenerate zero figure). n leads m by two steps.
    this.mTarget = base;
    this.nTarget = this.modeSeq[(this.modeStep + 2) % this.modeSeq.length];
    if (this.nTarget === this.mTarget) this.nTarget = this.mTarget + 1;
    this.settle = 0; // re-migrate sand toward the new figure
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
    const bands = frame.bands;
    const bandsSlow = frame.bandsSlow ?? frame.bands;

    // --- Identity / genome -------------------------------------------------
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
    const lowPresence = clamp01((bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);
    const dropOn = drive > 0.42;

    // --- Beat clock: kick mode-flip, phrase rotation, section scheme -------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    // KICK → mode flip (gated on impulse.low: solid response, not powder).
    if (frame.impulse.low > 0.2) {
      // only flip once per kick edge: track via a small refractory timer
      if (this.settle > 0.55) this.flipMode();
    }

    // SNARE → n tremor + accent brighten.
    if (frame.impulse.mid > 0.12) {
      this.nTarget = Math.max(1, this.nTarget + (Math.random() < 0.5 ? -1 : 1));
      if (this.nTarget === this.mTarget) this.nTarget = this.mTarget + 1;
      this.accentPulse = 1;
      this.settle = Math.min(this.settle, 0.4);
    }
    this.accentPulse = Math.max(0, this.accentPulse - dt / 0.18);

    // HAT → loose specks (sizzle) on the antinodes.
    if (frame.impulse.high > 0.14) {
      const count = 3 + Math.floor(frame.impulse.high * 14);
      for (let k = 0; k < count; k++) {
        this.specks.push({ x: Math.random(), y: Math.random(), life: 1 });
      }
    }
    // age specks
    for (const s of this.specks) s.life -= dt / 0.14;
    this.specks = this.specks.filter((s) => s.life > 0);
    if (this.specks.length > 400) this.specks.splice(0, this.specks.length - 400);

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * PHRASE_BARS);
      const beatCell = barIndex * PHRASE_BARS + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        // on drops, subdivide: also flip on offbeats for a dense storm.
        if (dropOn && this.settle > 0.4) this.flipMode();
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.pseudoBeat += dt * (0.7 + 2.2 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        if (mod(beatCell, PHRASE_BARS) === 0) this.onBarCut(Math.floor(beatCell / PHRASE_BARS));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Buildup pushes mode order up (denser figure); settle migration ---
    if (buildup > 0.5 && this.settle > 0.9 && Math.random() < buildup * dt * 3) {
      this.mTarget = Math.min(6, this.mTarget + 1);
      this.settle = 0.5;
    }
    // migration: mode numbers snap when settle crosses; sand slides visually.
    const settleRate = dt / 0.22;
    this.settle = Math.min(1, this.settle + settleRate);
    if (this.settle >= 0.5 && (this.m !== this.mTarget || this.n !== this.nTarget)) {
      this.m = this.mTarget;
      this.n = this.nTarget;
    }

    // resonance tremor (motion, rides bandsSlow so it's not jerky).
    const tremorParam = frame.params.tremor ?? 0.8;
    const tremorRate = 4 + 22 * bandsSlow.low * (dropOn ? 1.8 : 1);
    this.tremorPhase += dt * tremorRate;
    const tremorAmp = tremorParam * (0.15 + 0.85 * Math.max(bandsSlow.low, drive)) *
      (dropOn ? 1.4 : 1);

    // --- Scene --------------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    // Drop inverts sand⇄plate for the plateau (held).
    const plateCol = dropOn ? scheme.sand : scheme.plate;
    const sandCol = dropOn ? scheme.plate : scheme.sand;
    const accentCol = scheme.accent;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = plateCol;
    ctx.fillRect(0, 0, width, height);

    // The plate is a centered square; phrase rotation snaps it.
    const gridParam = frame.params.grid ?? 1;
    const sandParam = frame.params.sand ?? 1;
    const side = Math.min(width, height) * 0.94;
    const cx = width / 2;
    const cy = height / 2;
    const rot = this.rotSteps * (PI / 2);
    // small resonance wobble around the snapped rotation.
    const wobble = Math.sin(this.tremorPhase) * 0.02 * tremorAmp;
    const cos = Math.cos(rot + wobble);
    const sin = Math.sin(rot + wobble);

    // Coarse grid of cells; sand where |field| ~ 0. Cell size from param.
    const cells = Math.round(120 * gridParam);
    const step = side / cells;
    const half = side / 2;

    // Drive sets the nodal-line band width (loud plate throws more sand).
    const driveNow = clamp01(0.25 + 0.9 * bands.low + 0.5 * buildup + 0.6 * drop);
    const lineHalf = sandParam * (0.03 + 0.05 * driveNow); // in field units
    // slight tremor displacement of the whole standing wave.
    const phaseWobble = Math.sin(this.tremorPhase * 0.5) * 0.03 * tremorAmp;

    const m = this.m;
    const n = this.n;

    ctx.fillStyle = sandCol;
    // Iterate cells in plate-local coords, transform to screen.
    for (let iy = 0; iy < cells; iy++) {
      const v = iy / (cells - 1); // 0..1
      const py = (v * 2 - 1); // -1..1
      for (let ix = 0; ix < cells; ix++) {
        const u = ix / (cells - 1);
        const px = (u * 2 - 1);
        // Chladni field on the unit square (u,v in 0..1).
        const a = Math.cos(m * PI * u + phaseWobble) * Math.cos(n * PI * v);
        const b = Math.cos(n * PI * u) * Math.cos(m * PI * v + phaseWobble);
        const f = a - b;
        if (Math.abs(f) > lineHalf) continue;
        // sand cell — transform local (px,py)·half into screen with rotation.
        const lx = px * half;
        const ly = py * half;
        const sx = cx + lx * cos - ly * sin;
        const sy = cy + lx * sin + ly * cos;
        ctx.fillRect(sx - step * 0.55, sy - step * 0.55, step * 1.1, step * 1.1);
      }
    }

    // SNARE accent: brighten a thin overlay of the nodal set in accent color.
    if (this.accentPulse > 0.02) {
      ctx.globalAlpha = clamp01(this.accentPulse) * 0.85;
      ctx.fillStyle = accentCol;
      const aLineHalf = lineHalf * 0.45;
      const skip = 2; // sparser pass, cheaper
      for (let iy = 0; iy < cells; iy += skip) {
        const v = iy / (cells - 1);
        const py = v * 2 - 1;
        for (let ix = 0; ix < cells; ix += skip) {
          const u = ix / (cells - 1);
          const px = u * 2 - 1;
          const a = Math.cos(m * PI * u + phaseWobble) * Math.cos(n * PI * v);
          const b = Math.cos(n * PI * u) * Math.cos(m * PI * v + phaseWobble);
          if (Math.abs(a - b) > aLineHalf) continue;
          const lx = px * half;
          const ly = py * half;
          const sx = cx + lx * cos - ly * sin;
          const sy = cy + lx * sin + ly * cos;
          ctx.fillRect(sx - step * 0.6, sy - step * 0.6, step * 1.2, step * 1.2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // HAT specks: loose grains scattered on the plate (sizzle). Drawn in
    // accent so they read as fresh, un-settled sand catching light.
    if (this.specks.length > 0) {
      ctx.fillStyle = accentCol;
      const g = step * 0.7;
      for (const s of this.specks) {
        ctx.globalAlpha = clamp01(s.life);
        const lx = (s.x * 2 - 1) * half;
        const ly = (s.y * 2 - 1) * half;
        const sx = cx + lx * cos - ly * sin;
        const sy = cy + lx * sin + ly * cos;
        ctx.fillRect(sx - g * 0.5, sy - g * 0.5, g, g);
      }
      ctx.globalAlpha = 1;
    }
  }

  // --- Boundary cuts ------------------------------------------------------

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      // quantized 90° plate rotation snap.
      this.rotSteps = mod(this.rotSteps + 1, 4);
    }
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
    }
  }
}

const params: PresetParam[] = [
  { id: 'grid', label: 'field resolution', min: 0.6, max: 1.6, step: 0.05, default: 1 },
  { id: 'sand', label: 'sand thickness', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'modeBase', label: 'mode floor', min: 1, max: 4, step: 1, default: 2 },
  { id: 'tremor', label: 'plate tremor', min: 0, max: 1.4, step: 0.05, default: 0.8 },
];

const g13ChladniPreset: VisualizerPreset = {
  id: 'g13-chladni',
  name: 'g13 chladni',
  params,
  create: () => new ChladniRenderer(),
};

export default g13ChladniPreset;
