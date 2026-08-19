/**
 * "g07 mirror-metric" (genetic arena g07, mirror-ladder family): the metric
 * position made VISIBLE as accumulating architecture. Descended from
 * g02-mirror-ladder ("i like how this one tells a story") — same mirrored
 * geometry + metric awareness, but the phrase is now BUILT bar-by-bar so a
 * viewer can point and say "we're on bar 3 of the phrase".
 *
 * The tier grammar (HARD CUTS on metric boundaries, continuous motion
 * between — quantization is the aesthetic):
 *
 *   per beat    → the element currently under construction PULSES with beat
 *                 phase (a visible metronome tick); the kick SLAMS the
 *                 current element into place (solid downward impact).
 *   per bar     → one mirrored structural element is ADDED to a growing
 *   (HARD CUT)    symmetric edifice at the center stage:
 *                   bar 0 → foundation pair (two base slabs)
 *                   bar 1 → pillars (two vertical columns)
 *                   bar 2 → span (a horizontal beam bridging the pillars)
 *                   bar 3 → crown (a mirrored capstone / pediment)
 *                 The edifice is ALWAYS mirror-symmetric about the vertical
 *                 stage axis. You read the bar by counting the parts.
 *   per phrase  → the finished 4-bar structure IGNITES (one beat of glory:
 *   (4 bars,      a white bloom), then HARD-CUTS to an empty stage and the
 *    HARD CUT)    next structure begins. The completed structure RECEDES
 *                 into the background skyline (scaled down, pushed to a slot)
 *                 so the section's four phrases accumulate as a growing city.
 *   per section → the whole skyline INVERTS (vertical mirror flip), the
 *   (16 bars,     palette regime changes (genome-seeded bank), and the
 *    HARD CUT)    accumulated background clears — the biggest event short of
 *                 a drop. A white shockwave sweeps the stage.
 *
 * Live layer (taste calibration): kick = the current element SLAMS in
 * (solid, gated on impulse.low, never a flash); snare = a mirrored glint
 * cascade races along the completed structure's edges (mid/high). Drop =
 * ALL completed structures (foreground + background skyline) ignite together
 * and construction speed doubles; rides max(drop, energy) so it holds across
 * the plateau. Buildup = construction becomes URGENT — the under-construction
 * element jitters faster and the light warms (tense but alive, not dimmed).
 *
 * Variation per phrase is seeded by (dominant trackId genome) ^ (phrase
 * index) so each of a section's four structures is a distinct silhouette of
 * the same architectural language. No trackId => a frozen pseudo-seed.
 *
 * Tiers derive from beat.ladderBarIndex ?? beat.barIndex for bar/phrase/
 * section; beat phase drives the per-beat tick. Gridless material falls back
 * to a bass-pulse pseudo-meter so the stage never goes dead. Canvas 2D — bold
 * shapes, strict contrast hierarchy, dark stage + saturated light.
 *
 * Assigned tech: ladder tiers + beat phase (primary — this preset IS the
 * metric ladder made visible), impulses, trackId genome, trend.
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
const SHOCK_LIFE_S = 1.3;
const IGNITE_LIFE_S = 0.55;

/** Positive modulo — barIndex can be negative before the first downbeat. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** splitmix32-style avalanche → stable [0,1). Same key ⇒ same structure. */
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

/** Dominant audible deck's trackId (highest level); null when unknown. */
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

/** Per-phrase silhouette parameters, hashed from genome ^ phraseIndex.
 * These stay DISCRETE and BOLD so each structure reads as its own shape. */
interface Silhouette {
  /** base slab width fraction of the stage. */
  baseW: number;
  /** pillar separation (0.35..0.7 of stage half-width). */
  pillarSep: number;
  /** pillar slenderness. */
  pillarW: number;
  /** crown style: 0 = flat pediment, 1 = stepped, 2 = spire. */
  crown: number;
  /** hue for this phrase's structure (bright, saturated). */
  hue: number;
  /** whether the span arches (1) or is a flat lintel (0). */
  arch: number;
}

function silhouetteFor(seedKey: number, phraseIndex: number, paletteBase: number): Silhouette {
  const r = splitmix(seedKey ^ (phraseIndex * 0x2545f491));
  return {
    baseW: 0.32 + 0.16 * r(),
    pillarSep: 0.34 + 0.32 * r(),
    pillarW: 0.06 + 0.06 * r(),
    crown: Math.floor(r() * 3),
    hue: mod(paletteBase + phraseIndex * 47 + r() * 40, 360),
    arch: r() > 0.5 ? 1 : 0,
  };
}

