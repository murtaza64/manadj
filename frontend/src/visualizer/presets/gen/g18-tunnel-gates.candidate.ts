/**
 * g18-tunnel-gates (gen-18 COMBINE: g04-tunnel-saga × g14-tunnel-verses).
 *
 * Falsifiable question (brief): does making the meter SPATIAL — upcoming
 * bar/phrase/section boundaries visible as approaching GATES the tunnel
 * flies through, with a 32-bar HYPERMETER journey between landmarks — read
 * better than verses' purely temporal cuts? Handoff direction:
 * "HYPERMETER-scale arcs (32/64-bar journeys with landmarks)".
 *
 * The engine is tunnel-verses' (saga's Canvas-2D warp-feedback + hardcut's
 * QUANTIZED LOOK grammar), copied verbatim: mouthSides/paletteBank/rotDir/
 * sparkTier/innerOrnament hard-cut on phrase downbeats off a trackId
 * genome; sections stride + force a bank change; drop-on-boundary burst;
 * anticipation tighten; the FULLBLEED cover-factor fix. Two additions:
 *
 *   THE GATES. The next ~8 bar boundaries are drawn as gates at
 *   PERSPECTIVE radii — near boundary = big gate — so the distance to the
 *   next phrase/section boundary is READABLE as literal distance ahead.
 *   Tier hierarchy (proportional): BAR gates are thin faint rings in the
 *   current hue; PHRASE gates are thicker and carry the NEXT look's
 *   polygon + bank hue (the cut is FORESHADOWED — you see what's coming
 *   before you fly through it); SECTION gates are double-ring and biggest;
 *   32-bar LANDMARK gates are triple-ring. Passing a gate stamps a ring
 *   burst into the feedback proportional to its tier (≤1 per bar,
 *   moderate — photosafe).
 *
 *   THE JOURNEY. Saga's chapter arc is stretched to a 32-bar hypermeter:
 *   a long low approach (bars 0-16), the climb (16-28), the summit at the
 *   landmark (28-32) — then the arrival resets and the next journey opens.
 *   Drops still override to full punch; buildups still accelerate.
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
/** The hypermeter: a 32-bar journey between landmark gates. */
const HYPER_BARS = 32;
/** How many upcoming bar boundaries are visible as approaching gates. */
const GATE_LOOKAHEAD = 8;
const SPARKS_PER_S = 200;

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

