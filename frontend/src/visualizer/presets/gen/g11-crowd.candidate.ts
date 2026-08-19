/**
 * "g11 crowd" (genetic arena g11, NOVEL — new PULSE representation: CROWD
 * PHYSICS). A festival floor of flat solid figures (block bodies + round
 * heads) packed into genome-arranged rows, seen side-on. A giant solid
 * sun/logo backdrop carries the section palette. The win condition is
 * LEGIBLE CAUSALITY (the pinball lesson): the stage + crowd skeleton is
 * ALWAYS on screen — never a blank frame — so every band maps to a motion
 * you can read.
 *
 * NEW REPRESENTATION OF PULSE (not rings/pumps/ripples):
 *   KICK   — the crowd JUMPS. Staggered by row distance from the stage:
 *            a visible WAVE of jumps propagates back through the rows, each
 *            row firing a beat-fraction later. Landing bounce (squash) on
 *            return. Gated on impulse.low (kick clicks are broadband).
 *   BASS   — jump HEIGHT envelope. bandsSlow.low sets how high the crowd
 *            can leap; a heavy bassline = big air, thin bass = little hops.
 *   MIDS   — crowd SWAY. Rows lean left/right in a traveling wave; mid
 *            level also washes a palette tint across the crowd bodies.
 *   HIGHS  — discrete camera FLASHES in the crowd: <=4 simultaneous, tiny,
 *            LOCALIZED white squares on random figures (photosafe — never a
 *            full-field flash). Spawn gated on impulse.high.
 *
 * SECTION/PHRASE/DROP grammar (beat.ladderBarIndex ?? beat.barIndex):
 *   SECTION— the backdrop sun + 4-color scheme HARD-SWAP (chroma event,
 *            comparable mean luminance — no strobe).
 *   PHRASE — one row does a quantized WAVE (arms-up ripple across it).
 *   DROP   — MOSH: every row jumps on every beat (stagger collapses),
 *            backdrop flips to the hottest scheme color. Rides
 *            max(drop, energy) so it holds across the plateau.
 *   BUILDUP— crowd CROUCHES (loading the jump): tense but alive.
 *
 * FLAT-ADJACENT: solid matte fills, hard edges, committed 4-color schemes,
 * source-over only. No glow/bloom/feedback/dust/particles. Motion is
 * TRANSFORMS (jump/sway/squash) and COLOR SWAPS.
 *
 * Assigned tech: impulse.low (jump trigger) + bandsSlow.low (jump height);
 * bandsSlow.mid (sway) + bands.mid (tint); impulse.high (camera flashes);
 * beat clock + ladder tiers (wave stagger, phrase wave, section swap);
 * trend drop/buildup split (mosh/crouch); trackId genome (row layout +
 * scheme order). Canvas 2D flat quads.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const ROW_COUNT = 7;
const PHRASE_BARS = 4;
const SECTION_BARS = 16;
const MAX_FLASHES = 4;
/** how much later (in beat fractions) each row-back fires its jump. */
const ROW_LAG = 0.10;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same crowd + scheme. */
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

/** A committed flat scheme: dark stage/floor bg, backdrop sun, two crowd
 * body tones (alternating rows for depth), one HOT accent for the mosh
 * backdrop flip. Bright/saturated, comparable mean luminance across schemes. */
interface FlatScheme {
  bg: string;
  floor: string;
  sun: string;
  bodyA: string;
  bodyB: string;
  hot: string;
}

