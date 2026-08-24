/**
 * gen-17: MONOLITH — the hour-scale conductor (gh #77).
 * Brief: briefs/g17-monolith.md.
 *
 * A CONDUCTOR preset: it renders no scene of its own. Eleven curated phase
 * engines (voyage/odyssey + materia families, tunnel-saga) are hosted as
 * PHASES, each rendered into its own layer canvas (VisualizerApp's Layer/
 * morph pattern) and composited here. A phase holds 2-4 SECTIONS of the
 * hypermeter (16-bar sections via `beat.ladderBarIndex ?? beat.barIndex`,
 * pseudo-meter at 128 BPM without a grid), then crossfades to the next on
 * a section downbeat. Musical events override the clock — this is
 * frame.regime's debut:
 *   - regime.buildup rising  → riser overlay (converging spokes,
 *     contracting rings, rising horizon, tightening vignette; photosafe —
 *     continuous, never a full-field flash) + the next cut is ARMED.
 *   - regime.dropTransition  → an armed cut lands ON the drop (~1-bar
 *     crossfade) + a one-shot radial stinger (≥8 s cooldown).
 *   - deck DOUBLES           → the next phase teased in lighter-composite
 *     at low alpha while the double holds (the app's own morph grammar).
 *   - regime.breakdown       → the live phase's params ease toward calm
 *     (defaults eased toward min) + a slow dark vignette.
 *
 * RESOURCES: at most 2 live sub-renderers ever (current + incoming/tease),
 * created lazily, dropped when their fade ends — most phases hold a WebGL
 * context (GL context limits). Every sub-render is try/catch-guarded: a
 * crashing phase is marked dead for the session and skipped; the monolith
 * itself must never die with a phase.
 *
 * Genome (dominant-deck trackId — frame.dominantChannel, never level
 * argmax) picks one of three hand-curated arc orderings + a rotation, and
 * jitters each phase's declared param defaults ±12% of range.
 */

import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

import materiaDeep from './g03-materia-deep.candidate';
import voyage from './g00-voyage.candidate';
import seasonsNeon from './g07-seasons-neon.candidate';
import odyssey from './g01-odyssey.candidate';
import primeEmbers from './g05-prime-embers.candidate';
import tunnelSaga from './g04-tunnel-saga.candidate';
import voyagePrime from './g02-voyage-prime.candidate';
import materiaShards from './g05-materia-shards.candidate';
import solarCrown from './g03-solar-crown.candidate';
import voyageHardcut from './g07-voyage-hardcut.candidate';
import materiaMetric from './g07-materia-metric.candidate';

/** The phase roster. Index order is fixed; ARCS below hold curated
 * play orders (adjacent-contrast + energy arc are hand-checked there). */
const PHASES: VisualizerPreset[] = [
  materiaDeep, //   0 calm crystalline depths
  voyage, //        1 classic advected fluid
  seasonsNeon, //   2 neon seasonal palettes
  odyssey, //       3 phrase-evolving journey
  primeEmbers, //   4 ember updraft
  tunnelSaga, //    5 canvas-2D narrative tunnel
  voyagePrime, //   6 hotter fluid
  materiaShards, // 7 glass shard bursts
  solarCrown, //    8 solar corona
  voyageHardcut, // 9 hard-cut banks
  materiaMetric, // 10 metric-locked slabs
];

/** Three hand-curated arcs: no two adjacent phases share a family (also
 * checked across the wrap), and each rises and falls in energy rather
 * than ramping monotonically. Genome picks arc + rotation. */
const ARCS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [1, 5, 0, 2, 7, 3, 8, 4, 10, 6, 9],
  [3, 2, 0, 5, 1, 8, 7, 6, 10, 4, 9],
];

const SECTION_BARS = 16;
/** Pseudo-meter bar length without a beat grid (128 BPM, 4/4). */
const FALLBACK_BAR_S = 1.875;
const STINGER_S = 0.85;
const TAU = Math.PI * 2;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** smoothstep — the same ease the app's own morph uses. */
function ease(t: number): number {
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

/** A phase's params: declared defaults, genome-jittered ±12% of range,
 * quantized to the param's step (getParamValues-style). */
function jitteredParams(
  preset: VisualizerPreset,
  seed: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of preset.params ?? []) {
    const r = rand01(seed, strHash(p.id)) * 2 - 1;
    let v = p.default + r * 0.12 * (p.max - p.min);
    if (p.step > 0) v = p.min + Math.round((v - p.min) / p.step) * p.step;
    out[p.id] = clamp(v, p.min, p.max);
  }
  return out;
}

