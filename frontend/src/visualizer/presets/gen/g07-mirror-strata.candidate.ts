/**
 * "g07 mirror-strata" (genetic arena g07, mirror-ladder family, NOVEL): the
 * ENTIRE metric hierarchy staged at once. Style-descended from
 * g02-mirror-ladder (mirrored geometry + metric theatre) but a fresh
 * grammar: four spatially NESTED strata — kernel inside frame inside scene
 * inside world — each owned by one metric tier, each changing with a HARD CUT
 * exactly on its own boundary and holding steady between (quantization is the
 * aesthetic). Motion never stops; cuts change STATE, not motion.
 *
 * The tier grammar (each stratum changes ONLY on its boundary):
 *
 *   BEAT   (innermost, fastest) — the KERNEL: a small mirrored glyph that
 *          re-poses every beat. Pose index = beat count mod a small cycle;
 *          between beats it spins continuously. The kick STRIKES the kernel
 *          against the frame (a solid impact that transfers light outward one
 *          stratum at a time).
 *   BAR    — the FRAME: a mid-scale mirrored border that re-shapes every bar
 *          (edge count / corner treatment snap from the bar index). Derived
 *          from beat.ladderBarIndex ?? beat.barIndex.
 *   PHRASE (4 bars) — the SCENE: the dominant geometry. Mirror symmetry count
 *          (2/4/6/8-fold), palette bank, and layout snap on the phrase
 *          boundary. This is what carries the "we're in a new phrase" read.
 *   SECTION (16 bars, outermost, slowest) — the WORLD container: background
 *          regime, the master mirror-axis orientation, and overall color
 *          temperature cut on the section boundary (the biggest visual event
 *          short of a drop). A shockwave marks it.
 *
 * Because each tier owns exactly one nested spatial band, the eye learns
 * which scale moves when — the hierarchy stays LEGIBLE rather than chaotic.
 *
 * Live layer (taste calibration): kick = kernel strike, light transfers
 * outward through the strata (solid, gated on impulse.low, never a flash);
 * snare = a glint ripple races across the SCENE stratum's mirror seams
 * (mid/high). Drop = ALL strata cut SIMULTANEOUSLY to their next state +
 * sustained cross-strata light flow — the hierarchy briefly moves as one;
 * rides max(drop, energy) so it holds across the plateau. Buildup = the inner
 * strata accelerate their internal spin/pulse while cuts stay on-grid
 * (tension between urgency and quantization; tense but alive, not dimmed).
 *
 * Genome: the dominant audible deck's trackId hashes into the stratum
 * vocabularies (which poses, frame styles, symmetry banks, palette temps a
 * song draws from) — same song, same look, every play. No trackId => frozen
 * pseudo-seed.
 *
 * Anti-resemblance (brief): mirror symmetry YES, radial mandala repetition
 * NO; no dust. Dark stage, strata carry saturated light, strict contrast
 * hierarchy (outer strata dimmer, inner strata hottest). Canvas 2D.
 *
 * Assigned tech: full ladder hierarchy + beat phase (primary), impulses,
 * trackId genome (stratum vocabularies), trend.
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
const BEAT_POSE_CYCLE = 6;
const SHOCK_LIFE_S = 1.3;

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

/** splitmix32-style avalanche → stable [0,1). Same key ⇒ same vocabularies. */
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

/** Genome vocabularies drawn from the trackId hash: which discrete states
 * each stratum can snap to for this song. Kept coarse & bold for legibility. */
interface Genome {
  /** phrase symmetry bank: e.g. [2,4,6,8] permuted → which fold each phrase. */
  symBank: number[];
  /** base hue and per-tier hue spreads. */
  baseHue: number;
  /** world temperature bank (per section). */
  tempBank: number[];
  /** frame corner style bank (per bar). */
  frameBank: number[];
  /** kernel glyph family: 0 diamond, 1 cross, 2 bowtie, 3 chevrons. */
  kernelFamily: number;
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const folds = [2, 4, 6, 8];
  // permute the fold bank deterministically
  for (let i = folds.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = folds[i];
    folds[i] = folds[j];
    folds[j] = t;
  }
  return {
    symBank: folds,
    baseHue: mod(r() * 360, 360),
    tempBank: [-40 + r() * 30, r() * 60, 120 + r() * 60, 220 + r() * 60],
    frameBank: [0, 1, 2, 3].map(() => Math.floor(r() * 4)),
    kernelFamily: Math.floor(r() * 4),
  };
}