/** A completed structure parked in the background skyline. */
interface SkylineEntry {
  sil: Silhouette;
  /** normalized x slot center (0..1) across the stage. */
  slotX: number;
}

class MirrorMetricRenderer implements PresetRenderer {
  private prevBar: number | null = null;
  /** genome seed (dominant trackId or pseudo-seed). */
  private seedKey = 1;
  private lastTrackId: number | null = null;
  private paletteBase = 200;
  /** palette regime rotates on section boundary. */
  private paletteRegime = 0;

  /** Which bar-in-phrase we are constructing (0..3), and phrase index. */
  private barInPhrase = 0;
  private phraseIndex = 0;
  private sil: Silhouette;
  /** Completed structures this section (recede into background). */
  private skyline: SkylineEntry[] = [];
  /** vertical inversion sign for the whole skyline (section flip). */
  private inversion = 1;

  /** Ignition bloom age when a phrase completes; <0 dead. */
  private igniteAge = -1;
  /** Section shockwave age; <0 dead. */
  private shockAge = -1;

  /** Gridless pseudo-meter. */
  private pseudoBeat = 0;
  private prevPseudoBeatCell = -1;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  constructor() {
    this.sil = silhouetteFor(1, 0, 200);
  }

  private reseed(key: number): void {
    this.seedKey = key;
    const r = splitmix(key);
    this.paletteRegime = Math.floor(r() * 4);
    this.paletteBase = mod(30 + r() * 300, 360);
    this.sil = silhouetteFor(key, this.phraseIndex, this.paletteBase);
  }