/** Stroke one gate outline (polygon or circle) at a perspective radius. */
function strokeGate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  spin: number,
  hue: number,
  lightness: number,
  lineWidth: number
): void {
  ctx.beginPath();
  const segments = 72;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const shape = mouthShape(sides, angle - spin);
    const x = cx + Math.cos(angle) * radius * shape;
    const y = cy + Math.sin(angle) * radius * shape;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

class TunnelGatesRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;
  private mouthSpin = 0;
  private chapter = 0;
  private drive = 0;

  // --- Quantized look grammar state.
  private seedKey: number | null = null;
  private lookIndex = 0;
  private current: Look = lookAt(1, 0, null);
  private lastPhraseIndex: number | null = null;
  private lastSectionIndex: number | null = null;
  private burst = 0; // decaying drop-on-boundary ring burst
  private lastBurstPhrase = -999; // rate limit: ≤1 per phrase

  // --- Gate state: passage burst (tier-proportional, ≤1 per bar).
  private gatePass = 0; // decaying passage flash amplitude
  private gatePassHue = BANK_HUES[0] as number;
  private lastCrossedBar: number | null = null;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  /** The 32-bar HYPERMETER journey arc (saga's chapter, stretched): a long
   * low approach (bars 0-16), the climb (16-28), the summit at the landmark
   * (28-32) — then the arrival resets and the next journey opens. */
  private chapterTarget(frame: VisualizerFrameData): number {
    const { trend, bands } = frame;
    const energy = energyOf(bands);
    const intensity = Math.max(trend.excitement, energy);

    let arc: number;
    if (frame.beat) {
      const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
      const barInJourney = ((tierBar % HYPER_BARS) + HYPER_BARS) % HYPER_BARS;
      const pos = (barInJourney + frame.beat.barPhase) / HYPER_BARS;
      if (pos < 0.5) {
        arc = pos * 0.5; // the approach: 0 → 0.25 over 16 bars
      } else if (pos < 0.875) {
        arc = 0.25 + smooth((pos - 0.5) / 0.375) * 0.55; // the climb → 0.8
      } else {
        arc = 0.8 + smooth((pos - 0.875) / 0.125) * 0.2; // the summit → 1
      }
    } else {
      const cycle = (frame.time % 48) / 48;
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
      // GATE PASSAGE: a bar boundary was crossed — one tier-proportional
      // burst (bar faint, phrase medium, section big, landmark biggest;
      // ≤1 per bar — photosafe).
      if (this.lastCrossedBar !== null && tierBar !== this.lastCrossedBar) {
        const landmark = tierBar % HYPER_BARS === 0;
        const section = tierBar % BARS_PER_SECTION === 0;
        const phrase = tierBar % PHRASE_BARS === 0;
        this.gatePass =
          (landmark ? 1 : section ? 0.85 : phrase ? 0.55 : 0.22) * cutStrength;
        this.gatePassHue = BANK_HUES[this.current.paletteBank];
      }
      this.lastCrossedBar = tierBar;
    } else {
      this.lastPhraseIndex = null;
      this.lastSectionIndex = null;
      this.lastCrossedBar = null;
    }
    this.burst = Math.max(0, this.burst - frame.dt / 0.45);
    this.gatePass = Math.max(0, this.gatePass - frame.dt / 0.4);

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

    // --- THE GATES: the next GATE_LOOKAHEAD bar boundaries at perspective
    // radii (near = big) — the distance to the next phrase/section boundary
    // is readable as literal distance ahead. Phrase gates FORESHADOW the
    // next look (its polygon + bank hue); section gates double-ring;
    // 32-bar landmark gates triple-ring. Far gates first (near on top).
    if (tierBar !== null && this.seedKey != null) {
      // The exact look after the NEXT phrase/section boundary (verses' cut
      // arithmetic reproduced, so the foreshadow matches the cut).
      const nextBoundaryBar = (Math.floor(tierBar / PHRASE_BARS) + 1) * PHRASE_BARS;
      let nextLook: Look;
      if (nextBoundaryBar % BARS_PER_SECTION === 0) {
        const stride = 3 + (Math.abs(Math.floor(nextBoundaryBar / BARS_PER_SECTION)) % 3);
        nextLook = lookAt(this.seedKey, this.lookIndex + stride, this.current.paletteBank);
      } else {
        nextLook = lookAt(this.seedKey, this.lookIndex + 1, null);
      }
      const p = tierBar + barPhase;
      const first = Math.floor(p) + 1;
      for (let k = GATE_LOOKAHEAD - 1; k >= 0; k--) {
        const b = first + k;
        const d = b - p; // bars until this gate, in (0, LOOKAHEAD]
        const scale = 1 / (1 + d * 0.85); // perspective: near = big
        const near = clamp01(1 - d / GATE_LOOKAHEAD);
        const gr = unit * 0.52 * scale;
        const landmark = b % HYPER_BARS === 0;
        const section = b % BARS_PER_SECTION === 0;
        const phrase = b % PHRASE_BARS === 0;
        let sides = 0;
        let gHue = hue;
        let alpha = 0.09 + 0.1 * near;
        let lw = Math.max(1, unit * 0.0022 * (0.4 + scale));
        let rings = 1;
        let lightness = 52;
        if (phrase) {
          sides = nextLook.mouthSides;
          gHue = (BANK_HUES[nextLook.paletteBank] + (energy - 0.5) * 40 + 360) % 360;
          alpha = 0.16 + 0.3 * near;
          lw = Math.max(1.5, unit * 0.005 * (0.4 + scale));
          rings = landmark ? 3 : section ? 2 : 1;
          lightness = section ? 62 : 58;
        }
        ctx.globalAlpha = alpha;
        for (let ri = 0; ri < rings; ri++) {
          strokeGate(ctx, cx, cy, gr * (1 + ri * 0.09), sides, this.mouthSpin, gHue, lightness, lw);
        }
        ctx.globalAlpha = 1;
      }
    }

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

    // GATE PASSAGE: an expanding ring stamped into the feedback as the gate
    // flies past — amplitude is the gate's tier (≤1 per bar, moderate).
    if (this.gatePass > 0.01) {
      ctx.globalAlpha = Math.min(0.55, this.gatePass * 0.55);
      strokeGate(
        ctx,
        cx,
        cy,
        unit * (0.5 + (1 - this.gatePass) * 0.35),
        look.mouthSides,
        this.mouthSpin,
        this.gatePassHue,
        60,
        Math.max(2, unit * 0.007 * this.gatePass)
      );
      ctx.globalAlpha = 1;
    }

    // Sparkles — density stepped by the DISCRETE spark tier (cut, not eased).
    const tierGain = 0.4 + 0.55 * look.sparkTier;
    const density = (1 + 0.8 * hardness + 0.6 * this.drive) * tierGain;
    const wanted = SPARKS_PER_S * density * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const shape = mouthShape(look.mouthSides, angle - this.mouthSpin);
      const distance = radius * shape * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.0035 * Math.random());
      ctx.fillStyle = `hsl(${(hue + 180 + Math.random() * 40) % 360}, 100%, 65%)`;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * distance,
        cy + Math.sin(angle) * distance,
        size,
        0,
        Math.PI * 2
      );
      ctx.fill();
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
  id: 'g18-tunnel-gates',
  name: 'g18 tunnel-gates',
  params: [
    { id: 'trail', label: 'trail length', min: 0.4, max: 1.4, step: 0.02, default: 1 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'cutStrength', label: 'cut drama', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => new TunnelGatesRenderer(),
};

export default candidate;