/** A live sub-renderer with its own layer canvas (the app's Layer pattern:
 * sub-presets own their layer's persistence; the conductor never clears
 * layers, only composites them onto the visible canvas). */
interface PhaseLayer {
  phaseIdx: number;
  renderer: PresetRenderer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  baseParams: Record<string, number>;
  /** Sub-preset local clock — each phase believes it started at 0. */
  time: number;
}

class MonolithRenderer implements PresetRenderer {
  // ---- genome / phase order
  private genome = 0x2b1e;
  private lastTrackId: number | null = null;
  /** Transitions taken so far — indexes the arc together with the genome
   * rotation, so the order is stable within a track. */
  private slot = 0;
  /** Phases that crashed this session — never scheduled again. */
  private dead = new Set<number>();

  // ---- layers (max 2 live: current + outgoing|tease)
  private current: PhaseLayer | null = null;
  private outgoing: PhaseLayer | null = null;
  private tease: PhaseLayer | null = null;
  private teaseAlpha = 0;
  private morphT = 1;
  private fadeS = 6;

  // ---- hypermeter clock
  private pseudoT = 0;
  private lastSection: number | null = null;
  private sectionsElapsed = 0;
  private holdSections = 3;

  // ---- regime state (smoothed ~0.35-0.5 s — regimes flip harshly raw)
  private buildS = 0;
  private breakS = 0;
  private dropPrev = 0;
  private armed = false;
  private lastCutAt = -1e9;
  private lastStingerAt = -1e9;

  // ---- overlay animation accumulators (speeds ride smoothed values)
  private riserTravel = 0;
  private riserSpin = 0;
  private stingerT = STINGER_S;
  private stingerSeed = 1;

  private arc(): number[] {
    return ARCS[this.genome % ARCS.length];
  }

  private phaseAtSlot(slot: number): number {
    const arc = this.arc();
    return arc[(this.genome + slot) % arc.length];
  }

  /** Next alive phase ≠ current, and the slot that yields it. */
  private pickNext(): { phaseIdx: number; slot: number } | null {
    for (let step = 1; step <= PHASES.length; step++) {
      const slot = this.slot + step;
      const idx = this.phaseAtSlot(slot);
      if (this.dead.has(idx)) continue;
      if (this.current && idx === this.current.phaseIdx) continue;
      return { phaseIdx: idx, slot };
    }
    return null;
  }

  private rollHold(holdParam: number): number {
    const base = 2 + (hash32(this.genome, this.slot, 0x51ed) % 3); // 2..4 sections
    return clamp(Math.round(base * holdParam), 1, 6);
  }

