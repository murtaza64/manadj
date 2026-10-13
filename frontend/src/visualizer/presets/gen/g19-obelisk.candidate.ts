/**
 * gen-19: THE OBELISK — the contrast-first conductor (gh #135).
 * Brief: briefs/g19-obelisk.md. Machinery descends from g17-monolith
 * (phase hosting, 2-sub-renderer discipline, per-phase crash guard);
 * philosophy is the OPPOSITE:
 *
 *   - A phase change EVERY 16-bar section boundary, as a SINGLE-FRAME
 *     hard cut (the hardcut lesson: quantized beats smooth). No
 *     crossfades, ever.
 *   - CONTRAST MATRIX scheduling: each phase carries a trait vector
 *     (topology radial/linear/grid, density, chroma, glow, energy); the
 *     next phase maximizes trait distance from the current one (topology
 *     flips weighted highest, last 3 phases excluded) — adjacent sections
 *     are maximally different by construction.
 *   - EPOCH MACRO-ARC: 4 sections = an epoch, 8 epochs = a cycle
 *     (~17 min at 128 BPM). A complexity curve rises to epoch 6 and
 *     resolves through 7-8 back toward epoch 1; it drives each visit's
 *     params (calm→hot anchors) and the scheduler's energy target, so a
 *     phase revisited in a later epoch looks evolved. A meta-palette
 *     hue rotation (composite-time ctx.filter) completes one full turn
 *     per cycle — the final epoch resolves to the opening's color world.
 *   - regime hooks: buildup = inter-phase TENSION SHUTTER (the prewarmed
 *     NEXT phase shows through thin growing slits — continuous,
 *     photosafe) + tightening vignette; dropTransition = an armed cut
 *     LANDS ON THE DROP when a boundary is near (≤3 bars), consuming the
 *     scheduled cut; a hairline shock ring marks the landing (≥8 s
 *     cooldown).
 *
 * RESOURCES: at most 2 live sub-renderers (current + prewarming next).
 * The next phase prewarms into its own layer canvas over the last 2 bars
 * of a section (or from buildup-arming), so feedback engines cut in with
 * a populated field while the visible cut stays single-frame. Every
 * sub-render is try/catch-guarded: a crashing phase is dead for the
 * session; the obelisk itself never dies with a phase.
 *
 * ABSTRACT GEOMETRY ONLY (human ask): the pool is pure form — spiral
 * fields, mirrored strata, flat irises/tunnels/bar grids, colonnades,
 * flip matrices, truchet mazes, Chladni figures, phyllotaxis lattices,
 * scanline terrain. No figurative scenes.
 */

import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

import hypnoGlide from './g09-hypno-glide.candidate';
import mirrorStrata from './g07-mirror-strata.candidate';
import irisFlat from './g10-iris-flat.candidate';
import tricentric from './g10-tricentric.candidate';
import barred from './g10-barred.candidate';
import voyageHardcut from './g07-voyage-hardcut.candidate';
import strobeColumn from './g12-strobe-column.candidate';
import flipMatrix from './g16-flip-matrix.candidate';
import truchet from './g13-truchet.candidate';
import chladni from './g13-chladni.candidate';
import phyllotaxis from './g13-phyllotaxis.candidate';
import scanline from './g12-scanline.candidate';

/** Topology classes for the contrast matrix. */
const RADIAL = 0;
const LINEAR = 1;
const GRID = 2;

interface PhaseTraits {
  /** RADIAL | LINEAR | GRID — a flip here is the strongest contrast. */
  topo: number;
  /** Visual density 0 sparse … 1 saturated-with-detail. */
  density: number;
  /** Chromatic breadth 0 monochrome … 1 polychrome. */
  chroma: number;
  /** 0 flat matte … 1 additive glow. */
  glow: number;
  /** Intrinsic energy — matched against the epoch curve's target. */
  energy: number;
}

