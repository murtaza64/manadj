/**
 * "g08 strata-eq" (gen-8 TWEAK of g07-mirror-strata — 3 approvals, unbeaten).
 *
 * The parent's TIER GRAMMAR is kept WHOLESALE (copied): four spatially nested
 * strata — kernel (beat) inside frame (bar) inside scene (phrase) inside world
 * (section) — each owned by one metric tier, each snapping with a HARD CUT
 * exactly on its own boundary and holding between. Motion never stops; cuts
 * change STATE, not motion. Kick = kernel strike; drop = cross-strata light
 * flow riding max(drop, energy). Canvas 2D (parent's engine, no GL).
 *
 * ADDED (the whole point of this candidate — brief): BAND OWNERSHIP aligned
 * with the tiers, read off the DOMINANT audible deck's EQ knobs. Each band
 * owns ONE stratum's PROPERTY, so an EQ kill visibly STRIPS that stratum while
 * the others live — the mix becomes a legible layered organism:
 *
 *   LOWS own the BEAT KERNEL's SCALE/IMPACT. Kernel size + strike force scale
 *        with the bass EQ. Bass kill → the kernel shrinks to a bare SEED
 *        (a tiny dot); the strike stops transferring light outward.
 *   MIDS own the COLOR of the BAR FRAME + PHRASE SCENE. Hue saturation and
 *        the frame/scene chroma track the mid EQ. Mid kill → DUOTONE (the
 *        frame + scene desaturate to two greys; the world/kernel keep their
 *        identity so the strip is visible as ONE stratum losing color).
 *   HIGHS own the DETAIL of the PHRASE SCENE's SEAMS + the WORLD background
 *        STARS. Seam glints + background starfield scale with the high EQ.
 *        High kill → CLEAN MINIMAL (no seam sparkle, empty dark sky).
 *
 * EQ knobs are 0..1 with 0.5 = flat (channel.ts DeckStateInfo.eq). We map a
 * knob to a 0..1 "presence" (0.5→1 flat-and-up, →0 as it's cut) and smooth it
 * (~0.12 s approach) so a kill READS as a stratum fading out over a beat, not
 * a jump. No live deck → all bands present (0.5 flat baseline).
 *
 * Assigned tech (added to parent's ladder + impulses + trackId genome + trend):
 * deck EQ state (frame.decks dominant deck eq.low/mid/high) as the band-owner.
 * Hard cuts still land on grid via beat.ladderBarIndex ?? beat.barIndex + beat
 * phase; the EQ presences are the ONLY continuous per-band signal.
 *
 * Anti-resemblance / taste (kept): mirror symmetry YES, radial mandala NO; no
 * dust; dark stage; saturated light; strict contrast hierarchy (outer dimmer,
 * inner hottest); bright fully-saturated colors.
 */

import type { DeckStateInfo } from '../../channel';
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

/** Dominant audible deck (highest master-audible level); null when unknown —
 * the band-ownership EQ knobs are read off THIS deck. */
function dominantDeck(decks: DeckStateInfo[]): DeckStateInfo | null {
  let best: DeckStateInfo | null = null;
  let bestLevel = -1;
  for (const deck of decks) {
    if (!deck.playing) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck;
    }
  }
  return best;
}

/** Map an EQ knob (0..1, 0.5 flat) to a 0..1 band PRESENCE: 0 at full kill,
 * ~1 at flat, boosting slightly above flat. A smoothstep so a knob near flat
 * still reads as full presence and only a real cut strips the stratum. */
function eqPresence(knob: number): number {
  // 0.0 knob → 0 presence; 0.5 (flat) → ~1; 1.0 (boost) → ~1.25 (capped later).
  return smoothstep(clamp01(knob / 0.5)) * (0.75 + 0.5 * clamp01(knob));
}