  private makeLayer(phaseIdx: number, width: number, height: number): PhaseLayer | null {
    const preset = PHASES[phaseIdx];
    let renderer: PresetRenderer;
    try {
      renderer = preset.create();
    } catch (error) {
      console.warn(`[monolith] phase ${preset.id} failed to create`, error);
      this.dead.add(phaseIdx);
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return {
      phaseIdx,
      renderer,
      canvas,
      ctx,
      baseParams: jitteredParams(preset, hash32(this.genome, phaseIdx, 0xa11ce)),
      time: 0,
    };
  }

  /** Breakdown: ease this layer's params from their (jittered) defaults
   * toward calm — each value slides toward its min end as breakdown holds. */
  private layerParams(layer: PhaseLayer): Record<string, number> {
    if (this.breakS < 0.02) return layer.baseParams;
    const preset = PHASES[layer.phaseIdx];
    const k = 0.6 * this.breakS;
    const out: Record<string, number> = {};
    for (const p of preset.params ?? []) {
      const base = layer.baseParams[p.id] ?? p.default;
      const calm = p.min + (base - p.min) * 0.45;
      out[p.id] = base + (calm - base) * k;
    }
    return out;
  }

  /** Guarded sub-render — a crashing phase must not kill the monolith. */
  private renderLayer(layer: PhaseLayer, frame: VisualizerFrameData): boolean {
    try {
      layer.renderer.render(layer.ctx, layer.canvas.width, layer.canvas.height, {
        ...frame,
        params: this.layerParams(layer),
        time: layer.time,
      });
      layer.time += frame.dt;
      return true;
    } catch (error) {
      console.warn(
        `[monolith] phase ${PHASES[layer.phaseIdx].id} crashed — skipping it`,
        error
      );
      this.dead.add(layer.phaseIdx);
      return false;
    }
  }

  private startTransition(
    fast: boolean,
    barSeconds: number,
    fadeBars: number,
    holdParam: number,
    width: number,
    height: number,
    now: number
  ): void {
    if (this.outgoing) {
      // Already fading: a drop can ACCELERATE the fade, nothing stacks a
      // third live renderer.
      if (fast) this.fadeS = Math.min(this.fadeS, Math.max(0.5, barSeconds));
      return;
    }
    const pick = this.pickNext();
    if (!pick || !this.current) return;
    let incoming: PhaseLayer | null = null;
    if (this.tease && this.tease.phaseIdx === pick.phaseIdx) {
      incoming = this.tease; // the doubles tease becomes the real incoming
    }
    this.tease = null;
    this.teaseAlpha = 0;
    if (!incoming) incoming = this.makeLayer(pick.phaseIdx, width, height);
    if (!incoming) return;
    this.outgoing = this.current;
    this.current = incoming;
    this.morphT = 0;
    this.fadeS = clamp((fast ? 1 : fadeBars) * barSeconds, 0.5, 24);
    this.slot = pick.slot;
    this.sectionsElapsed = 0;
    this.holdSections = this.rollHold(holdParam);
    this.armed = false;
    this.lastCutAt = now;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = frame.dt;
    const holdParam = frame.params.hold ?? 1;
    const fadeBars = frame.params.fade ?? 4;
    const riserAmount = frame.params.riser ?? 1;

    // ---- genome: dominant-deck trackId (LAW: dominantChannel, not argmax)
    const dom = frame.dominantChannel
      ? frame.decks.find((d) => d.channel === frame.dominantChannel)
      : undefined;
    const trackId = dom?.trackId ?? null;
    if (trackId !== null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.genome = hash32(trackId, 0x77);
    }

    // ---- hypermeter clock: ladder-correct bars → 16-bar sections
    const beat = frame.beat;
    const barSeconds =
      beat?.bpm && beat.bpm > 0
        ? (60 / beat.bpm) * Math.max(1, beat.beatsPerBar || 4)
        : FALLBACK_BAR_S;
    let tierBar: number;
    if (beat) {
      tierBar = beat.ladderBarIndex ?? beat.barIndex;
      this.pseudoT = tierBar * barSeconds; // keep the fallback continuous
    } else {
      this.pseudoT += dt;
      tierBar = Math.floor(this.pseudoT / barSeconds);
    }
    const section = Math.floor(tierBar / SECTION_BARS);
    let sectionBoundary = false;
    if (this.lastSection === null) {
      this.lastSection = section;
    } else if (section !== this.lastSection) {
      sectionBoundary = true; // ladder resets count as boundaries too
      this.lastSection = section;
    }
    if (sectionBoundary) this.sectionsElapsed++;

    // ---- regime (debut): smoothed buildup/breakdown, drop edge detect
    const regime = frame.regime;
    this.buildS += ((regime?.buildup ?? 0) - this.buildS) * Math.min(1, dt / 0.35);
    this.breakS += ((regime?.breakdown ?? 0) - this.breakS) * Math.min(1, dt / 0.5);
    const dropRaw = regime?.dropTransition ?? 0;
    const dropEdge = dropRaw > 0.55 && this.dropPrev <= 0.55;
    this.dropPrev = dropRaw;

    // A buildup ARMS the drop cut — but only after ≥1 section of residency
    // (an hour of DJing has many drops; the phase must not thrash).
    if (this.buildS > 0.5 && this.sectionsElapsed >= 1) this.armed = true;
    else if (this.buildS < 0.12 && dropRaw < 0.2) this.armed = false;

    if (dropEdge) {
      if (frame.time - this.lastStingerAt > 8) {
        this.stingerT = 0;
        this.stingerSeed = hash32(this.genome, this.slot, tierBar);
        this.lastStingerAt = frame.time;
      }
      if (this.armed && frame.time - this.lastCutAt > 20) {
        this.startTransition(true, barSeconds, fadeBars, holdParam, width, height, frame.time);
      }
      this.armed = false;
    }

    // ---- scheduled transition: the clock cuts on a section downbeat
    if (sectionBoundary && !this.outgoing && this.sectionsElapsed >= this.holdSections) {
      this.startTransition(false, barSeconds, fadeBars, holdParam, width, height, frame.time);
    }

    // ---- doubles: tease the next phase while both decks carry one track
    let doubles = false;
    {
      const seen = new Map<number, number>();
      for (const d of frame.decks) {
        if (!d.playing || d.trackId === null || d.level < 0.25) continue;
        const n = (seen.get(d.trackId) ?? 0) + 1;
        seen.set(d.trackId, n);
        if (n >= 2) doubles = true;
      }
    }
    const teaseTarget = doubles && !this.outgoing ? 0.32 : 0;
    this.teaseAlpha += (teaseTarget - this.teaseAlpha) * Math.min(1, dt / 0.6);
    if (teaseTarget > 0 && !this.tease && !this.outgoing) {
      const pick = this.pickNext();
      if (pick) this.tease = this.makeLayer(pick.phaseIdx, width, height);
    }
    if (this.tease && !doubles && this.teaseAlpha < 0.02) {
      this.tease = null; // flourish over — drop the second renderer
    }

    // ---- ensure a current layer exists (first frame / post-crash)
    if (!this.current) {
      for (let step = 0; step <= PHASES.length && !this.current; step++) {
        const idx = this.phaseAtSlot(this.slot + step);
        if (this.dead.has(idx)) continue;
        this.current = this.makeLayer(idx, width, height);
        if (this.current) {
          this.slot += step;
          this.sectionsElapsed = 0;
          this.holdSections = this.rollHold(holdParam);
        }
      }
      if (!this.current) {
        // Every phase dead (should never happen): show black, stay alive.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        return;
      }
    }

    // ---- render the live layers into their own canvases (guarded)
    for (const layer of [this.current, this.outgoing, this.tease]) {
      if (!layer) continue;
      if (layer.canvas.width !== width || layer.canvas.height !== height) {
        layer.canvas.width = Math.max(1, width);
        layer.canvas.height = Math.max(1, height);
      }
    }
    if (this.current && !this.renderLayer(this.current, frame)) {
      // Current phase crashed: promote the outgoing layer if one is live,
      // otherwise hard-cut to the next alive phase — never go dark.
      this.current = null;
      if (this.outgoing) {
        this.current = this.outgoing;
        this.outgoing = null;
        this.morphT = 1;
      } else {
        const pick = this.pickNext();
        if (pick) {
          this.current = this.makeLayer(pick.phaseIdx, width, height);
          if (this.current) {
            this.slot = pick.slot;
            this.sectionsElapsed = 0;
            this.holdSections = this.rollHold(holdParam);
          }
        }
        this.morphT = 1;
      }
    }
    if (this.outgoing) {
      this.morphT += dt / this.fadeS;
      if (this.morphT >= 1) this.outgoing = null;
      else if (!this.renderLayer(this.outgoing, frame)) this.outgoing = null;
    }
    if (this.tease && !this.renderLayer(this.tease, frame)) this.tease = null;

    // ---- composite (the app's own morph model: additive cross-blend)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const blend = ease(this.morphT);
    if (this.outgoing && this.outgoing.canvas.width > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - blend;
      ctx.drawImage(this.outgoing.canvas, 0, 0);
    }
    if (this.current && this.current.canvas.width > 0) {
      ctx.globalCompositeOperation = this.outgoing ? 'lighter' : 'source-over';
      ctx.globalAlpha = this.outgoing ? blend : 1;
      ctx.drawImage(this.current.canvas, 0, 0);
    }
    if (this.tease && this.teaseAlpha > 0.02 && this.tease.canvas.width > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.teaseAlpha;
      ctx.drawImage(this.tease.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ---- breakdown grade: a slow dark vignette + gentle dim
    if (this.breakS > 0.03) {
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(cx, cy);
      ctx.fillStyle = `rgba(0,0,0,${(0.16 * this.breakS).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
      const vig = ctx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${(0.4 * this.breakS).toFixed(3)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }

    // ---- buildup riser overlay (works over ANY phase; photosafe)
    const rise = clamp(this.buildS * riserAmount, 0, 1.4);
    if (rise > 0.03) this.drawRiser(ctx, width, height, Math.min(1, rise), dt);

    // ---- drop stinger: one expanding shock ring per drop (≥8 s apart)
    if (this.stingerT < STINGER_S) {
      this.stingerT += dt;
      this.drawStinger(ctx, width, height);
    }
  }

  /** The buildup grammar: converging spokes, contracting rings, a rising
   * horizon glow and a tightening vignette — composited over any phase.
   * Continuous (no full-field flash); speeds ride the smoothed buildup. */
  private drawRiser(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    amount: number,
    dt: number
  ): void {
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy);
    this.riserTravel += dt * (0.1 + 0.55 * amount);
    this.riserSpin += dt * (0.02 + 0.12 * amount);

    // Tightening vignette — the frame closes in as the buildup rises.
    const vig = ctx.createRadialGradient(
      cx,
      cy,
      maxR * (0.9 - 0.38 * amount),
      cx,
      cy,
      maxR
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${(0.5 * amount).toFixed(3)})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // Converging spokes: short segments streaming inward, faster and
    // brighter as the buildup rises.
    const spokes = 28;
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * TAU + this.riserSpin;
      const prog = fract(this.riserTravel * 0.9 + i * 0.618034);
      const r0 = maxR * (1.05 - 0.92 * prog);
      const len = maxR * (0.05 + 0.07 * amount) * (0.35 + 0.65 * prog);
      const r1 = Math.max(0, r0 - len);
      const alpha = amount * 0.4 * prog * prog;
      if (alpha < 0.01) continue;
      ctx.strokeStyle = `rgba(165,225,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, maxR * 0.0022 * (0.5 + prog));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }

    // Contracting rings — the "tightening" read at a glance.
    for (let k = 0; k < 3; k++) {
      const prog = fract(this.riserTravel * 0.5 + k / 3);
      const rr = maxR * (1 - prog) * 0.92;
      const alpha = amount * 0.2 * prog;
      if (alpha < 0.01 || rr < 2) continue;
      ctx.strokeStyle = `rgba(200,235,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, maxR * 0.0035 * (1 - prog) + 1);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.stroke();
    }

    // Rising horizon: a glow line lifting from the floor toward center.
    const hy = height * (0.98 - 0.5 * amount);
    const band = height * 0.16;
    const glow = ctx.createLinearGradient(0, hy - band, 0, hy + band);
    glow.addColorStop(0, 'rgba(255,214,150,0)');
    glow.addColorStop(0.5, `rgba(255,214,150,${(0.3 * amount).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, hy - band, width, band * 2);

    ctx.restore();
  }

  /** One-shot drop stinger: an expanding shock ring + a seeded burst of
   * radial ticks. A single localized event per drop — not a strobe. */
  private drawStinger(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy);
    const t = clamp(this.stingerT / STINGER_S, 0, 1);
    const eOut = 1 - Math.pow(1 - t, 2.6);
    const radius = eOut * maxR * 1.05;
    const fade = 1 - t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,240,215,${(0.75 * fade).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, maxR * 0.045 * fade);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, radius), 0, TAU);
    ctx.stroke();
    // Burst ticks riding just behind the shock front.
    const ticks = 14;
    ctx.lineCap = 'round';
    for (let i = 0; i < ticks; i++) {
      const ang = rand01(this.stingerSeed, i, 0xbeef) * TAU;
      const jitter = 0.85 + 0.3 * rand01(this.stingerSeed, i, 0xfeed);
      const r0 = radius * 0.86 * jitter;
      const r1 = r0 + maxR * 0.08 * fade;
      const alpha = 0.5 * fade;
      if (alpha < 0.02 || r1 <= r0) continue;
      ctx.strokeStyle = `rgba(200,230,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, maxR * 0.004 * fade);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const preset: VisualizerPreset = {
  id: 'g17-monolith',
  name: 'g17 Monolith',
  params: [
    { id: 'hold', label: 'Phase hold ×', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'fade', label: 'Fade bars', min: 1, max: 8, step: 1, default: 4 },
    { id: 'riser', label: 'Riser amount', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create(): PresetRenderer {
    return new MonolithRenderer();
  },
};

export default preset;
