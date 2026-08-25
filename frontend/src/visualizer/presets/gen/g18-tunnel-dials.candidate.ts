/**
 * g18-tunnel-dials (gen-18 COMBINE: g14-tunnel-verses × g08-voyage-beatgate).
 *
 * Falsifiable question (brief): can the tunnel carry a full nested meter
 * READOUT — beat pips inside the mouth, bar arcs ON the mouth, phrase
 * diamonds outside, plus a wall runway sector advancing per beat — so that
 * beat-in-bar, bar-in-phrase AND phrase-in-section are all literally
 * readable at a glance, without the instrumentation killing the ride?
 * Handoff directions: "meter-readable rings/runways"; "bar position should
 * be READABLE".
 *
 * The engine is tunnel-verses' (saga's Canvas-2D warp-feedback + hardcut's
 * QUANTIZED LOOK grammar), copied verbatim: mouthSides/paletteBank/rotDir/
 * sparkTier/innerOrnament hard-cut on phrase downbeats off a trackId
 * genome; sections stride + force a bank change; drop-on-boundary burst;
 * anticipation tighten; the FULLBLEED cover-factor fix; the 16-bar chapter
 * arc. From g08-voyage-beatgate: the meter-readout vocabulary, nested as
 * three dials (all counts are WHOLE integers — never interpolated):
 *
 *   INNER DIAL (beats): beatsPerBar pips in a ring inside the mouth.
 *   Elapsed beats are filled; the CURRENT pip fades in over its beat
 *   (photosafe); the downbeat shows the full bar then resets.
 *
 *   MOUTH DIAL (bars): the mouth ring is split into 4 bar arcs with gaps.
 *   Elapsed bars are lit; the current bar's arc SWEEPS with barPhase like
 *   a clock hand — bar position readable to the sub-bar.
 *
 *   OUTER DIAL (phrases): 4 diamonds at the compass diagonals, one lights
 *   per phrase of the section; all reset on the section cut.
 *
 *   WALL RUNWAY: one angular wedge of the tunnel wall softly lit,
 *   advancing one sector per beat (quantized snap + short chase), stamped
 *   into the feedback so it trails. Replaces verses' sparkles (no new dust
 *   media); the look's sparkTier now steps the runway brightness.
 *
 * Whites capped (~72% ring lightness). Motion rates ride frame.bandsSlow
 * ?? frame.bands (erratic-motion law); the kick lunge stays instantaneous.
 * Genome trackId derives from frame.dominantChannel (argmax-flap law).
 */

import { energyOf } from '../../style';
import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

/** Dream endpoint (g02-tunnel-dream defaults). */
const DREAM_TRAIL = 0.92;
const DREAM_ZOOM = 0.65;
/** Punch endpoint (g02-tunnel-punch defaults). */
const PUNCH_TRAIL = 0.42;
const PUNCH_ZOOM = 1.8;

const BARS_PER_SECTION = 16;
const PHRASE_BARS = 4;

/** Committed hue centers: ember / magenta / teal / violet. Luminance-
 * comparable, fully saturated (this repo dislikes pastels). */
const BANK_HUES = [25, 315, 175, 265] as const;
const MOUTH_CHOICES = [0, 3, 4, 5, 6] as const; // 0 = circle

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** splitmix32-style avalanche → a generator of stable [0,1) scalars. */
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

/** A single discrete LOOK — nothing here interpolates; it is CUT to whole. */
interface Look {
  mouthSides: number; // 0 (circle) or 3/4/5/6
  paletteBank: number; // 0..3 index into BANK_HUES
  rotDir: number; // -1/+1
  sparkTier: number; // 0/1/2
  innerOrnament: number; // 0/1
}