function approach(cur: number, target: number, tau: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Genome vocabularies drawn from the trackId hash (parent, unchanged). */
interface Genome {
  symBank: number[];
  baseHue: number;
  tempBank: number[];
  frameBank: number[];
  kernelFamily: number;
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const folds = [2, 4, 6, 8];
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

interface StrataState {
  beatPose: number;
  barFrameStyle: number;
  phraseFold: number;
  phraseHueShift: number;
  sectionTemp: number;
  sectionAxis: number;
  sectionBgHue: number;
}

class StrataEqRenderer implements PresetRenderer {
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

  private strikeAge = -1;
  private shockAge = -1;

  private kernelSpin = 0;
  private frameSpin = 0;

  private pseudoBeat = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private smoothDropPrev = 0;

  // --- BAND-OWNERSHIP presences (smoothed EQ knobs of the dominant deck).
  // lowP owns the kernel scale; midP owns frame+scene color; highP owns
  // scene seams + world stars. Baseline 1 (flat) so no-deck reads full.
  private lowP = 1;
  private midP = 1;
  private highP = 1;

  // Persistent starfield so the world-background stars are stable per section
  // (redrawn each frame but positions from the seed, count/brightness by highP).
  private starSeed = 1;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.state.phraseFold = this.genome.symBank[0];
    this.state.sectionBgHue = this.genome.baseHue;
    this.starSeed = Math.round(key) || 1;
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

    // --- Identity / genome (parent) ----------------------------------------
    const trackId = dominantTrackId(frame);
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null &&
      this.prevBeatCell === null
    ) {
      const pseudo = Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- BAND OWNERSHIP: dominant deck EQ knobs → smoothed presences --------
    const dom = dominantDeck(frame.decks);
    const targetLow = dom ? eqPresence(dom.eq.low) : 1;
    const targetMid = dom ? eqPresence(dom.eq.mid) : 1;
    const targetHigh = dom ? eqPresence(dom.eq.high) : 1;
    this.lowP = approach(this.lowP, targetLow, 0.12, dt);
    this.midP = approach(this.midP, targetMid, 0.12, dt);
    this.highP = approach(this.highP, targetHigh, 0.12, dt);
    const lowP = this.lowP;
    const midP = this.midP;
    const highP = this.highP;

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);

    // --- Metric tiers ------------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    const beatPhase = beat ? beat.phase : mod(this.pseudoBeat, 1);

    const dropEdge = drop > 0.5 && this.smoothDropPrev <= 0.5;
    this.smoothDropPrev = drop;

    if (hasGrid) {
      const barIndex = tierBar as number;
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
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeatCut(beatCell);
        if (mod(beatCell, PHRASE_BARS) === 0) this.onBarCut(Math.floor(beatCell / PHRASE_BARS));
        this.prevBeatCell = beatCell;
      }
    }

    if (dropEdge) this.dropCut();

    if (this.strikeAge >= 0) {
      this.strikeAge += dt;
      if (this.strikeAge > 0.5) this.strikeAge = -1;
    }
    if (this.shockAge >= 0) {
      this.shockAge += dt;
      if (this.shockAge > SHOCK_LIFE_S) this.shockAge = -1;
    }

    this.kernelSpin += dt * (1.4 + 3.0 * buildup + 2.0 * drive);
    this.frameSpin += dt * (0.4 + 1.2 * buildup + 0.8 * drive);

    // --- Stage -------------------------------------------------------------
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const contrast = frame.params.contrast ?? 1;
    const st = this.state;

    // strike force is OWNED BY LOWS: bass kill weakens the outward transfer.
    const strike = this.strikeAge >= 0 ? (1 - this.strikeAge / 0.5) * lowP : 0;
    const shock = this.shockAge >= 0 ? 1 - this.shockAge / SHOCK_LIFE_S : 0;

    // WORLD stratum (section): dark background regime + master axis.
    const worldHue = mod(st.sectionBgHue + st.sectionTemp, 360);
    const bgL = 2 + 4 * energy + 5 * shock;
    ctx.fillStyle = `hsl(${worldHue}, 65%, ${Math.min(16, bgL)}%)`;
    ctx.fillRect(0, 0, width, height);

    // WORLD background STARS — OWNED BY HIGHS. High kill → empty dark sky.
    this.drawStars(ctx, width, height, unit, highP, drive, frame.time);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(st.sectionAxis);
    ctx.globalCompositeOperation = 'lighter';

    const baseHue = mod(g.baseHue + st.phraseHueShift + st.sectionTemp, 360);

    // ---- SCENE stratum (phrase): dominant mirrored geometry, N-fold. ------
    // COLOR (saturation) is OWNED BY MIDS: mid kill → duotone (grey wedges).
    const sceneSat = Math.round(100 * midP); // 0 = grey duotone
    const fold = st.phraseFold;
    const sceneR = unit * 0.42 * scale;
    const sceneAlpha = 0.45 + 0.25 * drive;
    for (let a = 0; a < fold; a++) {
      const axis = (a / fold) * Math.PI * 2 + this.frameSpin * 0.15;
      ctx.save();
      ctx.rotate(axis);
      const spokeHue = mod(baseHue + a * (18 / Math.max(1, fold / 4)), 360);
      const grad = ctx.createLinearGradient(0, 0, sceneR, 0);
      grad.addColorStop(0, `hsla(${spokeHue}, ${sceneSat}%, ${28 + 20 * drive}%, ${sceneAlpha})`);
      grad.addColorStop(1, `hsla(${spokeHue}, ${sceneSat}%, ${8 + 16 * drive}%, 0)`);
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
    // SCENE SEAM glints — OWNED BY HIGHS. High kill → no seam sparkle.
    const glint = (frame.impulse.mid * 0.7 + frame.impulse.high * 0.3) * highP;
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

    // ---- FRAME stratum (bar): a mid-scale mirrored border. ----------------
    // COLOR (saturation) is OWNED BY MIDS: mid kill → grey frame (duotone).
    const frameSat = Math.round(100 * midP);
    const frameR = unit * 0.26 * scale;
    const frameStyle = st.barFrameStyle;
    const frameHue = mod(baseHue + 40, 360);
    ctx.strokeStyle = `hsla(${frameHue}, ${frameSat}%, ${45 + 25 * drive}%, ${(0.7 + 0.3 * drive) * contrast})`;
    ctx.lineWidth = Math.max(2, unit * 0.008 * (1 + 0.5 * frame.bands.mid));
    ctx.save();
    ctx.rotate(this.frameSpin * 0.3);
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
    // Frame corner glints brighten on the kernel STRIKE (light transfer, LOW).
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

    // ---- KERNEL stratum (beat): innermost glyph. --------------------------
    // SCALE + IMPACT are OWNED BY LOWS: bass kill → shrinks to a bare SEED.
    // seedFrac 1 at flat/boost, → ~0.12 (a dot) at full bass kill.
    const seedFrac = 0.12 + 0.88 * lowP;
    const kernelR = unit * (0.09 + 0.03 * frame.bands.low) * scale * seedFrac;
    const beatPulse = 0.5 + 0.5 * smoothstep(1 - beatPhase);
    const kernelHue = mod(baseHue + 80, 360);
    const kL = 55 + 35 * beatPulse + 20 * drive;
    ctx.save();
    ctx.rotate(this.kernelSpin * (0.6 + 0.8 * buildup));
    const pose = st.beatPose;
    this.drawKernel(ctx, kernelR, g.kernelFamily, pose, kernelHue, kL, beatPulse * (0.7 + 0.5 * drive));
    ctx.restore();

    // ---- Kick strike: solid impact that transfers light outward (LOW). ----
    // strike already scaled by lowP → bass kill stops the outward transfer.
    if (strike > 0.02) {
      const rr = kernelR + (frameR - kernelR) * (1 - strike) + (sceneR - frameR) * clamp01((1 - strike) * 2 - 1);
      ctx.strokeStyle = `rgba(255,255,255,${strike * 0.7})`;
      ctx.lineWidth = Math.max(2, unit * 0.014 * strike);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore(); // master axis

    // ---- Drop cross-strata flow: a sustained bright pulse binding all (parent).
    if (drop > 0.15) {
      ctx.globalCompositeOperation = 'lighter';
      const flow = drop * (0.6 + 0.4 * Math.sin(frame.time * 6));
      ctx.fillStyle = `hsla(${mod(baseHue + 80, 360)}, 100%, 60%, ${0.05 * flow})`;
      ctx.fillRect(0, 0, width, height);
    }

    // ---- Section shockwave (parent). --------------------------------------
    if (shock > 0) {
      const rr = unit * (0.05 + this.shockAge * 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${shock * 0.85})`;
      ctx.lineWidth = Math.max(2, unit * 0.022 * shock);
      ctx.stroke();
    }

    // ---- Tier HUD: nested rings ticking their own clocks (parent). ---------
    this.drawTierHud(ctx, cx, cy, unit, beatPhase);

    ctx.globalCompositeOperation = 'source-over';
  }

  /** WORLD background starfield — owned by HIGHS. Deterministic positions from
   * the section seed; count + brightness scale with highP so a high kill
   * empties the sky to clean minimal dark. Localized points (no dust media). */
  private drawStars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    unit: number,
    highP: number,
    drive: number,
    time: number
  ): void {
    if (highP < 0.03) return;
    const maxStars = 90;
    const count = Math.floor(maxStars * clamp01(highP));
    if (count <= 0) return;
    const r = splitmix(this.starSeed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hue = mod(this.genome.baseHue + 200, 360);
    for (let i = 0; i < count; i++) {
      const x = r() * width;
      const y = r() * height;
      const tw = 0.5 + 0.5 * Math.sin(time * (1 + r() * 3) + r() * 6.283);
      const a = (0.25 + 0.55 * tw) * clamp01(highP) * (0.7 + 0.4 * drive);
      const rad = Math.max(0.6, unit * (0.0012 + 0.0018 * tw));
      ctx.fillStyle = `hsla(${hue}, 90%, ${70 + 20 * tw}%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

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
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (family === 1) {
      const t = r * 0.32;
      ctx.fillRect(-t, -r, t * 2, r * 2);
      ctx.fillRect(-r, -t, r * 2, t * 2);
    } else if (family === 2) {
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
    ctx.fillStyle = `rgba(255,255,255,${clamp01(0.5 + glow)})`;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, r * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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

  // --- Boundary cuts: each rewrites ONLY its stratum's held state (parent). --

  private onBeatCut(beatCell: number): void {
    this.state.beatPose = mod(beatCell, BEAT_POSE_CYCLE);
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
    // Re-seed the starfield per section so the sky changes with the world cut.
    this.starSeed = (Math.round(this.genome.baseHue) + sectionIndex * 2657 + 1) >>> 0 || 1;
    this.shockAge = 0;
  }

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

const g08StrataEqPreset: VisualizerPreset = {
  id: 'g08-strata-eq',
  name: 'g08 strata-eq',
  params,
  create: () => new StrataEqRenderer(),
};

export default g08StrataEqPreset;