const SCHEMES: FlatScheme[] = [
  // night teal stage / coral sun / warm crowd / magenta hot
  { bg: '#0c1a1f', floor: '#08383f', sun: '#ff6b4a', bodyA: '#ffb347', bodyB: '#c9762a', hot: '#ff2e88' },
  // indigo / lime sun / cyan crowd / amber hot
  { bg: '#0e1226', floor: '#242a55', sun: '#b6ff2a', bodyA: '#25d0ff', bodyB: '#1478a5', hot: '#ffb000' },
  // wine / gold sun / sky crowd / mint hot
  { bg: '#1c0f1a', floor: '#3a1830', sun: '#ffcf3f', bodyA: '#5fc8ff', bodyB: '#2a7ab0', hot: '#4be6a0' },
  // deep sea / magenta sun / lime crowd / cyan hot
  { bg: '#081826', floor: '#123048', sun: '#ff3fae', bodyA: '#b6ff4a', bodyB: '#6ba52a', hot: '#25e0ff' },
  // slate violet / orange sun / mint crowd / yellow hot
  { bg: '#141226', floor: '#2c2450', sun: '#ff8a2a', bodyA: '#4be6c0', bodyB: '#2aa585', hot: '#ffe33a' },
];

interface Figure {
  /** horizontal cell within the row, 0..1. */
  x: number;
  /** per-figure height jitter (short/tall festival-goers). */
  tall: number;
  /** stable random phase for idle bob. */
  seed: number;
}

interface CameraFlash {
  row: number;
  col: number;
  /** 0..1 envelope; decays to 0 (localized, exempt from strobe cap). */
  life: number;
}

class CrowdRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  /** genome: per-row figure layout + scheme walk order. */
  private rows: Figure[][] = [];
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  /** per-row jump envelope (0 grounded .. 1 apex) and its velocity. */
  private jump: number[] = new Array(ROW_COUNT).fill(0);
  /** per-row jump trigger time offset accumulator (drives the back-wave). */
  private jumpArm: number[] = new Array(ROW_COUNT).fill(0);

  /** smoothed sway phase + traveling wave clock. */
  private swayClock = 0;
  /** phrase-wave: which row is doing the quantized arms-up ripple (or -1). */
  private waveRow = -1;
  private waveProgress = 0;

  private flashes: CameraFlash[] = [];

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private smoothBass = 0;

  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    // Row layouts: each row a genome-arranged line of figures.
    this.rows = [];
    for (let ri = 0; ri < ROW_COUNT; ri++) {
      const count = 8 + Math.floor(r() * 5); // 8..12 per row
      const figs: Figure[] = [];
      for (let i = 0; i < count; i++) {
        // even spacing + jitter so the row reads as a solid crowd, not a grid.
        const x = (i + 0.5) / count + (r() - 0.5) * (0.35 / count);
        figs.push({ x: clamp01(x), tall: 0.8 + r() * 0.5, seed: r() * Math.PI * 2 });
      }
      this.rows.push(figs);
    }
    // Scheme walk order (genome).
    const order = SCHEMES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.schemeOrder = order;
    this.schemeIndex = order[0];
  }

  private triggerJumps(): void {
    // Arm every row; the back-wave lag is applied per row in render via
    // jumpArm countdown. Front row (nearest stage) fires immediately.
    for (let ri = 0; ri < ROW_COUNT; ri++) {
      this.jumpArm[ri] = ri * ROW_LAG;
    }
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

    // --- Identity / genome --------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (this.lastTrackId === null && this.rows.length === 0) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.rows.length === 0) this.reseed(1);

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    // bass-weighted smoothed drive drives jump height ceiling.
    this.smoothBass += (bandsSlow.low - this.smoothBass) * (1 - Math.exp(-dt / 0.4));
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const drive = Math.max(drop, clamp01(energy * 1.4));
    const moshOn = drive > 0.45;

    // --- Beat clock: bar + beat cell (kick wave stagger, phrase, section) ---
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    // --- Kick jump trigger (impulse.low; broadband gate). In mosh, every
    // beat re-triggers; otherwise every kick. ---------------------------------
    const kick = frame.impulse.low;
    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatsPerBar = Math.max(1, beat!.beatsPerBar);
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * beatsPerBar);
      const beatCell = barIndex * beatsPerBar + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        // A new beat landed. Fire the crowd if a kick is present, or always
        // during the mosh plateau.
        if (kick > 0.14 || moshOn) this.triggerJumps();
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      // Gridless: pseudo-beat clock + raw kick detection.
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        if (kick > 0.14 || moshOn) this.triggerJumps();
        if (mod(beatCell, PHRASE_BARS) === 0) this.onBarCut(Math.floor(beatCell / PHRASE_BARS));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Advance per-row jump physics --------------------------------------
    // Jump height ceiling from bass (bandsSlow) — heavy bass = big air.
    const heightGain = frame.params.jumpHeight ?? 1;
    const bassAir = 0.35 + 0.9 * this.smoothBass;
    for (let ri = 0; ri < ROW_COUNT; ri++) {
      // In mosh the stagger collapses (all rows near-synchronous).
      const armLag = moshOn ? this.jumpArm[ri] * 0.25 : this.jumpArm[ri];
      if (armLag > 0) {
        // count down the row's launch delay in beat-fraction * ~0.14s each.
        this.jumpArm[ri] = Math.max(0, armLag - dt / 0.14);
        if (this.jumpArm[ri] <= 0 && armLag > 0) this.jump[ri] = 1; // launch impulse
      }
      // Ballistic-ish decay of the jump envelope back to ground (gravity).
      this.jump[ri] = Math.max(0, this.jump[ri] - dt * 3.4);
    }

    // --- Sway (mids: bandsSlow.mid drives the traveling-wave SPEED) --------
    const swaySpeed = 0.5 + 2.2 * bandsSlow.mid;
    this.swayClock += dt * swaySpeed;
    const swayAmp = 0.06 + 0.22 * bandsSlow.mid;

    // --- Phrase wave progress ----------------------------------------------
    if (this.waveRow >= 0) {
      this.waveProgress += dt * 1.6;
      if (this.waveProgress >= 1) this.waveRow = -1;
    }

    // --- Camera flashes (highs: impulse.high, <=4, tiny localized) ---------
    // decay existing.
    for (const f of this.flashes) f.life -= dt / 0.14;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    if (frame.impulse.high > 0.2 && this.flashes.length < MAX_FLASHES) {
      // spawn 1 new localized flash on a random figure.
      const row = Math.floor(Math.random() * ROW_COUNT);
      const figs = this.rows[row];
      if (figs && figs.length) {
        const col = Math.floor(Math.random() * figs.length);
        this.flashes.push({ row, col, life: 1 });
      }
    }

    // --- Scene setup --------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = scheme.bg;
    ctx.fillRect(0, 0, width, height);

    // Backdrop sun/logo: a big solid disc high on the stage. In mosh it
    // flips to the HOT scheme color (held across the plateau).
    const sunColor = moshOn ? scheme.hot : scheme.sun;
    const horizonY = height * 0.64;
    const sunR = width * (0.13 + 0.03 * drive);
    const sunX = width * 0.5;
    const sunY = height * 0.30;
    ctx.fillStyle = sunColor;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // Flat solid floor/stage — the skeleton that is ALWAYS present.
    ctx.fillStyle = scheme.floor;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // --- Crowd (front row last; painter's back-to-front) -------------------
    // Rows recede up toward the horizon; nearer rows are larger.
    const crouch = 0.35 * buildup; // buildup lowers resting head height
    const scale = frame.params.crowdScale ?? 1;
    const tintAmt = clamp01(frame.bands.mid * (frame.params.swayTint ?? 1));

    for (let ri = ROW_COUNT - 1; ri >= 0; ri--) {
      const figs = this.rows[ri];
      if (!figs) continue;
      // depth 0 (front) .. 1 (back)
      const depth = ri / (ROW_COUNT - 1);
      // baseline y: front rows sit lower on screen (closer to camera).
      const baseY = horizonY + (height - horizonY) * (0.20 + 0.72 * (1 - depth));
      const rowScale = (0.55 + 0.55 * (1 - depth)) * scale;
      const bodyW = width * 0.028 * rowScale;
      const bodyH = width * 0.055 * rowScale;
      const headR = bodyW * 0.55;

      // Row jump offset (pixels up). Bass sets the air.
      const jumpPx = this.jump[ri] * bassAir * bodyH * 1.6 * heightGain;
      // Squash on landing: when near ground but was recently airborne, no
      // extra math needed — jump env already returns; add a subtle floor
      // squash when jump is small but nonzero on the way down.
      const squash = this.jump[ri] < 0.25 && this.jump[ri] > 0.02 ? 0.12 : 0;

      // Traveling sway wave across rows.
      const swayPhase = this.swayClock - depth * 1.4;
      const lean = Math.sin(swayPhase) * swayAmp;

      // Body tone alternates by row for flat depth; mid tint washes over.
      const baseBody = ri % 2 === 0 ? scheme.bodyA : scheme.bodyB;
      const bodyColor = tintAmt > 0.05 ? mixHex(baseBody, scheme.hot, tintAmt * 0.35) : baseBody;

      // Phrase wave: figures in the wave row throw arms up as the ripple
      // crosses them (a per-figure vertical bump).
      const rowInWave = this.waveRow === ri;

      for (let fi = 0; fi < figs.length; fi++) {
        const fig = figs[fi];
        const cx = fig.x * width;
        // lean shifts each figure horizontally by its distance from center.
        const leanShift = (fig.x - 0.5) * 0 + lean * width * 0.03;
        const idle = Math.sin(this.swayClock * 0.5 + fig.seed) * bodyH * 0.05;
        let waveLift = 0;
        if (rowInWave) {
          const d = Math.abs(fig.x - this.waveProgress);
          waveLift = Math.max(0, 1 - d * 6) * bodyH * 0.9;
        }
        const feetY = baseY - crouch * bodyH * 0.0 + idle;
        const lift = jumpPx + waveLift;
        const h = bodyH * fig.tall * (1 - squash) * (1 - crouch);
        const bx = cx + leanShift - bodyW / 2;
        const topY = feetY - h - lift;

        // Solid block body (hard-edged matte fill).
        ctx.fillStyle = bodyColor;
        ctx.fillRect(bx, topY, bodyW, h);
        // Round head, same tone (flat).
        ctx.beginPath();
        ctx.arc(cx + leanShift, topY - headR * 0.4, headR, 0, Math.PI * 2);
        ctx.fill();

        // Camera flash: tiny localized white square on this figure.
        // (localized pulse — exempt from the full-field strobe cap).
        for (const fl of this.flashes) {
          if (fl.row === ri && fl.col === fi) {
            ctx.fillStyle = `rgba(255,255,255,${0.85 * clamp01(fl.life)})`;
            const s = headR * 1.6;
            ctx.fillRect(cx + leanShift - s / 2, topY - headR * 0.4 - s / 2, s, s);
          }
        }
      }
    }
  }

  // --- Boundary cuts ------------------------------------------------------

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      // one row (rotating) does a quantized arms-up wave.
      const phraseIndex = Math.floor(barIndex / PHRASE_BARS);
      this.waveRow = mod(phraseIndex, ROW_COUNT);
      this.waveProgress = 0;
    }
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
    }
  }
}

/** parse #rrggbb → [r,g,b]. */
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** flat linear mix of two hex colors → css rgb string. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const k = clamp01(t);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

const params: PresetParam[] = [
  { id: 'jumpHeight', label: 'jump height', min: 0.6, max: 1.8, step: 0.05, default: 1.1 },
  { id: 'crowdScale', label: 'crowd scale', min: 0.7, max: 1.4, step: 0.05, default: 1 },
  { id: 'swayTint', label: 'sway tint', min: 0, max: 1.5, step: 0.05, default: 0.8 },
];

const g11CrowdPreset: VisualizerPreset = {
  id: 'g11-crowd',
  name: 'g11 crowd',
  params,
  create: () => new CrowdRenderer(),
};

export default g11CrowdPreset;