/** Held state per stratum — only rewritten on that stratum's boundary. */
interface StrataState {
  beatPose: number;
  barFrameStyle: number;
  phraseFold: number;
  phraseHueShift: number;
  sectionTemp: number;
  sectionAxis: number; // master mirror-axis orientation (radians)
  sectionBgHue: number;
}

class MirrorStrataRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private genome: Genome = makeGenome(1);

  private state: StrataState = {
    beatPose: 0,
    barFrameStyle: 0,
    phraseFold: 4,
    phraseHueShift: 0,
    sectionTemp: 0,
    sectionAxis: 0,
    sectionBgHue: 200,
  };

  private prevBeatCell: number | null = null;
  private prevBar: number | null = null;

  /** kick strike animation: age of the outward light transfer; <0 dead. */
  private strikeAge = -1;
  /** section shockwave age; <0 dead. */
  private shockAge = -1;

  /** continuous internal clocks (motion between cuts). */
  private kernelSpin = 0;
  private frameSpin = 0;

  /** gridless pseudo-meter beat clock. */
  private pseudoBeat = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    // Prime held states from the genome so a fresh song reads immediately.
    this.state.phraseFold = this.genome.symBank[0];
    this.state.sectionBgHue = this.genome.baseHue;
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
    const g = this.genome;

    // --- Identity / genome --------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (this.lastTrackId === null && trackId === null && this.prevBar === null && this.prevBeatCell === null) {
      const pseudo = Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
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
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);

    // --- Metric tiers -------------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    const beatPhase = beat ? beat.phase : mod(this.pseudoBeat, 1);

    // Detect a DROP edge to fire the simultaneous all-strata cut.
    const dropEdge = drop > 0.5 && this.smoothDropPrev <= 0.5;
    this.smoothDropPrev = drop;

    if (hasGrid) {
      const barIndex = tierBar as number;
      // absolute beat cell: bar*4 + floor(beatPhase*4)? We only have barPhase
      // reliably; use bar + quarter within bar from beat.phase as the beat.
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * PHRASE_BARS);
      const beatCell = barIndex * PHRASE_BARS + beatWithinBar;

      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeatCut(beatCell);
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      // Gridless pseudo-meter: keep every stratum cutting on its own clock.
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeatCut(beatCell);
        if (mod(beatCell, PHRASE_BARS) === 0) this.onBarCut(Math.floor(beatCell / PHRASE_BARS));
        this.prevBeatCell = beatCell;
      }
    }

    // Drop = all strata cut at once (advance every held state one step).
    if (dropEdge) this.dropCut();

    // Decay transients.
    if (this.strikeAge >= 0) {
      this.strikeAge += dt;
      if (this.strikeAge > 0.5) this.strikeAge = -1;
    }
    if (this.shockAge >= 0) {
      this.shockAge += dt;
      if (this.shockAge > SHOCK_LIFE_S) this.shockAge = -1;
    }

    // --- Continuous motion between cuts (never stops) ----------------------
    this.kernelSpin += dt * (1.4 + 3.0 * buildup + 2.0 * drive);
    this.frameSpin += dt * (0.4 + 1.2 * buildup + 0.8 * drive);

    // --- Stage --------------------------------------------------------------
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const contrast = frame.params.contrast ?? 1;
    const st = this.state;

    const strike = this.strikeAge >= 0 ? 1 - this.strikeAge / 0.5 : 0;
    const shock = this.shockAge >= 0 ? 1 - this.shockAge / SHOCK_LIFE_S : 0;

    // WORLD stratum (section): dark background regime, temperature, master axis.
    const worldHue = mod(st.sectionBgHue + st.sectionTemp, 360);
    const bgL = 2 + 4 * energy + 5 * shock;
    ctx.fillStyle = `hsl(${worldHue}, 65%, ${Math.min(16, bgL)}%)`;
    ctx.fillRect(0, 0, width, height);

    // Everything hereafter is drawn in the master mirror-axis frame.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(st.sectionAxis);
    ctx.globalCompositeOperation = 'lighter';

    const baseHue = mod(g.baseHue + st.phraseHueShift + st.sectionTemp, 360);

    // ---- SCENE stratum (phrase): dominant mirrored geometry, N-fold. -----
    // Radial *mirror* symmetry (reflected wedges), NOT rotational repetition
    // of a motif — anti-mandala per the brief. We draw ONE bold wedge shape
    // and reflect it across `fold` mirror axes.
    const fold = st.phraseFold;
    const sceneR = unit * 0.42 * scale;
    const sceneAlpha = 0.45 + 0.25 * drive;
    for (let a = 0; a < fold; a++) {
      const axis = (a / fold) * Math.PI * 2 + this.frameSpin * 0.15;
      ctx.save();
      ctx.rotate(axis);
      // A bold spoke: a tapered bar from center outward, reflected by drawing
      // the mirror-partner across this axis (scale x -1 within the wedge).
      const spokeHue = mod(baseHue + a * (18 / Math.max(1, fold / 4)), 360);
      const grad = ctx.createLinearGradient(0, 0, sceneR, 0);
      grad.addColorStop(0, `hsla(${spokeHue}, 100%, ${28 + 20 * drive}%, ${sceneAlpha})`);
      grad.addColorStop(1, `hsla(${spokeHue}, 100%, ${8 + 16 * drive}%, 0)`);
      ctx.fillStyle = grad;
      const w = unit * (0.02 + 0.02 * frame.bands.mid) * scale;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(sceneR, -w * 0.3);
      ctx.lineTo(sceneR, w * 0.3);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Snare glint ripple along the scene's mirror seams.
    const glint = frame.impulse.mid * 0.7 + frame.impulse.high * 0.3;
    if (glint > 0.04) {
      for (let a = 0; a < fold; a++) {
        const axis = (a / fold) * Math.PI * 2 + this.frameSpin * 0.15;
        const f = (this.kernelSpin * 0.5) % 1;
        const rr = sceneR * f;
        ctx.save();
        ctx.rotate(axis);
        ctx.fillStyle = `rgba(255,255,255,${glint * (1 - f) * 0.9})`;
        ctx.beginPath();
        ctx.arc(rr, 0, Math.max(1.5, unit * 0.006), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ---- FRAME stratum (bar): a mid-scale mirrored border ----------------
    const frameR = unit * 0.26 * scale;
    const frameStyle = st.barFrameStyle;
    const frameHue = mod(baseHue + 40, 360);
    ctx.strokeStyle = `hsla(${frameHue}, 100%, ${45 + 25 * drive}%, ${(0.7 + 0.3 * drive) * contrast})`;
    ctx.lineWidth = Math.max(2, unit * 0.008 * (1 + 0.5 * frame.bands.mid));
    ctx.save();
    ctx.rotate(this.frameSpin * 0.3);
    // frameStyle picks the polygon edge count (mirror-symmetric shapes):
    // 0 square, 1 hexagon, 2 diamond, 3 octagon.
    const edges = [4, 6, 4, 8][frameStyle];
    const rot0 = frameStyle === 2 ? Math.PI / 4 : 0;
    ctx.beginPath();
    for (let i = 0; i <= edges; i++) {
      const th = rot0 + (i / edges) * Math.PI * 2;
      const px = Math.cos(th) * frameR;
      const py = Math.sin(th) * frameR;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Frame corner glints brighten when the kernel STRIKES (light transfer).
    if (strike > 0.02) {
      for (let i = 0; i < edges; i++) {
        const th = rot0 + (i / edges) * Math.PI * 2;
        ctx.fillStyle = `rgba(255,255,255,${strike * 0.8})`;
        ctx.beginPath();
        ctx.arc(Math.cos(th) * frameR, Math.sin(th) * frameR, Math.max(2, unit * 0.01 * strike), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // ---- KERNEL stratum (beat): innermost mirrored glyph, re-posed/beat --
    const kernelR = unit * (0.09 + 0.03 * frame.bands.low) * scale;
    const beatPulse = 0.5 + 0.5 * smoothstep(1 - beatPhase); // hottest right at the beat
    const kernelHue = mod(baseHue + 80, 360);
    const kL = 55 + 35 * beatPulse + 20 * drive;
    ctx.save();
    ctx.rotate(this.kernelSpin * (0.6 + 0.8 * buildup));
    // pose selects the glyph orientation/shape variant.
    const pose = st.beatPose;
    this.drawKernel(ctx, kernelR, g.kernelFamily, pose, kernelHue, kL, beatPulse * (0.7 + 0.5 * drive));
    ctx.restore();

    // ---- Kick strike: solid impact that transfers light outward. ---------
    if (strike > 0.02) {
      // an expanding bright ring from kernel outward (light traveling through
      // strata) — localized, not a fullscreen flash.
      const rr = kernelR + (frameR - kernelR) * (1 - strike) + (sceneR - frameR) * clamp01((1 - strike) * 2 - 1);
      ctx.strokeStyle = `rgba(255,255,255,${strike * 0.7})`;
      ctx.lineWidth = Math.max(2, unit * 0.014 * strike);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore(); // master axis

    // ---- Drop cross-strata flow: a sustained bright pulse binding all -----
    if (drop > 0.15) {
      ctx.globalCompositeOperation = 'lighter';
      const flow = drop * (0.6 + 0.4 * Math.sin(frame.time * 6));
      ctx.fillStyle = `hsla(${mod(baseHue + 80, 360)}, 100%, 60%, ${0.05 * flow})`;
      ctx.fillRect(0, 0, width, height);
    }

    // ---- Section shockwave ------------------------------------------------
    if (shock > 0) {
      const rr = unit * (0.05 + this.shockAge * 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${shock * 0.85})`;
      ctx.lineWidth = Math.max(2, unit * 0.022 * shock);
      ctx.stroke();
    }

    // ---- Tier HUD: nested rings ticking their own clocks (legibility) ----
    this.drawTierHud(ctx, cx, cy, unit, beatPhase);

    ctx.globalCompositeOperation = 'source-over';
  }

  private smoothDropPrev = 0;

  /** Draw the innermost mirrored kernel glyph (bilateral symmetry, no
   * radial mandala). Family/pose from the genome + beat cycle. */
  private drawKernel(
    ctx: CanvasRenderingContext2D,
    r: number,
    family: number,
    pose: number,
    hue: number,
    lightness: number,
    glow: number
  ): void {
    ctx.fillStyle = `hsla(${hue}, 100%, ${Math.min(92, lightness)}%, ${0.85})`;
    ctx.strokeStyle = `rgba(255,255,255,${clamp01(0.4 + glow)})`;
    ctx.lineWidth = 2;
    const poseRot = (pose / BEAT_POSE_CYCLE) * (Math.PI / 2);
    ctx.save();
    ctx.rotate(poseRot);
    if (family === 0) {
      // diamond
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (family === 1) {
      // cross (mirror-symmetric both axes)
      const t = r * 0.32;
      ctx.fillRect(-t, -r, t * 2, r * 2);
      ctx.fillRect(-r, -t, r * 2, t * 2);
    } else if (family === 2) {
      // bowtie (two mirrored triangles)
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.6);
      ctx.lineTo(0, 0);
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r, -r * 0.6);
      ctx.lineTo(0, 0);
      ctx.lineTo(r, r * 0.6);
      ctx.closePath();
      ctx.fill();
    } else {
      // chevrons (mirrored)
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.moveTo(s * r, -r * 0.5);
        ctx.lineTo(0, 0);
        ctx.lineTo(s * r, r * 0.5);
        ctx.lineTo(s * r * 0.6, r * 0.5);
        ctx.lineTo(0, r * 0.25);
        ctx.lineTo(s * r * 0.6, -r * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    // hot center
    ctx.fillStyle = `rgba(255,255,255,${clamp01(0.5 + glow)})`;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, r * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Nested-ring tier HUD: four concentric arcs, each sweeping on its own
   * tier's clock, so a viewer sees which scale moves when. */
  private drawTierHud(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    beatPhase: number
  ): void {
    const rings: Array<{ r: number; phase: number; hue: number }> = [
      { r: unit * 0.03, phase: beatPhase, hue: mod(this.genome.baseHue + 80, 360) },
      { r: unit * 0.045, phase: mod(this.prevBar ?? 0, PHRASE_BARS) / PHRASE_BARS, hue: mod(this.genome.baseHue + 40, 360) },
      { r: unit * 0.06, phase: mod(Math.floor((this.prevBar ?? 0) / PHRASE_BARS), 4) / 4, hue: this.genome.baseHue },
      { r: unit * 0.075, phase: mod(Math.floor((this.prevBar ?? 0) / SECTION_BARS), 4) / 4, hue: mod(this.genome.baseHue + this.state.sectionTemp, 360) },
    ];
    const x = cx;
    const y = cy - unit * 0.44;
    for (const ring of rings) {
      ctx.strokeStyle = `hsla(${ring.hue}, 100%, 55%, 0.35)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, ring.r, -Math.PI / 2, -Math.PI / 2 + ring.phase * Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Boundary cuts: each rewrites ONLY its stratum's held state. --------

  private onBeatCut(beatCell: number): void {
    this.state.beatPose = mod(beatCell, BEAT_POSE_CYCLE);
    // kick strike is fired in dropCut/here only when the low impulse is real;
    // strike animation is armed each beat but only reads under kick energy —
    // we arm it on the beat cut so light transfers on the downbeat.
    this.strikeAge = 0;
  }

  private onBarCut(barIndex: number): void {
    this.state.barFrameStyle = this.genome.frameBank[mod(barIndex, this.genome.frameBank.length)];
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) this.cutPhrase(Math.floor(barIndex / PHRASE_BARS));
    if (isSection) this.cutSection(Math.floor(barIndex / SECTION_BARS));
  }

  private cutPhrase(phraseIndex: number): void {
    this.state.phraseFold = this.genome.symBank[mod(phraseIndex, this.genome.symBank.length)];
    this.state.phraseHueShift = mod(phraseIndex * 53, 360);
  }

  private cutSection(sectionIndex: number): void {
    this.state.sectionTemp = this.genome.tempBank[mod(sectionIndex, this.genome.tempBank.length)];
    this.state.sectionAxis = mod(sectionIndex, 2) === 0 ? 0 : Math.PI / 6;
    this.state.sectionBgHue = mod(this.genome.baseHue + sectionIndex * 60, 360);
    this.shockAge = 0;
  }

  /** Drop: all strata cut simultaneously to their NEXT state. */
  private dropCut(): void {
    this.state.beatPose = mod(this.state.beatPose + 1, BEAT_POSE_CYCLE);
    this.state.barFrameStyle = mod(this.state.barFrameStyle + 1, 4);
    const curFoldIdx = this.genome.symBank.indexOf(this.state.phraseFold);
    this.state.phraseFold = this.genome.symBank[mod(curFoldIdx + 1, this.genome.symBank.length)];
    this.state.sectionAxis += Math.PI / 6;
    this.strikeAge = 0;
    this.shockAge = 0;
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'strata scale', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'contrast', label: 'stratum contrast', min: 0.5, max: 2, step: 0.05, default: 1 },
];

const g07MirrorStrataPreset: VisualizerPreset = {
  id: 'g07-mirror-strata',
  name: 'g07 mirror-strata',
  params,
  create: () => new MirrorStrataRenderer(),
};

export default g07MirrorStrataPreset;
