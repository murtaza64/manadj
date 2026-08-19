/**
 * g10-vitrail (gen-10 candidate, NOVEL — FLAT wave × TONALITY).
 *
 * The human's tonality idea, third attempt, in a COMPLETELY NEW visual
 * metaphor (clean-room: nothing of g08-chameleon's aurora/warp language is
 * reused — only its tonality-derivation math is borrowed, cited below).
 *
 * METAPHOR: a STAINED-GLASS WINDOW. A voronoi lattice of solid-color panes
 * sits on a dark matte stone field, separated by lead-line cames (the black
 * lattice). Everything is flat: solid matte fills, hard came edges, NO glow /
 * bloom / haze / particles / feedback smear. Canvas 2D, hard-edged polygons.
 * Depth is only the flat lead lattice over flat panes.
 *
 * TWO POLES on the tonality axis (u_tonal 1 = tonal .. 0 = percussive):
 *
 *   TONAL POLE — COLOR does all the work; geometry is nearly STILL.
 *     Each pane holds a solid saturated color drawn from a WIDE flat gamut
 *     (>= 6 hue families visible at once; spectral spread widens the gamut).
 *     Panes RE-COLOR in slow harmonic waves — a smooth spatial phase sweeps
 *     the window and each pane snaps (discrete, no gradient) to its palette
 *     slot as the wave passes. A KICK launches a colored pane-lighting wave:
 *     a front crosses the window and re-colors panes to a fresh gamut slot in
 *     solid steps (no bloom, no luminance flash). The lattice does not move.
 *
 *   PERCUSSIVE POLE — MOTION / FRACTURE does the work; color drains.
 *     Panes desaturate to 2-3 stony tones (slate/ash/sand). The LATTICE goes
 *     KINETIC: on each kick the voronoi RE-SEEDS locally (a cluster of pane
 *     sites jump) so the glass visibly re-breaks; the came lines jolt with a
 *     1-frame geometric shear (a transform, never a flash). A SNARE SHATTERS
 *     one pane into hard-edged sub-panes (flat fills, no particles). Buildup
 *     raises fracture density (more sites jump per kick). Drop RE-BREAKS the
 *     whole window in beat-locked steps, riding max(drop, energy). All energy
 *     is carried by geometry change — luminance stays flat.
 *
 *   TRANSITION — a traveling RECOLORING FRONT crosses the window pane by
 *     pane (discrete flood): panes behind the front already belong to the new
 *     pole's look, panes ahead hold the old. Flooding to tonal = color floods
 *     in pane by pane; draining to percussive = panes go stony pane by pane
 *     while the lattice starts to jitter.
 *
 * TONALITY DERIVATION (borrowed verbatim from g08-chameleon — the ONLY reuse):
 *   flatness ships already (0 tonal .. 1 noisy). tonalRaw = 1 - flatness,
 *   EMA-smoothed ~750ms. Reduced by a rolling impulse-density window (~1s ring,
 *   rising-edge counted so a sustained level doesn't inflate it). A second slow
 *   slew (~0.6s) so the pole never snaps. u_tonal -> 1 tonal, -> 0 percussive.
 *
 * IDENTITY: the lattice topology + gamut family is a trackId GENOME (pattern
 *   g02-julia): a splitmix hash of the dominant audible deck's trackId seeds
 *   the pane site layout, the hue-family set, and the stone-tone triad. Same
 *   song => same window. Section boundary (ladderBarIndex ?? barIndex, %16)
 *   re-rolls a NEW lattice topology + NEW gamut.
 *
 * MOTION SMOOTHNESS (docs/visualizer-ga.md): all rate/velocity terms (harmonic
 *   wave speed, lattice jitter baseline, front travel) ride
 *   frame.bandsSlow ?? frame.bands; instantaneous bands/impulse only drive the
 *   pops (kick recolor wave, snare shatter, kick re-seed). NO feedback buffer.
 *   Fracture events are GEOMETRY changes, never luminance flashes -> photosafe
 *   by construction.
 *
 * Assigned tech: spectral flatness (tonality), spread (gamut breadth),
 *   centroid (hue bias), per-band impulses (kick recolor/re-seed, snare
 *   shatter, hat pane-glint), energy trend (drop/buildup split), bpm cadence,
 *   ladder tiers (section re-roll), deck trackId genome, bandsSlow motion.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

// ---- Song genome (JS-side, pattern g02-julia) -------------------------

/** splitmix32 avalanche -> stream of stable scalars in [0,1). */
function splitmix(key: number): () => number {
  let state = (key >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

/** Dominant audible deck's trackId (highest master-audible level); null. */
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

// ---- Pane model -------------------------------------------------------

interface Pane {
  /** Site position in [0,1]^2 (voronoi seed). */
  sx: number;
  sy: number;
  /** Home site (site eases back after a fracture jolt). */
  homeX: number;
  homeY: number;
  /** Palette slot this pane resolves to (which hue family in the gamut). */
  slot: number;
  /** Target slot the recoloring wave is sweeping this pane toward. */
  targetSlot: number;
  /** 0..1 progress of the current slot flip (discrete-feeling: eased fast). */
  flipT: number;
  /** Stone-tone index at the percussive pole (0..2). */
  stone: number;
  /** Shatter sub-seeds: when > 0, the pane draws as sub-panes. Decays to 0. */
  shatter: number;
  /** Per-pane phase offset for the harmonic recolor wave. */
  wavePhase: number;
}

const N_PANES = 46; // committed pane count (legible, not busy)

interface Gamut {
  /** 6-8 hue families (H in [0,1]) — the tonal-pole flat gamut. */
  hues: number[];
  /** Saturation for tonal panes. */
  sat: number;
  /** Stone-tone triad [H, S, L] for the percussive pole. */
  stones: [number, number, number][];
}

/** Build a genome-seeded gamut: >= 6 spread hue families + a stone triad. */
function buildGamut(rnd: () => number, spread: number): Gamut {
  const nHues = 6 + Math.floor(rnd() * 3); // 6..8 families
  const base = rnd();
  // Spread widens the wheel coverage; a small golden-ratio hop guarantees
  // separation so families never collapse to one hue.
  const coverage = 0.55 + 0.45 * spread; // fraction of the wheel spanned
  const hues: number[] = [];
  for (let i = 0; i < nHues; i++) {
    const t = i / nHues;
    const h = (base + t * coverage + (rnd() - 0.5) * 0.06) % 1;
    hues.push((h + 1) % 1);
  }
  // Stone triad: 2-3 desaturated tones (slate/ash/sand), genome-chosen hue.
  const stoneHue = rnd();
  const stones: [number, number, number][] = [
    [stoneHue, 0.1, 0.26],
    [(stoneHue + 0.08) % 1, 0.06, 0.4],
    [(stoneHue + 0.5) % 1, 0.08, 0.32],
  ];
  return { hues, sat: 0.78, stones };
}

/** Lay out N pane sites from the genome (jittered grid -> irregular voronoi). */
function buildPanes(rnd: () => number): Pane[] {
  const panes: Pane[] = [];
  const cols = 8;
  const rows = Math.ceil(N_PANES / cols);
  let k = 0;
  for (let r = 0; r < rows && k < N_PANES; r++) {
    for (let c = 0; c < cols && k < N_PANES; c++) {
      const jx = (rnd() - 0.5) * 0.9;
      const jy = (rnd() - 0.5) * 0.9;
      const sx = (c + 0.5 + jx * 0.6) / cols;
      const sy = (r + 0.5 + jy * 0.6) / rows;
      panes.push({
        sx,
        sy,
        homeX: sx,
        homeY: sy,
        slot: Math.floor(rnd() * 6),
        targetSlot: Math.floor(rnd() * 6),
        flipT: 1,
        stone: Math.floor(rnd() * 3),
        shatter: 0,
        wavePhase: rnd() * Math.PI * 2,
      });
      k++;
    }
  }
  return panes;
}

function hslCss(h: number, s: number, l: number): string {
  return `hsl(${((h % 1) * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
}

const params: PresetParam[] = [
  { id: 'tonalBias', label: 'tonality bias (perc↔tonal)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { id: 'percWeight', label: 'transient weight', min: 0, max: 1.5, step: 0.05, default: 0.8 },
  { id: 'fractureGain', label: 'fracture gain (percussive)', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'colorGain', label: 'color gain (tonal)', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'waveSpeed', label: 'harmonic wave speed', min: 0.3, max: 2, step: 0.05, default: 1 },
];

class VitrailRenderer implements PresetRenderer {
  private lastTime = 0;
  // Tonality state (derivation borrowed from g08-chameleon).
  private tonalEMA = 0.5; // ~750ms EMA of (1 - flatness)
  private tonality = 0.5; // after transient-density reduction + second slew
  private readonly HITS = 24;
  private hitTimes: number[] = [];
  private prevKick = 0;
  private prevSnare = 0;
  // Traveling recoloring front (pole transition), 0..1 across the window x.
  private front = 1; // 1 = no front active (rests past the right edge)
  private frontDir = 1; // +1 flooding to tonal, -1 draining to percussive
  private lastPoleTarget = 0.5;
  // Smoothed dynamics.
  private smoothDrop = 0;
  private smoothBuildup = 0;
  private smoothEnergy = 0;
  // Harmonic recolor wave phase (tonal pole).
  private wavePhaseGlobal = 0;
  // Kick recolor wave (tonal): a colored front crossing the window, 0..1+.
  private recolorWave = 2; // >1 = inactive
  private recolorSlotBase = 0;
  // Section + identity.
  private lastSectionIndex = -1;
  private seededKey: number | null = null;
  private lastTrackId: number | null = null;
  private gamut: Gamut = buildGamut(splitmix(1), 0.5);
  private panes: Pane[] = buildPanes(splitmix(1));
  // Percussive lattice jitter (baseline rides bandsSlow; kicks re-seed).
  private jitter = 0;
  // Beat-locked re-break stepper (drop): fire on new bar/beat.
  private lastBeatStep = -1;

  private reseed(key: number, spread: number): void {
    const rndG = splitmix(Math.round(key) ^ 0x51ed);
    const rndP = splitmix(Math.round(key));
    this.gamut = buildGamut(rndG, spread);
    const fresh = buildPanes(rndP);
    // Preserve count; adopt the new sites/slots (a re-break of the window).
    this.panes = fresh;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt =
      this.lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - this.lastTime)) : 1 / 60;
    this.lastTime = frame.time;

    const tonalBias = frame.params.tonalBias ?? 0;
    const percWeight = frame.params.percWeight ?? 0.8;
    const fractureGain = frame.params.fractureGain ?? 1;
    const colorGain = frame.params.colorGain ?? 1;
    const waveSpeed = frame.params.waveSpeed ?? 1;

    const bandsSlow = frame.bandsSlow ?? frame.bands;

    // ---- TONALITY (borrowed from g08-chameleon) ----
    const emaAlpha = 1 - Math.exp(-dt / 0.75);
    const tonalRaw = 1 - frame.flatness;
    this.tonalEMA += (tonalRaw - this.tonalEMA) * emaAlpha;

    const kick = frame.impulse.low;
    const snare = frame.impulse.mid;
    if (kick > 0.32 && this.prevKick <= 0.32) this.hitTimes.push(frame.time);
    if (snare > 0.28 && this.prevSnare <= 0.28) this.hitTimes.push(frame.time);
    this.prevKick = kick;
    this.prevSnare = snare;
    while (this.hitTimes.length && frame.time - this.hitTimes[0] > 1.0) this.hitTimes.shift();
    while (this.hitTimes.length > this.HITS) this.hitTimes.shift();
    const density = Math.min(1, this.hitTimes.length / 6);

    const tonalTarget = Math.min(
      1,
      Math.max(0, this.tonalEMA - density * percWeight * 0.7 + tonalBias)
    );
    this.tonality += (tonalTarget - this.tonality) * (1 - Math.exp(-dt / 0.6));
    const tonal = this.tonality;
    const perc = 1 - tonal;

    // ---- Dynamics (voyage idiom): excitement split by bass presence ----
    const smoothAlpha = 1 - Math.exp(-dt / 0.35);
    const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * smoothAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * smoothAlpha;
    const energy = energyOf(frame.bands);
    this.smoothEnergy += (Math.min(1, energy * 1.4) - this.smoothEnergy) * (1 - Math.exp(-dt / 0.5));
    const sustain = Math.max(this.smoothDrop, this.smoothEnergy);

    // ---- Identity: trackId genome; section boundary re-rolls topology+gamut.
    const trackId = dominantTrackId(frame);
    const key =
      trackId != null
        ? trackId
        : Math.round((this.tonalEMA * 4096 + frame.centroid * 811 + frame.spread * 173) * 131);
    if (this.seededKey == null) {
      this.seededKey = key;
      this.lastTrackId = trackId;
      this.reseed(key, frame.spread);
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.seededKey = key;
      this.lastTrackId = trackId;
      this.reseed(key, frame.spread);
    }

    const beat = frame.beat;
    const barOrdinal = beat ? (beat.ladderBarIndex ?? beat.barIndex) : 0;
    const sectionIndex = Math.floor(barOrdinal / 16);
    if (sectionIndex !== this.lastSectionIndex && this.lastSectionIndex >= 0) {
      // NEW lattice topology + NEW gamut (section = theatre).
      this.reseed((this.seededKey ?? 1) + sectionIndex * 1013, frame.spread);
    }
    this.lastSectionIndex = sectionIndex;

    // ---- TRAVELING RECOLORING FRONT (pole transition) ----
    // Launch a pane-by-pane flood when the pole crosses a threshold.
    if (this.front >= 1) {
      const delta = tonal - this.lastPoleTarget;
      if (Math.abs(delta) > 0.14) {
        this.frontDir = delta > 0 ? 1 : -1;
        this.front = 0;
        this.lastPoleTarget = tonal;
      } else {
        this.lastPoleTarget += (tonal - this.lastPoleTarget) * (1 - Math.exp(-dt / 1.5));
      }
    } else {
      this.front += dt / 0.9; // sweep the window in ~0.9s (> 500ms floor)
      if (this.front >= 1) this.lastPoleTarget = tonal;
    }

    // ---- Harmonic recolor wave (tonal pole): global phase rides bandsSlow.
    const waveHz = (0.12 + 0.5 * tonal) * waveSpeed * (0.7 + 0.6 * bandsSlow.mid);
    this.wavePhaseGlobal += dt * waveHz * (1 + 0.5 * this.smoothDrop);

    // ---- KICK: two responses, gated by pole (both discrete, no flash) ----
    // Tonal kick = colored pane-lighting wave crosses the window.
    this.recolorWave += dt / 0.7; // travels across in ~0.7s
    if (kick > 0.3 && tonal > 0.25 && this.recolorWave > 0.9) {
      this.recolorWave = 0;
      this.recolorSlotBase = Math.floor(Math.random() * this.gamut.hues.length);
    }
    // Percussive kick = local voronoi RE-SEED (glass re-breaks) + lattice jolt.
    const fractureDensity = Math.min(
      1,
      (0.12 + 0.55 * this.smoothBuildup + 0.4 * this.smoothDrop) * fractureGain
    );
    if (kick > 0.3 && perc > 0.25) {
      const jolt = Math.min(1, kick * 1.3) * perc * fractureGain;
      this.jitter = Math.max(this.jitter, jolt);
      // Re-seed a cluster of pane sites (buildup raises how many).
      const nJump = 2 + Math.floor(fractureDensity * 10);
      for (let j = 0; j < nJump; j++) {
        const p = this.panes[Math.floor(Math.random() * this.panes.length)];
        p.sx = Math.min(1, Math.max(0, p.homeX + (Math.random() - 0.5) * 0.16 * jolt * 2));
        p.sy = Math.min(1, Math.max(0, p.homeY + (Math.random() - 0.5) * 0.16 * jolt * 2));
      }
    }
    // Sites ease back toward home (the glass settles between re-breaks).
    const easeBack = 1 - Math.exp(-dt / 0.5);
    for (const p of this.panes) {
      p.sx += (p.homeX - p.sx) * easeBack;
      p.sy += (p.homeY - p.sy) * easeBack;
    }
    // Baseline lattice jitter rides bandsSlow (motion smoothness); decays.
    this.jitter = Math.max(perc * 0.12 * bandsSlow.low * fractureGain, this.jitter - dt / 0.18);

    // ---- SNARE: shatter one pane into hard-edged sub-panes ----
    if (snare > 0.3 && perc > 0.2) {
      const p = this.panes[Math.floor(Math.random() * this.panes.length)];
      p.shatter = Math.min(1, snare * 1.2) * perc;
    }
    for (const p of this.panes) p.shatter = Math.max(0, p.shatter - dt / 0.6);

    // ---- DROP: whole-window re-break in beat-locked steps ----
    if (beat && perc > 0.2) {
      const step = Math.floor(barOrdinal * 4 + (beat.barPhase ?? 0) * 4); // ~ per beat
      if (step !== this.lastBeatStep && sustain > 0.35) {
        this.lastBeatStep = step;
        const shove = Math.min(1, sustain) * perc * fractureGain;
        for (const p of this.panes) {
          if (Math.random() < 0.35 * shove) {
            p.sx = Math.min(1, Math.max(0, p.homeX + (Math.random() - 0.5) * 0.14 * shove * 2));
            p.sy = Math.min(1, Math.max(0, p.homeY + (Math.random() - 0.5) * 0.14 * shove * 2));
          }
        }
        this.jitter = Math.max(this.jitter, shove);
      }
    }

    // ---- Slot-flip progression (harmonic wave sweeps panes to slots) ----
    const hatGlint = frame.impulse.high;
    for (const p of this.panes) {
      // Wave value at this pane's position + its phase offset.
      const wv =
        0.5 +
        0.5 *
          Math.sin(this.wavePhaseGlobal + p.wavePhase + p.homeX * 5.2 + p.homeY * 3.1);
      const desired = Math.floor(wv * this.gamut.hues.length) % this.gamut.hues.length;
      if (desired !== p.targetSlot && p.flipT >= 1) {
        p.slot = p.targetSlot;
        p.targetSlot = desired;
        p.flipT = 0;
      }
      p.flipT = Math.min(1, p.flipT + dt / 0.25); // fast, discrete-feeling flip
      void hatGlint;
    }

    // =================================================================
    // DRAW — flat matte fills, hard came edges. Nearest-site voronoi over
    // a coarse cell grid (hard-edged, cheap, no per-pixel loop).
    // =================================================================
    const hueBias = (frame.centroid - 0.5) * 0.12 * colorGain;
    const gamutSat = Math.min(1, this.gamut.sat * colorGain * (0.7 + 0.5 * tonal));

    // Dark flat stone background (not black-void).
    const bgStone = this.gamut.stones[0];
    ctx.fillStyle = hslCss(bgStone[0], 0.12, 0.1 + 0.03 * this.smoothEnergy);
    ctx.fillRect(0, 0, width, height);

    // Resolve each pane's fill color once.
    const paneColor = (p: Pane, wobble: number): string => {
      // Front-local pole: panes behind the front already belong to new pole.
      let localTonal = tonal;
      if (this.front < 1) {
        const passed =
          this.frontDir > 0 ? p.homeX <= this.front : p.homeX >= 1 - this.front;
        if (passed) localTonal = this.frontDir > 0 ? Math.max(tonal, 0.85) : Math.min(tonal, 0.15);
      }
      // Kick recolor wave (tonal): panes the wave has passed take a fresh slot.
      let slot = p.flipT >= 0.5 ? p.targetSlot : p.slot;
      if (this.recolorWave <= 1 && localTonal > 0.25) {
        if (p.homeX <= this.recolorWave) {
          slot =
            (this.recolorSlotBase + Math.floor(p.homeY * this.gamut.hues.length)) %
            this.gamut.hues.length;
        }
      }
      const hue = this.gamut.hues[slot % this.gamut.hues.length];
      // Tonal fill: saturated flat color. Value flat (no per-pane brightness
      // pumping — color, not light).
      const tonalL = 0.5 + wobble * 0.04;
      const tonalCol: [number, number, number] = [hue + hueBias, gamutSat, tonalL];
      // Percussive fill: stony tone (2-3 tones), flat.
      const st = this.gamut.stones[p.stone % this.gamut.stones.length];
      const percCol: [number, number, number] = [st[0], st[1], st[2]];
      // Blend by local pole (hard-ish, but eased so transitions read).
      const h = tonalCol[0] * localTonal + percCol[0] * (1 - localTonal);
      const s = tonalCol[1] * localTonal + percCol[1] * (1 - localTonal);
      const l = tonalCol[2] * localTonal + percCol[2] * (1 - localTonal);
      return hslCss(h, s, l);
    };

    // Voronoi rasterization via a coarse cell grid: for each grid cell find
    // the nearest jittered site; fill hard-edged rectangles. Cheap + flat.
    const jit = this.jitter;
    const sites = this.panes.map((p) => {
      // Apply the percussive lattice jolt as a per-pane shear (transform).
      const shx = jit > 0.001 ? (Math.sin(p.wavePhase * 3.7 + this.lastBeatStep) * jit * 0.03) : 0;
      const shy = jit > 0.001 ? (Math.cos(p.wavePhase * 2.9 + this.lastBeatStep) * jit * 0.03) : 0;
      return { x: (p.sx + shx) * width, y: (p.sy + shy) * height, p };
    });

    const GX = 96;
    const GY = Math.max(24, Math.round((GX * height) / width));
    const cw = width / GX;
    const chh = height / GY;
    // Nearest-site index per grid cell.
    const cellSite = new Int32Array(GX * GY);
    for (let gy = 0; gy < GY; gy++) {
      const py = (gy + 0.5) * chh;
      for (let gx = 0; gx < GX; gx++) {
        const px = (gx + 0.5) * cw;
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < sites.length; i++) {
          const dx = sites[i].x - px;
          const dy = sites[i].y - py;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        cellSite[gy * GX + gx] = best;
      }
    }

    // Fill cells (merge horizontal runs of the same site into rects: hard
    // edges, cheap). Wobble = a per-pane phase for the tonal value micro-var.
    for (let gy = 0; gy < GY; gy++) {
      let runStart = 0;
      let runSite = cellSite[gy * GX];
      for (let gx = 1; gx <= GX; gx++) {
        const s = gx < GX ? cellSite[gy * GX + gx] : -2;
        if (s !== runSite) {
          if (runSite >= 0) {
            const p = sites[runSite].p;
            const wobble = Math.sin(this.wavePhaseGlobal * 0.5 + p.wavePhase);
            ctx.fillStyle = paneColor(p, wobble);
            ctx.fillRect(
              Math.floor(runStart * cw),
              Math.floor(gy * chh),
              Math.ceil((gx - runStart) * cw) + 1,
              Math.ceil(chh) + 1
            );
            // Shatter: sub-panes drawn as hard-edged flat splits.
            if (p.shatter > 0.02) {
              const rx = runStart * cw;
              const ry = gy * chh;
              const rw = (gx - runStart) * cw;
              const nSub = 3;
              for (let k = 0; k < nSub; k++) {
                const t0 = k / nSub;
                const shade = 0.5 + (k - 1) * 0.12 * p.shatter;
                ctx.fillStyle = hslCss(
                  this.gamut.stones[(p.stone + k) % 3][0],
                  0.1,
                  Math.max(0.14, Math.min(0.55, shade * 0.6))
                );
                ctx.fillRect(
                  Math.floor(rx + t0 * rw),
                  Math.floor(ry),
                  Math.ceil(rw / nSub) + 1,
                  Math.ceil(chh) + 1
                );
              }
            }
          }
          runStart = gx;
          runSite = s;
        }
      }
    }

    // ---- Lead-line lattice (cames): hard black edges between panes. Draw a
    // dark line wherever adjacent cells belong to different sites. This is a
    // solid matte stroke, not a glow.
    const lw = Math.max(1.4, Math.min(width, height) * 0.004);
    const latticeShift = perc > 0.3 ? jit * 2.5 : 0; // percussive lattice jolt
    ctx.strokeStyle = `hsl(${(bgStone[0] * 360).toFixed(0)} 20% ${(6 + latticeShift * 4).toFixed(0)}%)`;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const here = cellSite[gy * GX + gx];
        if (gx + 1 < GX && cellSite[gy * GX + gx + 1] !== here) {
          const x = (gx + 1) * cw;
          ctx.moveTo(x, gy * chh);
          ctx.lineTo(x, (gy + 1) * chh);
        }
        if (gy + 1 < GY && cellSite[(gy + 1) * GX + gx] !== here) {
          const y = (gy + 1) * chh;
          ctx.moveTo(gx * cw, y);
          ctx.lineTo((gx + 1) * cw, y);
        }
      }
    }
    ctx.stroke();

    // ---- Traveling recoloring-front seam: a solid vertical came marking the
    // flood edge (geometry, not glow) while a transition is active.
    if (this.front < 1) {
      const fx = (this.frontDir > 0 ? this.front : 1 - this.front) * width;
      ctx.strokeStyle = this.frontDir > 0
        ? hslCss(this.gamut.hues[0] + hueBias, gamutSat, 0.5)
        : hslCss(bgStone[0], 0.1, 0.3);
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      ctx.moveTo(fx, 0);
      ctx.lineTo(fx, height);
      ctx.stroke();
    }
  }
}

const g10VitrailPreset: VisualizerPreset = {
  id: 'g10-vitrail',
  name: 'g10 vitrail',
  params,
  create: () => new VitrailRenderer(),
};

export default g10VitrailPreset;