function lookAt(seed: number, index: number, forceBankAway: number | null): Look {
  const next = splitmix(((Math.round(seed) | 0) ^ Math.imul(index | 0, 0x9e3779b9)) >>> 0);
  const look: Look = {
    mouthSides: MOUTH_CHOICES[Math.floor(next() * MOUTH_CHOICES.length)],
    paletteBank: Math.floor(next() * BANK_HUES.length),
    rotDir: next() > 0.5 ? 1 : -1,
    sparkTier: Math.floor(next() * 3),
    innerOrnament: next() > 0.45 ? 1 : 0,
  };
  if (forceBankAway !== null && look.paletteBank === forceBankAway) {
    // Section cut: FORCE a different bank so section cuts land bigger.
    look.paletteBank = (look.paletteBank + 1 + Math.floor(next() * 3)) % BANK_HUES.length;
  }
  return look;
}

/** Dominant audible deck's trackId. LAW: prefer the smoothed
 * frame.dominantChannel (per-frame level argmax flaps during layering). */
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

/** Radius multiplier of a regular n-gon at angle a (1 for the circle). */
function mouthShape(sides: number, a: number): number {
  if (sides < 3) return 1;
  const seg = (Math.PI * 2) / sides;
  const local = ((a % seg) + seg) % seg;
  return Math.cos(Math.PI / sides) / Math.cos(local - Math.PI / sides);
}

class TunnelDialsRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;
  private mouthSpin = 0;
  private chapter = 0;
  private drive = 0;
  /** Wall-runway sector: chases the whole-integer beat target (quantized
   * snap with a short glide — structural motion, photosafe). */
  private sectorPos = 0;

  // --- Quantized look grammar state.
  private seedKey: number | null = null;
  private lookIndex = 0;
  private current: Look = lookAt(1, 0, null);
  private lastPhraseIndex: number | null = null;
  private lastSectionIndex: number | null = null;
  private burst = 0; // decaying drop-on-boundary ring burst
  private lastBurstPhrase = -999; // rate limit: ≤1 per phrase

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  /** Saga's section-arc chapter target (within-phrase continuity). */
  private chapterTarget(frame: VisualizerFrameData): number {
    const { trend, bands } = frame;
    const energy = energyOf(bands);
    const intensity = Math.max(trend.excitement, energy);

    let arc: number;
    if (frame.beat) {
      const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
      const barInSection =
        ((tierBar % BARS_PER_SECTION) + BARS_PER_SECTION) % BARS_PER_SECTION;
      const pos = (barInSection + frame.beat.barPhase) / BARS_PER_SECTION;
      arc = pos < 0.5 ? pos * 0.4 : 0.2 + smooth((pos - 0.5) * 2) * 0.8;
    } else {
      const cycle = (frame.time % 24) / 24;
      arc = smooth(cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
    }

    const accelerated = arc * (1 + 1.1 * trend.excitement);
    return clamp01(Math.max(accelerated, intensity * intensity));
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const bufferCtx = this.ensureBuffer(width, height);
    const { low, mid, high } = frame.bands;
    // motion: slow bands (erratic-motion law)
    const slow = frame.bandsSlow ?? frame.bands;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const cutStrength = frame.params.cutStrength ?? 1;

    // --- Identity: dominant trackId seeds the look sequence.
    const trackId = dominantTrackId(frame);
    const key =
      trackId != null
        ? trackId
        : Math.round((frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101);
    if (this.seedKey == null || key !== this.seedKey) {
      this.seedKey = key;
      const tb0 = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
      this.lookIndex = Math.floor(tb0 / PHRASE_BARS);
      this.current = lookAt(this.seedKey, this.lookIndex, null);
    }

    // Chapter (saga) + drive smoothing.
    const chapterAlpha = 1 - Math.exp(-frame.dt / 0.5);
    this.chapter += (this.chapterTarget(frame) - this.chapter) * chapterAlpha;
    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-frame.dt / 0.35));

    // --- CUT TIMING (hardcut): ladder tier primary; one-frame snaps.
    const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
    const barPhase = frame.beat ? frame.beat.barPhase : 0;
    let precut = 0;
    if (tierBar !== null) {
      const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
      const sectionIndex = Math.floor(tierBar / BARS_PER_SECTION);
      if (this.lastPhraseIndex !== null && phraseIndex !== this.lastPhraseIndex) {
        const sectionCut =
          this.lastSectionIndex !== null && sectionIndex !== this.lastSectionIndex;
        if (sectionCut) {
          // Section: STRIDE to a distant look + force a bank change.
          this.lookIndex += 3 + (Math.abs(sectionIndex) % 3);
          this.current = lookAt(this.seedKey, this.lookIndex, this.current.paletteBank);
        } else {
          this.lookIndex += 1;
          this.current = lookAt(this.seedKey, this.lookIndex, null);
        }
        // DROP-ON-BOUNDARY: burst + chapter slam (≤1 per phrase — photosafe).
        const landing = Math.max(this.drive, frame.trend.excitement);
        if (landing > 0.3 && phraseIndex - this.lastBurstPhrase >= 1) {
          this.burst = Math.min(1, landing) * cutStrength;
          this.chapter = Math.max(this.chapter, 0.95);
          this.lastBurstPhrase = phraseIndex;
        }
      }
      this.lastPhraseIndex = phraseIndex;
      this.lastSectionIndex = sectionIndex;
      // Anticipation: the final beat of the phrase TIGHTENS the mouth.
      const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
      if (barInPhrase === PHRASE_BARS - 1) {
        precut = Math.max(0, (barPhase - 0.75) / 0.25) * cutStrength;
      }
    } else {
      this.lastPhraseIndex = null;
      this.lastSectionIndex = null;
    }
    this.burst = Math.max(0, this.burst - frame.dt / 0.45);

    // --- METER READOUT inputs (whole integers — hard snaps, never eased;
    // ladder-tier bars, beatInBar for the sub-bar position).
    const beatsPerBar = frame.beat
      ? Math.max(1, Math.round(frame.beat.beatsPerBar || 4))
      : 4;
    const beatInBar = frame.beat
      ? ((Math.round(frame.beat.beatInBar) % beatsPerBar) + beatsPerBar) % beatsPerBar
      : 0;
    const beatFrac = frame.beat ? (barPhase * beatsPerBar) % 1 : frame.time % 1;

    const look = this.current;
    const chapter = this.chapter;
    const hardness = chapter;
    const trailBase = frame.params.trail ?? 1;
    const zoomParam = frame.params.zoom ?? 1;
    const trail = lerp(DREAM_TRAIL, PUNCH_TRAIL, chapter) * trailBase;
    const zoomDrive = lerp(DREAM_ZOOM, PUNCH_ZOOM, chapter) * zoomParam;

    // --- Warp the previous frame in (saga engine + fullbleed fix).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      const kick = frame.impulse.low;
      // motion: slow bands (erratic-motion law); kick lunge is the impulse.
      const zoom =
        1 +
        (0.28 + 1.4 * slow.low * slow.low + (2.6 + 2.4 * hardness) * kick) *
          zoomDrive *
          frame.dt;
      // Spin direction is the look's DISCRETE rotDir (cut, never eased).
      // motion: slow bands (erratic-motion law)
      this.rotation =
        (0.08 + (0.9 + 0.9 * hardness) * slow.mid + (1.4 + 1.4 * hardness) * frame.impulse.mid) *
        frame.dt *
        look.rotDir;
      // FULLBLEED (tunnel-class bug): cover-factor floor so the rotated
      // buffer always covers the viewport — no visible corner leak.
      const a = Math.abs(this.rotation);
      const ratio = Math.max(width, height) / Math.min(width, height);
      const coverScale = Math.cos(a) + ratio * Math.sin(a);
      const effectiveZoom = Math.max(zoom, coverScale * 1.001);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.globalAlpha = 0.88 + 0.11 * clamp01(trail);
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // --- Fresh geometry: the QUANTIZED mouth (polygon or circle — snaps on
    // the cut) in the look's committed bank hue with an energy sweep.
    ctx.globalCompositeOperation = 'lighter';
    const energy = energyOf(frame.bands);
    const bankHue = BANK_HUES[look.paletteBank];
    const hue = (bankHue + (energy - 0.5) * 70 + 360) % 360;
    // Anticipation tightens the mouth slightly (tension, no flash).
    const radius = unit * (0.1 + 0.16 * low) * (1 - 0.12 * precut);
    const wobble = unit * (0.008 + 0.03 * (1 - hardness)) * mid;
    // Mouth spin: the polygon slowly turns (rate on slow bands).
    this.mouthSpin += frame.dt * (0.15 + 0.6 * slow.mid) * look.rotDir;
    const ripple = 6 + 4 * hardness;
    const lightness = Math.min(72, 40 + 26 * low + 14 * hardness * frame.impulse.low);
    ctx.beginPath();
    const segments = 96;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const shape = mouthShape(look.mouthSides, angle - this.mouthSpin);
      const r =
        radius * shape + Math.sin(angle * ripple + frame.time * (3 + 2 * hardness)) * wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.003 + lerp(0.016, 0.008, hardness) + 0.01 * low));
    ctx.stroke();

    // Inner ornament (discrete on/off): a counter-rotating echo of the
    // mouth at 60% radius — localized, photosafe.
    if (look.innerOrnament === 1) {
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const shape = mouthShape(look.mouthSides, angle + this.mouthSpin * 1.7);
        const r = radius * 0.6 * shape;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsl(${(hue + 40) % 360}, 100%, ${Math.min(66, 46 + 16 * frame.impulse.low)}%)`;
      ctx.lineWidth = Math.max(1.5, unit * 0.0035);
      ctx.stroke();
    }

    // DROP-ON-BOUNDARY BURST: the NEW mouth stamped once at full size into
    // the feedback (decays over ~0.45 s; ≤1 per phrase — photosafe).
    if (this.burst > 0.01) {
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const shape = mouthShape(look.mouthSides, angle - this.mouthSpin);
        const r = radius * (1.5 + 1.2 * (1 - this.burst)) * shape;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsl(${hue}, 100%, ${Math.min(70, 70 * this.burst)}%)`;
      ctx.lineWidth = Math.max(2, unit * 0.008 * this.burst);
      ctx.stroke();
    }

    // --- WALL RUNWAY (replaces sparkles — no new dust media): one angular
    // wedge of the tunnel wall softly lit, advancing one sector per beat
    // (quantized snap + short chase). The look's DISCRETE sparkTier steps
    // its brightness; stamped into the feedback so it trails. Chapter and
    // drive lift it as the journey hardens.
    const runwayTier = 0.5 + 0.35 * look.sparkTier;
    if (frame.beat) {
      let diffS = beatInBar - (this.sectorPos % beatsPerBar);
      if (diffS < -beatsPerBar / 2) diffS += beatsPerBar;
      if (diffS > beatsPerBar / 2) diffS -= beatsPerBar;
      this.sectorPos += diffS * (1 - Math.exp(-frame.dt / 0.07));
    } else {
      this.sectorPos += frame.dt * 1.2;
    }
    this.sectorPos = ((this.sectorPos % beatsPerBar) + beatsPerBar) % beatsPerBar;
    {
      const secAng = (this.sectorPos / beatsPerBar) * Math.PI * 2 - Math.PI / 2;
      const halfW = (Math.PI / beatsPerBar) * 0.72;
      const rIn = radius * 1.5;
      const rOut = unit * 0.74;
      ctx.globalAlpha =
        (0.08 + 0.1 * low + 0.08 * frame.impulse.low + 0.05 * high + 0.06 * hardness + 0.05 * this.drive) *
        runwayTier;
      ctx.fillStyle = `hsl(${hue}, 100%, ${Math.min(56, 38 + 20 * low)}%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, secAng - halfW, secAng + halfW);
      ctx.arc(cx, cy, rIn, secAng + halfW, secAng - halfW, true);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- INNER DIAL: beat pips. Elapsed beats filled; the CURRENT pip
    // fades in over its beat (photosafe); the downbeat shows the full bar
    // then the next bar resets the fill (beatgate ring semantics).
    {
      const charged = beatInBar === 0 ? beatsPerBar : beatInBar;
      const fade = 1 - Math.exp(-beatFrac / 0.35);
      const pr = radius * 0.45;
      const pipHue = (hue + 40) % 360;
      for (let i = 0; i < beatsPerBar; i++) {
        const a = (i / beatsPerBar) * Math.PI * 2 - Math.PI / 2;
        let amt = 0.14;
        if (i < charged) amt = 1;
        else if (i === charged && charged < beatsPerBar) amt = Math.max(0.14, fade);
        ctx.globalAlpha = amt * 0.9;
        ctx.fillStyle = `hsl(${pipHue}, 100%, ${Math.min(66, 48 + 14 * amt + 10 * frame.impulse.low)}%)`;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(a) * pr,
          cy + Math.sin(a) * pr,
          Math.max(1.5, unit * 0.006),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- MOUTH DIAL: the mouth ring split into 4 bar arcs with gaps;
    // elapsed bars lit; the CURRENT bar's arc SWEEPS with barPhase like a
    // clock hand — bar position readable to the sub-bar.
    if (tierBar !== null) {
      const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
      const arcR = radius * 1.16;
      ctx.lineWidth = Math.max(1.5, unit * 0.004);
      for (let i = 0; i < PHRASE_BARS; i++) {
        const a0 = (i / PHRASE_BARS) * Math.PI * 2 - Math.PI / 2 + 0.07;
        const a1 = ((i + 1) / PHRASE_BARS) * Math.PI * 2 - Math.PI / 2 - 0.07;
        // Faint track so the dial reads even when empty.
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = `hsl(${hue}, 100%, 45%)`;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, a0, a1);
        ctx.stroke();
        const frac = i < barInPhrase ? 1 : i === barInPhrase ? barPhase : 0;
        if (frac > 0.004) {
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = `hsl(${hue}, 100%, ${Math.min(64, 50 + 10 * frame.impulse.low)}%)`;
          ctx.beginPath();
          ctx.arc(cx, cy, arcR, a0, a0 + (a1 - a0) * frac);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- OUTER DIAL: phrase diamonds at the compass diagonals — one lights
    // per phrase of the section; all reset on the section cut.
    if (tierBar !== null) {
      const phraseInSection = Math.floor(
        (((tierBar % BARS_PER_SECTION) + BARS_PER_SECTION) % BARS_PER_SECTION) / PHRASE_BARS
      );
      const dr = unit * 0.4;
      const ds = Math.max(2, unit * 0.011);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const dx = cx + Math.cos(a) * dr;
        const dy = cy + Math.sin(a) * dr;
        const lit = i <= phraseInSection;
        ctx.globalAlpha = lit ? 0.85 : 0.16;
        ctx.fillStyle = `hsl(${(hue + 180) % 360}, 100%, ${lit ? 58 : 40}%)`;
        ctx.beginPath();
        ctx.moveTo(dx, dy - ds);
        ctx.lineTo(dx + ds, dy);
        ctx.lineTo(dx, dy + ds);
        ctx.lineTo(dx - ds, dy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    // Snapshot for the next warp.
    if (bufferCtx && this.buffer) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(ctx.canvas, 0, 0);
    }
  }
}

const candidate: VisualizerPreset = {
  id: 'g18-tunnel-dials',
  name: 'g18 tunnel-dials',
  params: [
    { id: 'trail', label: 'trail length', min: 0.4, max: 1.4, step: 0.02, default: 1 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'cutStrength', label: 'cut drama', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => new TunnelDialsRenderer(),
};

export default candidate;