interface PhaseEntry {
  preset: VisualizerPreset;
  traits: PhaseTraits;
}

/** The pool: 12 abstract-geometric engines, trait-tagged for the
 * contrast scheduler. Order is identity (indexes into dead/history). */
const PHASES: PhaseEntry[] = [
  { preset: hypnoGlide, //    analytic spiral bands, multiplied layers
    traits: { topo: RADIAL, density: 0.9, chroma: 1.0, glow: 0.8, energy: 0.75 } },
  { preset: mirrorStrata, //  nested mirrored strata, quantized per tier
    traits: { topo: RADIAL, density: 0.7, chroma: 0.7, glow: 0.5, energy: 0.6 } },
  { preset: irisFlat, //      24 solid wedge petals, flat 4-color
    traits: { topo: RADIAL, density: 0.5, chroma: 0.8, glow: 0.0, energy: 0.5 } },
  { preset: tricentric, //    flat concentric polygon tunnel, off-center
    traits: { topo: RADIAL, density: 0.4, chroma: 0.7, glow: 0.0, energy: 0.45 } },
  { preset: barred, //        one-point-perspective flat bar landscape
    traits: { topo: LINEAR, density: 0.5, chroma: 0.5, glow: 0.0, energy: 0.5 } },
  { preset: voyageHardcut, // sheared galaxy w/ quantized look banks
    traits: { topo: RADIAL, density: 1.0, chroma: 1.0, glow: 1.0, energy: 0.85 } },
  { preset: strobeColumn, //  monochrome colonnade, spatial alternation
    traits: { topo: LINEAR, density: 0.3, chroma: 0.1, glow: 0.2, energy: 0.65 } },
  { preset: flipMatrix, //    GL tile matrix, district flips
    traits: { topo: GRID, density: 0.8, chroma: 0.6, glow: 0.4, energy: 0.7 } },
  { preset: truchet, //       two-color arc-maze tiling automaton
    traits: { topo: GRID, density: 0.7, chroma: 0.3, glow: 0.0, energy: 0.55 } },
  { preset: chladni, //       standing-wave nodal sand figures
    traits: { topo: GRID, density: 0.5, chroma: 0.25, glow: 0.0, energy: 0.4 } },
  { preset: phyllotaxis, //   golden-angle seed-head lattice
    traits: { topo: RADIAL, density: 0.35, chroma: 0.6, glow: 0.0, energy: 0.35 } },
  { preset: scanline, //      single seismograph sweep, phosphor traces
    traits: { topo: LINEAR, density: 0.2, chroma: 0.05, glow: 0.3, energy: 0.3 } },
];

const SECTION_BARS = 16;
const EPOCHS_PER_CYCLE = 8;
/** Pseudo-meter bar length without a beat grid (128 BPM, 4/4). */
const FALLBACK_BAR_S = 1.875;
/** Prewarm the incoming layer this many bars before the boundary. */
const PREWARM_BARS = 2;
const STINGER_S = 0.7;
const TAU = Math.PI * 2;

/** The epoch complexity curve: rise to epoch 6, resolve through 7-8 back
 * toward epoch 1 (index 8 wraps to index 0 — the long-form return). */