  private paletteHue(base: number): number {
    // Section regime shifts the whole bank; four bright saturated regimes.
    return mod(base + this.paletteRegime * 90 + this.paletteBase, 360);
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

    // --- Identity: dominant trackId seeds the genome. -----------------------
    const trackId = dominantTrackId(frame);
    const key =
      trackId != null
        ? trackId
        : Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
    if (this.lastTrackId === null && trackId === null) {
      // Prime once with pseudo-seed.
      if (this.prevBar === null) this.reseed(key);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)). -----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);

    // --- Metric tier resolution --------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    const beatPhase = beat ? beat.phase : this.pseudoBeat;

    if (hasGrid) {
      const barIndex = tierBar as number;
      if (this.prevBar !== null && barIndex !== this.prevBar) {
        this.onBarRollover(barIndex);
      }
      this.prevBar = barIndex;
      this.barInPhrase = mod(barIndex, PHRASE_BARS);
    } else {
      // Gridless pseudo-meter: a bass-pulse fakes the downbeat so the stage
      // keeps constructing. Beats advance with energy; a bar every 4 beats.
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const cell = Math.floor(this.pseudoBeat);
      if (cell !== this.prevPseudoBeatCell) {
        this.prevPseudoBeatCell = cell;
        if (mod(cell, PHRASE_BARS) === 0) {
          // pseudo-phrase completion
          this.completePhrase();
        }
        this.barInPhrase = mod(cell, PHRASE_BARS);
      }
    }

    // Decay transient events.
    if (this.igniteAge >= 0) {
      this.igniteAge += dt;
      if (this.igniteAge > IGNITE_LIFE_S) this.igniteAge = -1;
    }
    if (this.shockAge >= 0) {
      this.shockAge += dt;
      if (this.shockAge > SHOCK_LIFE_S) this.shockAge = -1;
    }

    // --- Stage geometry -----------------------------------------------------
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const intensity = frame.params.intensity ?? 1;
    const speed = frame.params.speed ?? 1;

    // Construction speed doubles on the drop (continuous motion between cuts).
    const motion = frame.time * speed * (1 + 1.0 * drive);

    // --- Dark stage floor, lifted by ignite/shock flashes (rate-limited) ---
    const ignite = this.igniteAge >= 0 ? 1 - this.igniteAge / IGNITE_LIFE_S : 0;
    const shock = this.shockAge >= 0 ? 1 - this.shockAge / SHOCK_LIFE_S : 0;
    const stageHue = this.paletteHue(0);
    const floorL = 2 + 4 * energy + 8 * ignite + 6 * shock;
    ctx.fillStyle = `hsl(${stageHue}, 70%, ${Math.min(20, floorL)}%)`;
    ctx.fillRect(0, 0, width, height);

    // A faint horizon line grounds the architecture (contrast anchor).
    ctx.fillStyle = `hsla(${this.paletteHue(20)}, 100%, 30%, 0.25)`;
    const horizonY = cy + unit * 0.36 * (this.inversion < 0 ? -1 : 1);
    ctx.fillRect(0, horizonY - 1, width, 2);

    ctx.globalCompositeOperation = 'lighter';

    // --- Background skyline: accumulated completed structures --------------
    for (const entry of this.skyline) {
      const sx = width * entry.slotX;
      this.drawStructure(ctx, sx, cy, unit, entry.sil, {
        stages: PHRASE_BARS, // fully built
        buildPulse: 0,
        recede: 0.42,
        alpha: 0.5 + 0.5 * drop, // ignite together on the drop
        inversion: this.inversion,
        motion,
        drive,
        glint: 0,
        scale,
        intensity: intensity * (0.6 + 0.5 * drop),
        ignite: ignite * 0.7,
      });
    }

    // --- Foreground: the structure under construction ----------------------
    // How many elements are placed: barInPhrase completed + the current one
    // pulsing in with beat phase.
    const placed = this.barInPhrase; // 0..3 fully placed
    const buildPulse = hasGrid || this.prevPseudoBeatCell >= 0 ? beatPhase : 0;
    // Kick slams the current element: a solid downward impact offset.
    const slam = frame.impulse.low > 0.08 ? frame.impulse.low : 0;
    // Snare glint cascade along completed structure.
    const glint = frame.impulse.mid * 0.7 + frame.impulse.high * 0.3;

    this.drawStructure(ctx, cx, cy, unit, this.sil, {
      stages: placed + 1, // current element is being placed
      buildPulse,
      recede: 0,
      alpha: 1,
      inversion: this.inversion,
      motion,
      drive,
      glint,
      scale,
      intensity: intensity * (1 + 0.6 * drive),
      ignite,
      slam,
      buildup,
      currentStage: placed, // which element is under construction
    });

    // --- Metric HUD: four beacon lamps showing bar-in-phrase --------------
    // Bold, unambiguous — the "we're on bar 3" tell, mirror-arranged.
    this.drawMeter(ctx, cx, cy, unit, beatPhase, drive);

    // --- Phrase ignition bloom: white glory pop ----------------------------
    if (ignite > 0) {
      const r = unit * (0.1 + (1 - ignite) * 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${ignite * 0.7})`;
      ctx.lineWidth = Math.max(2, unit * 0.02 * ignite);
      ctx.stroke();
      ctx.fillStyle = `hsla(${this.sil.hue}, 100%, 75%, ${ignite * 0.25})`;
      ctx.fillRect(0, 0, width, height);
    }

    // --- Section shockwave: a white ring sweeping the stage ----------------
    if (shock > 0) {
      const r = unit * (0.05 + this.shockAge * 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${shock * 0.85})`;
      ctx.lineWidth = Math.max(2, unit * 0.022 * shock);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Bar rollover: escalate by tier. Bar cut adds an element; phrase cut
   * ignites + resets to empty stage; section cut inverts + clears + repalettes. */
  private onBarRollover(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;

    if (isSection) {
      // Biggest event short of a drop: invert the world, clear the skyline,
      // rotate the palette regime, fire the shockwave.
      this.inversion *= -1;
      this.paletteRegime = (this.paletteRegime + 1) % 4;
      this.skyline = [];
      this.shockAge = 0;
      this.phraseIndex = 0;
      this.sil = silhouetteFor(this.seedKey, this.phraseIndex, this.paletteBase);
    } else if (isPhrase) {
      // Phrase completed on the bar BEFORE this downbeat: ignite + park it.
      this.completePhrase();
    }
    // (non-phrase bars: the element is simply added by barInPhrase advancing)
  }

  /** Finish the current 4-bar structure: ignite, park into the skyline in a
   * mirror-balanced slot, seed the next phrase's silhouette. */
  private completePhrase(): void {
    this.igniteAge = 0;
    // Park the just-finished structure into a background slot. Slots fill
    // symmetrically outward from center so the skyline stays balanced.
    const slotOrder = [0.5, 0.22, 0.78, 0.08, 0.92];
    const slotX = slotOrder[Math.min(this.skyline.length, slotOrder.length - 1)];
    this.skyline.push({ sil: this.sil, slotX });
    if (this.skyline.length > 4) this.skyline.shift();
    // Next structure: new silhouette seeded by genome ^ phraseIndex.
    this.phraseIndex = (this.phraseIndex + 1) % (SECTION_BARS / PHRASE_BARS);
    this.sil = silhouetteFor(this.seedKey, this.phraseIndex, this.paletteBase);
  }

  /** Draw a mirror-symmetric edifice: foundation → pillars → span → crown.
   * Everything is reflected about the vertical stage axis at (px). */
  private drawStructure(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    unit: number,
    sil: Silhouette,
    o: {
      stages: number;
      buildPulse: number;
      recede: number;
      alpha: number;
      inversion: number;
      motion: number;
      drive: number;
      glint: number;
      scale: number;
      intensity: number;
      ignite: number;
      slam?: number;
      buildup?: number;
      currentStage?: number;
    }
  ): void {
    const s = (1 - o.recede) * o.scale;
    const H = unit * 0.34 * s;
    const halfW = unit * 0.26 * s;
    const inv = o.inversion;
    const up = -inv; // "up" flips with the section inversion

    const hue = sil.hue;
    const alpha = o.alpha;
    const lit = (l: number, a = 1) =>
      `hsla(${hue}, 100%, ${Math.min(92, l)}%, ${clamp01(a * alpha)})`;
    const white = (a: number) => `rgba(255,255,255,${clamp01(a * alpha)})`;

    // Base y of the structure (the ground it grows from).
    const groundY = py + up * (-H * 0.5);
    const slam = o.slam ?? 0;
    const buildup = o.buildup ?? 0;

    // A helper that draws a rectangle mirrored across the vertical axis.
    const mirrorRect = (
      dx: number,
      y: number,
      w: number,
      h: number,
      style: string
    ) => {
      ctx.fillStyle = style;
      ctx.fillRect(px + dx, y, w, h);
      ctx.fillRect(px - dx - w, y, w, h);
    };
    const centerRect = (y: number, w: number, h: number, style: string) => {
      ctx.fillStyle = style;
      ctx.fillRect(px - w / 2, y, w, h);
    };

    // --- Element under construction gets the beat-phase pulse + kick slam --
    const cur = o.currentStage ?? -1;
    const pulse = (stage: number): number => {
      if (stage !== cur) return 1;
      // Rise with beat phase (the metronome tick); jitter faster on buildup.
      const t = smoothstep(o.buildPulse);
      const jitter = 1 + buildup * 0.06 * Math.sin(o.motion * (20 + 30 * buildup));
      return (0.35 + 0.65 * t) * jitter;
    };
    const slamOffset = (stage: number): number =>
      stage === cur ? up * -slam * unit * 0.05 * (1 - smoothstep(o.buildPulse)) : 0;

    // ---- Stage 0: FOUNDATION PAIR (two base slabs) -----------------------
    if (o.stages >= 1) {
      const p = pulse(0);
      const so = slamOffset(0);
      const bw = halfW * sil.baseW;
      const bh = H * 0.14 * p;
      const y = up > 0 ? groundY : groundY - bh;
      const gap = halfW * 0.18;
      mirrorRect(gap, y + so, bw, bh, lit(46 + 26 * o.drive));
      // hot top edge
      mirrorRect(gap, y + so + (up > 0 ? 0 : bh - 2), bw, 2, white(0.5));
    }

    // ---- Stage 1: PILLARS (two vertical columns) -------------------------
    const pillarBaseY = up > 0 ? groundY : groundY - H * 0.14;
    const pillarH = H * 0.55;
    const pillarX = halfW * sil.pillarSep;
    const pillarW = halfW * sil.pillarW * 2;
    if (o.stages >= 2) {
      const p = pulse(1);
      const so = slamOffset(1);
      const h = pillarH * (cur === 1 ? p : 1);
      const y = up > 0 ? pillarBaseY - up * h : pillarBaseY - up * 0 - (up < 0 ? h : 0);
      // Simpler: compute column top based on direction.
      const colTop = up > 0 ? pillarBaseY - h : pillarBaseY + H * 0.14;
      mirrorRect(pillarX, colTop + so, pillarW, h, lit(52 + 24 * o.drive, 0.95));
      // vertical hot inner edge (structural highlight)
      mirrorRect(pillarX, colTop + so, 2, h, white(0.35 + 0.5 * o.glint));
      void y;
    }

    // ---- Stage 2: SPAN (beam bridging the pillars) -----------------------
    const spanTopY = up > 0 ? pillarBaseY - pillarH : pillarBaseY + H * 0.14 + pillarH;
    if (o.stages >= 3) {
      const p = pulse(2);
      const so = slamOffset(2);
      const beamH = H * 0.1;
      const beamW = (pillarX + pillarW) * 2;
      const y = up > 0 ? spanTopY - beamH : spanTopY;
      if (sil.arch === 1) {
        // Arched span: a mirrored triangle-ish keystone.
        ctx.fillStyle = lit(58 + 20 * o.drive, p);
        ctx.beginPath();
        ctx.moveTo(px - beamW / 2, y + beamH + so);
        ctx.lineTo(px, y - beamH * 0.8 * p + so);
        ctx.lineTo(px + beamW / 2, y + beamH + so);
        ctx.closePath();
        ctx.fill();
      } else {
        centerRect(y + so, beamW, beamH * p, lit(58 + 20 * o.drive, p));
      }
      centerRect((up > 0 ? y : y + beamH - 2) + so, beamW, 2, white(0.5));
    }

    // ---- Stage 3: CROWN (mirrored capstone / pediment) -------------------
    if (o.stages >= 4) {
      const p = pulse(3);
      const so = slamOffset(3);
      const crownBase = up > 0 ? spanTopY - H * 0.1 : spanTopY + H * 0.1;
      const cw = pillarX * 1.4;
      const chMax = H * 0.22 * p;
      ctx.fillStyle = lit(66 + 20 * o.drive, p);
      if (sil.crown === 2) {
        // Spire: a tall mirrored triangle.
        ctx.beginPath();
        ctx.moveTo(px - cw, crownBase + so);
        ctx.lineTo(px, crownBase - up * chMax + so);
        ctx.lineTo(px + cw, crownBase + so);
        ctx.closePath();
        ctx.fill();
      } else if (sil.crown === 1) {
        // Stepped ziggurat.
        for (let i = 0; i < 3; i++) {
          const w = cw * (1 - i * 0.28);
          const h = chMax / 3;
          const yy = crownBase - up * (i + 1) * h + (up > 0 ? 0 : -h) + so;
          centerRect(yy, w * 2, h, lit(64 + i * 8 + 20 * o.drive, p));
        }
      } else {
        // Flat pediment triangle.
        ctx.beginPath();
        ctx.moveTo(px - cw, crownBase + so);
        ctx.lineTo(px, crownBase - up * chMax * 0.7 + so);
        ctx.lineTo(px + cw, crownBase + so);
        ctx.closePath();
        ctx.fill();
      }
      // Crown apex spark.
      const apexY = crownBase - up * chMax + so;
      ctx.fillStyle = white(0.6 + 0.4 * o.drive);
      ctx.fillRect(px - 3, apexY - 3, 6, 6);
    }

    // ---- Snare glint cascade: bright ticks racing up the pillar edges ----
    if (o.glint > 0.04 && o.stages >= 2) {
      const ticks = 6;
      for (let i = 0; i < ticks; i++) {
        const f = (i / ticks + (o.motion * 0.6) % 1) % 1;
        const y = up > 0 ? pillarBaseY - up * pillarH * f : pillarBaseY + H * 0.14 + pillarH * f;
        const a = o.glint * (1 - f) * 0.9;
        mirrorRect(pillarX, y, pillarW, Math.max(1, unit * 0.006), white(a));
      }
    }

    void slam;
  }

  /** Bold four-lamp bar-in-phrase meter, mirror-arranged below the stage.
   * This is the point-at-the-screen legibility tell. */
  private drawMeter(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    beatPhase: number,
    drive: number
  ): void {
    const r = unit * 0.02;
    const spacing = unit * 0.07;
    const y = cy + unit * 0.44;
    const hue = this.paletteHue(0);
    for (let i = 0; i < PHRASE_BARS; i++) {
      const x = cx + (i - (PHRASE_BARS - 1) / 2) * spacing;
      const done = i < this.barInPhrase;
      const active = i === this.barInPhrase;
      let l = 12;
      let a = 0.5;
      if (done) {
        l = 60 + 20 * drive;
        a = 0.9;
      } else if (active) {
        // pulse with beat phase
        l = 45 + 45 * smoothstep(beatPhase);
        a = 0.95;
      }
      ctx.fillStyle = `hsla(${hue}, 100%, ${l}%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r * (active ? 1.25 : 1), 0, Math.PI * 2);
      ctx.fill();
      if (done || active) {
        ctx.strokeStyle = `rgba(255,255,255,${done ? 0.5 : 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'edifice scale', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'intensity', label: 'light intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'motion speed', min: 0.3, max: 2, step: 0.05, default: 1 },
];

const g07MirrorMetricPreset: VisualizerPreset = {
  id: 'g07-mirror-metric',
  name: 'g07 mirror-metric',
  params,
  create: () => new MirrorMetricRenderer(),
};

export default g07MirrorMetricPreset;