const EPOCH_CURVE = [0.12, 0.32, 0.5, 0.68, 0.84, 1.0, 0.62, 0.22];

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Integer mix (per-axis seed mixing — engine idiom). */
function hash32(...ns: number[]): number {
  let h = 0x9e3779b9 >>> 0;
  for (const n of ns) {
    h = (h ^ Math.imul(n | 0, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}

function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  return h | 0;
}

function rand01(...ns: number[]): number {
  return hash32(...ns) / 4294967296;
}

/** Continuous complexity at a cycle position e ∈ [0, 8): smoothstepped
 * between epoch anchors, wrapping 8 → 0 so the cycle closes. */
function complexityAt(e: number): number {
  const i = Math.floor(e) % EPOCHS_PER_CYCLE;
  const j = (i + 1) % EPOCHS_PER_CYCLE;
  return EPOCH_CURVE[i] + (EPOCH_CURVE[j] - EPOCH_CURVE[i]) * smooth01(fract(e));
}

/** Contrast distance between two trait vectors — topology flips weigh
 * highest; density/chroma/glow inversions follow. */
function contrast(a: PhaseTraits, b: PhaseTraits): number {
  return (
    (a.topo !== b.topo ? 1.15 : 0) +
    Math.abs(a.density - b.density) +
    Math.abs(a.chroma - b.chroma) +
    0.8 * Math.abs(a.glow - b.glow)
  );
}

/** A live sub-renderer with its own layer canvas. Sub-presets own their
 * layer's persistence; the conductor never clears layers, only
 * composites them onto the visible canvas. */
interface PhaseLayer {
  phaseIdx: number;
  renderer: PresetRenderer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  params: Record<string, number>;
  /** Sub-preset local clock — offset per visit so revisits don't replay. */
  time: number;
}

class ObeliskRenderer implements PresetRenderer {
  // ---- genome
  private genome = 0x0b31;
  private lastTrackId: number | null = null;

  // ---- layers (max 2 live: current + prewarming next)
  private current: PhaseLayer | null = null;
  private next: PhaseLayer | null = null;
  /** Phases that crashed this session — never scheduled again. */
  private dead = new Set<number>();
  /** Recently played phase indexes (most recent last, max 3). */
  private history: number[] = [];

  // ---- hypermeter clock
  private pseudoT = 0;
  private lastSection: number | null = null;
  /** The section index the CURRENT phase owns — a drop-cut sets this to
   * the upcoming section, consuming its scheduled boundary cut. */
  private ownedSection: number | null = null;
  private lastCutTime = -1e9;

  // ---- regime state (smoothed — raw regimes flip harshly)
  private buildS = 0;
  private breakS = 0;
  private dropPrev = 0;
  private armed = false;

  // ---- overlays
  private shutterDrift = 0;
  private stingerT = STINGER_S;
  private lastStingerAt = -1e9;

  /** Epoch-curve param resolution for one phase visit: every param slides
   * from a calm anchor toward a hot anchor with the visit's complexity,
   * genome-jittered, quantized to the param's step. */
  private visitParams(
    preset: VisualizerPreset,
    complexity: number,
    seed: number
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of preset.params ?? []) {
      const calm = p.min + (p.default - p.min) * 0.55;
      const hot = p.default + (p.max - p.default) * 0.8;
      const jit = (rand01(seed, strHash(p.id)) * 2 - 1) * 0.08 * (p.max - p.min);
      let v = calm + (hot - calm) * complexity + jit;
      if (p.step > 0) v = p.min + Math.round((v - p.min) / p.step) * p.step;
      out[p.id] = clamp(v, p.min, p.max);
    }
    return out;
  }

  /** The contrast scheduler: among alive phases not in recent history,
   * maximize trait distance from the current phase while staying near the
   * epoch curve's energy target. */
  private pickNext(currentIdx: number | null, complexity: number, salt: number): number | null {
    const targetEnergy = 0.28 + 0.6 * complexity;
    let best = -1;
    let bestScore = -1e9;
    for (let i = 0; i < PHASES.length; i++) {
      if (this.dead.has(i)) continue;
      if (i === currentIdx) continue;
      if (this.history.includes(i) && this.aliveCount() > 4) continue;
      const t = PHASES[i].traits;
      const c = currentIdx === null ? 1.5 : contrast(PHASES[currentIdx].traits, t);
      const score =
        c * 2 -
        0.9 * Math.abs(t.energy - targetEnergy) +
        0.3 * rand01(this.genome, salt, i);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  private aliveCount(): number {
    return PHASES.length - this.dead.size;
  }

  private makeLayer(
    phaseIdx: number,
    width: number,
    height: number,
    complexity: number,
    epochIdx: number
  ): PhaseLayer | null {
    const entry = PHASES[phaseIdx];
    let renderer: PresetRenderer;
    try {
      renderer = entry.preset.create();
    } catch (error) {
      console.warn(`[obelisk] phase ${entry.preset.id} failed to create`, error);
      this.dead.add(phaseIdx);
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const seed = hash32(this.genome, phaseIdx, epochIdx, 0x0be1);
    return {
      phaseIdx,
      renderer,
      canvas,
      ctx,
      params: this.visitParams(entry.preset, complexity, seed),
      // Per-visit clock offset: internal phrase/section grammars land
      // differently on each revisit — the epoch makes them EVOLVE.
      time: 29 * epochIdx + rand01(seed, 0x711) * 13,
    };
  }

  /** Guarded sub-render — a crashing phase must not kill the obelisk. */
  private renderLayer(layer: PhaseLayer, frame: VisualizerFrameData): boolean {
    try {
      layer.renderer.render(layer.ctx, layer.canvas.width, layer.canvas.height, {
        ...frame,
        params: layer.params,
        time: layer.time,
      });
      layer.time += frame.dt;
      return true;
    } catch (error) {
      console.warn(
        `[obelisk] phase ${PHASES[layer.phaseIdx].preset.id} crashed — skipping it`,
        error
      );
      this.dead.add(layer.phaseIdx);
      return false;
    }
  }

  /** THE CUT: single frame — next becomes current, the old renderer is
   * dropped outright. No fade path exists in this preset. */
  private cut(section: number, now: number): void {
    if (!this.next) return;
    if (this.current) {
      this.history.push(this.current.phaseIdx);
      while (this.history.length > 3) this.history.shift();
    }
    this.current = this.next;
    this.next = null;
    this.ownedSection = section;
    this.lastCutTime = now;
    this.armed = false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = frame.dt;
    const epochSections = Math.max(2, Math.round(frame.params.epoch ?? 4));
    const tension = frame.params.tension ?? 1;
    const drift = frame.params.drift ?? 1;

    // ---- genome: dominant-deck trackId (LAW: dominantChannel, not argmax)
    const dom = frame.dominantChannel
      ? frame.decks.find((d) => d.channel === frame.dominantChannel)
      : undefined;
    const trackId = dom?.trackId ?? null;
    if (trackId !== null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.genome = hash32(trackId, 0x0b);
    }

    // ---- hypermeter clock: ladder-correct bars → 16-bar sections
    const beat = frame.beat;
    const barSeconds =
      beat?.bpm && beat.bpm > 0
        ? (60 / beat.bpm) * Math.max(1, beat.beatsPerBar || 4)
        : FALLBACK_BAR_S;
    let tierBar: number;
    let barFrac: number;
    if (beat) {
      tierBar = beat.ladderBarIndex ?? beat.barIndex;
      barFrac = clamp(
        (beat.beatInBar + clamp(beat.phase, 0, 1)) / Math.max(1, beat.beatsPerBar || 4),
        0,
        1
      );
      this.pseudoT = (tierBar + barFrac) * barSeconds; // keep fallback continuous
    } else {
      this.pseudoT += dt;
      tierBar = Math.floor(this.pseudoT / barSeconds);
      barFrac = fract(this.pseudoT / barSeconds);
    }
    const section = Math.floor(tierBar / SECTION_BARS);
    const barsIntoSection = (tierBar - section * SECTION_BARS) + barFrac;
    const barsToBoundary = SECTION_BARS - barsIntoSection;
    let sectionBoundary = false;
    if (this.lastSection === null) {
      this.lastSection = section;
    } else if (section !== this.lastSection) {
      sectionBoundary = true; // ladder resets count as boundaries too
      this.lastSection = section;
    }

    // ---- epoch macro-arc: continuous cycle position + complexity
    const sectionsPerCycle = epochSections * EPOCHS_PER_CYCLE;
    const cycleSection =
      ((section % sectionsPerCycle) + sectionsPerCycle) % sectionsPerCycle;
    const epochPos = (cycleSection + barsIntoSection / SECTION_BARS) / epochSections;
    const epochIdx = Math.floor(epochPos) % EPOCHS_PER_CYCLE;
    const complexity = complexityAt(epochPos);
    const cyclePos = epochPos / EPOCHS_PER_CYCLE; // 0..1 across the cycle

    // ---- regime: smoothed buildup/breakdown, drop edge detect
    const regime = frame.regime;
    this.buildS += ((regime?.buildup ?? 0) - this.buildS) * Math.min(1, dt / 0.35);
    this.breakS += ((regime?.breakdown ?? 0) - this.breakS) * Math.min(1, dt / 0.5);
    const dropRaw = regime?.dropTransition ?? 0;
    const dropEdge = dropRaw > 0.55 && this.dropPrev <= 0.55;
    this.dropPrev = dropRaw;

    // A buildup ARMS the drop cut (and starts the prewarm early so the
    // tension shutter has a next phase to reveal).
    if (this.buildS > 0.4) this.armed = true;
    else if (this.buildS < 0.12 && dropRaw < 0.2) this.armed = false;

    // ---- ensure a current layer (first frame / post-crash)
    if (!this.current) {
      const pick = this.pickNext(null, complexity, section);
      if (pick !== null) {
        this.current = this.makeLayer(pick, width, height, complexity, epochIdx);
        this.ownedSection = section;
      }
      if (!this.current) {
        // Every phase dead (should never happen): show black, stay alive.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        return;
      }
    }

    // ---- prewarm the NEXT phase: last bars of the section, or on arming.
    // The complexity sampled here is the INCOMING section's (≈ boundary).
    const wantNext = barsToBoundary <= PREWARM_BARS || (this.armed && this.buildS > 0.3);
    if (wantNext && !this.next) {
      const inComplexity = complexityAt(
        ((cycleSection + 1) % sectionsPerCycle) / epochSections
      );
      const pick = this.pickNext(this.current.phaseIdx, inComplexity, section + 1);
      if (pick !== null) {
        const inEpoch =
          Math.floor(((cycleSection + 1) % sectionsPerCycle) / epochSections) %
          EPOCHS_PER_CYCLE;
        this.next = this.makeLayer(pick, width, height, inComplexity, inEpoch);
      }
    }

    // ---- cut triggers
    // 1) drop lands near a boundary: the armed cut takes the drop.
    if (
      dropEdge &&
      this.armed &&
      this.next &&
      barsToBoundary <= 3 &&
      frame.time - this.lastCutTime > 6
    ) {
      this.cut(section + 1, frame.time); // owns the UPCOMING section
      if (frame.time - this.lastStingerAt > 8) {
        this.stingerT = 0;
        this.lastStingerAt = frame.time;
      }
    }
    // 2) the clock: every section boundary is a cut (unless consumed).
    if (sectionBoundary && section !== this.ownedSection) {
      if (!this.next) {
        // No prewarm happened (ladder jump): build one now — it renders
        // once below and cuts in next frame-part, still effectively hard.
        const pick = this.pickNext(this.current.phaseIdx, complexity, section);
        if (pick !== null) {
          this.next = this.makeLayer(pick, width, height, complexity, epochIdx);
        }
      }
      if (this.next && frame.time - this.lastCutTime > 4) {
        this.cut(section, frame.time);
        if (dropRaw > 0.4 && frame.time - this.lastStingerAt > 8) {
          this.stingerT = 0;
          this.lastStingerAt = frame.time;
        }
      }
    }

    // ---- render live layers into their own canvases (guarded)
    for (const layer of [this.current, this.next]) {
      if (!layer) continue;
      if (layer.canvas.width !== width || layer.canvas.height !== height) {
        layer.canvas.width = Math.max(1, width);
        layer.canvas.height = Math.max(1, height);
      }
    }
    if (this.current && !this.renderLayer(this.current, frame)) {
      // Current crashed: promote the prewarmed next (a hard cut, early),
      // otherwise rebuild from the scheduler — never go dark.
      this.current = null;
      if (this.next) {
        this.cut(section, frame.time);
      } else {
        const pick = this.pickNext(null, complexity, section + 7);
        if (pick !== null) {
          this.current = this.makeLayer(pick, width, height, complexity, epochIdx);
          this.ownedSection = section;
        }
      }
      if (this.current) this.renderLayer(this.current, frame);
    }
    if (this.next && !this.renderLayer(this.next, frame)) this.next = null;

    // ---- composite: current, meta-palette graded by the epoch cycle
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const hueDeg = ((360 * cyclePos * drift) % 360 + 360) % 360;
    const graded = hueDeg > 1.5 && hueDeg < 358.5;
    if (graded) ctx.filter = `hue-rotate(${hueDeg.toFixed(1)}deg)`;
    if (this.current && this.current.canvas.width > 0) {
      ctx.drawImage(this.current.canvas, 0, 0);
    }

    // ---- buildup tension shutter: the NEXT phase shows through thin
    // growing slits (continuous alpha/width — photosafe, no flash).
    const shutter = clamp(this.buildS * tension, 0, 1);
    if (shutter > 0.04 && this.next && this.next.canvas.width > 0) {
      this.shutterDrift += dt * (0.05 + 0.3 * shutter);
      const count = 4 + Math.floor(9 * shutter);
      const cellW = width / count;
      const slitW = Math.max(2, cellW * (0.06 + 0.4 * shutter * shutter));
      ctx.globalAlpha = Math.min(1, shutter * 1.25);
      for (let i = 0; i < count; i++) {
        const wob = Math.sin(this.shutterDrift * TAU + i * 2.399) * cellW * 0.18;
        const sx = clamp(i * cellW + cellW * 0.5 + wob - slitW / 2, 0, width - slitW);
        ctx.drawImage(this.next.canvas, sx, 0, slitW, height, sx, 0, slitW, height);
      }
      ctx.globalAlpha = 1;
    }
    if (graded) ctx.filter = 'none';

    // ---- buildup vignette: the frame tightens (continuous)
    if (shutter > 0.03) {
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(cx, cy);
      const vig = ctx.createRadialGradient(
        cx, cy, maxR * (0.92 - 0.4 * shutter),
        cx, cy, maxR
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${(0.45 * shutter).toFixed(3)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }

    // ---- breakdown grade: a gentle dim (the phases carry their own calm)
    if (this.breakS > 0.05) {
      ctx.fillStyle = `rgba(0,0,0,${(0.14 * this.breakS).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

    // ---- drop stinger: one hairline shock ring per landing (≥8 s apart)
    if (this.stingerT < STINGER_S) {
      this.stingerT += dt;
      const t = clamp(this.stingerT / STINGER_S, 0, 1);
      const eOut = 1 - Math.pow(1 - t, 2.5);
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(cx, cy);
      const fade = 1 - t;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,244,220,${(0.7 * fade).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, maxR * 0.012 * fade);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, eOut * maxR * 1.02), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

const preset: VisualizerPreset = {
  id: 'g19-obelisk',
  name: 'g19 Obelisk',
  params: [
    { id: 'epoch', label: 'Sections per epoch', min: 2, max: 8, step: 1, default: 4 },
    { id: 'tension', label: 'Buildup tension', min: 0, max: 1.5, step: 0.05, default: 1 },
    { id: 'drift', label: 'Palette drift', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create(): PresetRenderer {
    return new ObeliskRenderer();
  },
};

export default preset;
