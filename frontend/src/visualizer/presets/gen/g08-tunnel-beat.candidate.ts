/**
 * g08-tunnel-beat (tweak of g02-tunnel-dream, with the g07-voyage-hardcut
 * insight: meter tiers as HARD CUTS, not blends).
 *
 * The dreamy tunnel visual language stays, but LOCOMOTION IS QUANTIZED:
 * the tunnel no longer drifts continuously — it advances in beat-locked
 * LURCHES. Each beat fires an eased snap forward (a big feedback zoom pulse
 * that decays to near-still before the next beat) — heartbeat locomotion.
 * The KICK IS the lurch: the transient itself slams the tunnel forward, so
 * a missing kick means a still frame.
 *
 * Meter tiers are theatre, quantized hard to the grid (ladderBarIndex ??
 * barIndex, no interpolation — integer things step):
 *   BEAT    = the lurch fires (kick slams the zoom pulse).
 *   BAR     = a new wall-pattern SEGMENT snaps in: the corrugation
 *             frequency/phase jumps to a genome-sequenced value (segment
 *             texture snap).
 *   PHRASE  = a JUNCTION: the tunnel visibly branches and takes a turn —
 *             a hard geometry cut (the travel axis rotates by a stepped
 *             angle; walls kink at the branch).
 *   SECTION = a MATERIAL regime change: the whole palette/rendering family
 *             swaps (regime index steps; hue base + saturation + ring
 *             hardness jump together).
 *   SNARE   = a wall GLINT ripple (mid impulse lights a travelling band).
 *
 * DROP = the quantized grammar dissolves into a CONTINUOUS RUSH (quantized
 * -> fluid contrast): the lurch floor lifts to a sustained zoom riding
 * max(drop, energy), so the near-still gaps fill in. BUILDUP = the lurches
 * get HUNGRIER: longer reach (bigger snap amplitude) and a harder,
 * later-peaking snap as excitement climbs.
 *
 * Canvas 2D, feedback-buffer engine identical in spirit to the parent
 * tunnel. Chroma preserved: warp composites onto black, geometry uses
 * `lighter`, lightness soft-knee'd (never per-channel clamp). Photo-safety:
 * the lurch is a localized zoom pulse on a smooth eased envelope (exempt),
 * no full-field flash; hard cuts change GEOMETRY/texture, not full-field
 * luminance; never saturated red.
 */

import { energyHue, energyOf } from '../../style';
import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const SPARKS_PER_S = 200;
const BARS_PER_PHRASE = 4;
const BARS_PER_SECTION = 16;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Deterministic per-index hash in [0,1] — genome sequencing for segment
 * textures, junction turns, and material regimes (per-axis seed mixing so
 * bar/phrase/section indices decorrelate). */
function hash(n: number, salt: number): number {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

class TunnelBeatRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;

  /** Lurch envelope: 1 right after a beat, decaying to ~0 (near-still). */
  private lurch = 0;
  /** Grid keys we last acted on — hard cuts fire once per crossing. */
  private lastBeatKey = Number.NaN;
  private lastBarKey = Number.NaN;
  private lastPhraseKey = Number.NaN;
  private lastSectionKey = Number.NaN;
  /** Fallback beat clock without a grid (keeps the heartbeat alive). */
  private fallbackClock = 0;
  /** Smoothed drop/energy drive (regime smoothing, ~0.35 s). */
  private drive = 0;

  // Current genome-sequenced scene state (snap on tier crossings).
  private segFreq = 6; // wall corrugation frequency (bar segment)
  private segPhase = 0; // corrugation phase (bar segment)
  private junctionAngle = 0; // accumulated branch turn (phrase)
  private glint = 0; // snare glint ripple charge
  // Material regime (section) — hue base, saturation, ring hardness.
  private regimeHueBase = 0;
  private regimeSat = 100;
  private regimeHardness = 0.4;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  /** Snap segment texture to a new genome value on a bar crossing. */
  private snapSegment(barKey: number): void {
    this.segFreq = 4 + Math.round(hash(barKey, 1) * 10); // 4..14 ridges
    this.segPhase = hash(barKey, 2) * Math.PI * 2;
  }

  /** Junction: rotate the travel axis by a stepped angle (hard turn). */
  private snapJunction(phraseKey: number): void {
    const turn = (hash(phraseKey, 3) - 0.5) * (Math.PI / 2); // +/- 45 deg
    this.junctionAngle += turn;
  }

  /** Material regime change: palette + hardness swap wholesale. */
  private snapRegime(sectionKey: number): void {
    this.regimeHueBase = hash(sectionKey, 4) * 300; // avoid pinned red span
    this.regimeSat = 70 + Math.round(hash(sectionKey, 5) * 30); // 70..100
    this.regimeHardness = 0.25 + hash(sectionKey, 6) * 0.7; // 0.25..0.95
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const bufferCtx = this.ensureBuffer(width, height);
    const { low, mid, high } = frame.bands;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);

    // Smoothed drop drive — continuous-rush floor rides max(drop, energy)
    // so it holds through a drop plateau.
    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-frame.dt / 0.35));

    // --- Grid tiers, quantized hard (no phase interpolation) ------------
    let beatKey = Number.NaN;
    let barKey = Number.NaN;
    let phraseKey = Number.NaN;
    let sectionKey = Number.NaN;
    if (frame.beat) {
      const bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
      beatKey = bar * frame.beat.beatsPerBar + frame.beat.beatInBar;
      barKey = bar;
      phraseKey = Math.floor(bar / BARS_PER_PHRASE);
      sectionKey = Math.floor(bar / BARS_PER_SECTION);
    } else {
      // No grid: a steady heartbeat + derived tiers keep the grammar alive.
      this.fallbackClock += frame.dt;
      beatKey = Math.floor(this.fallbackClock / 0.5);
      barKey = Math.floor(beatKey / 4);
      phraseKey = Math.floor(barKey / BARS_PER_PHRASE);
      sectionKey = Math.floor(barKey / BARS_PER_SECTION);
    }

    // Initialize genome on first frame so nothing is undefined visually.
    if (Number.isNaN(this.lastBarKey) && Number.isFinite(barKey)) {
      this.snapSegment(barKey);
      this.snapRegime(sectionKey);
    }

    // SECTION crossing -> material regime change (biggest theatre).
    if (sectionKey !== this.lastSectionKey && Number.isFinite(sectionKey)) {
      this.lastSectionKey = sectionKey;
      this.snapRegime(sectionKey);
    }
    // PHRASE crossing -> junction branch turn (hard geometry cut).
    if (phraseKey !== this.lastPhraseKey && Number.isFinite(phraseKey)) {
      this.lastPhraseKey = phraseKey;
      this.snapJunction(phraseKey);
    }
    // BAR crossing -> new wall-pattern segment snaps in.
    if (barKey !== this.lastBarKey && Number.isFinite(barKey)) {
      this.lastBarKey = barKey;
      this.snapSegment(barKey);
    }
    // BEAT crossing -> the lurch FIRES (fresh reach charged for this beat).
    if (beatKey !== this.lastBeatKey && Number.isFinite(beatKey)) {
      this.lastBeatKey = beatKey;
      this.lurch = 1;
    }

    // --- Lurch envelope: eased snap that decays to near-still -----------
    // Buildups make lurches hungrier: excitement lengthens the reach and
    // slows the decay so the snap peaks later and harder.
    const excite = frame.trend.excitement;
    const decayTau = 0.14 + 0.12 * excite;
    this.lurch *= Math.exp(-frame.dt / decayTau);
    // Eased shape of the current lurch (smoothstep for a snap, not a ramp).
    const lurchShape = smooth(this.lurch);
    // Reach: how far a single lurch throws you (hungrier on buildup).
    const reach = 4.0 + 5.0 * excite;

    // --- Locomotion: kick IS the lurch ----------------------------------
    // Base zoom is near-still between beats; the lurch (charged on the beat,
    // driven by the kick transient) slams it forward. Drop lifts a
    // continuous-rush floor so the quantized gaps fill in.
    const kick = frame.impulse.low;
    const rushFloor = 1.9 * this.drive * this.drive; // continuous rush on drops
    const idle = 0.06; // never fully frozen (avoids a dead frame)
    const lurchDrive = frame.params.lurch ?? 1;
    const travel =
      idle +
      (reach * lurchShape * (0.4 + 0.9 * kick + 0.5 * low)) * lurchDrive +
      rushFloor;

    // --- Warp the previous frame in -------------------------------------
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      const zoom = 1 + travel * frame.dt;
      // The junction turn snaps the travel axis; between phrases the axis is
      // held (a stepped rotation, not a continuous spin), with a tiny mid
      // drift for life.
      const targetRot = this.junctionAngle;
      this.rotation += (targetRot - this.rotation) * (1 - Math.exp(-frame.dt / 0.12));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      const trail = frame.params.trail ?? 0.9;
      ctx.globalAlpha = 0.9 + 0.09 * trail;
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // --- Material regime palette (section) ------------------------------
    ctx.globalCompositeOperation = 'lighter';
    const energy = energyOf(frame.bands);
    const hardness = this.regimeHardness;
    const hue = energyHue(energy, frame.time * 5 + this.regimeHueBase);
    const sat = this.regimeSat;

    // --- Fresh geometry: segment-textured wall ring ---------------------
    const radius = unit * (0.1 + 0.15 * low);
    // Wall corrugation frequency/phase is the current bar's genome segment;
    // the lurch momentarily deepens the wobble (the walls flex on the snap).
    const wobble = unit * (0.012 + 0.03 * mid) * (0.6 + 0.8 * lurchShape);
    ctx.beginPath();
    const segments = 96;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const ridge = 4 + hardness * 4;
      const seg = Math.sin(angle * this.segFreq + this.segPhase) * wobble;
      const base = Math.sin(angle * ridge + frame.time * (2 + 2 * hardness)) * wobble * 0.5;
      const r = radius + seg + base;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    // Ring lightness: soft-knee ceiling (chroma preserved), kicked on the
    // lurch (localized pulse, photosafe), harder in harder regimes.
    const wallL = 40 + 26 * low + 18 * hardness * lurchShape * kick;
    ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${Math.min(84, wallL)}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.003 + lerp(0.016, 0.007, hardness) + 0.012 * lurchShape * low));
    ctx.stroke();

    // --- SNARE = wall glint ripple --------------------------------------
    // Mid impulse lights a travelling glint band on the wall (a bright
    // secondary ring that pops on the snare, localized -> photosafe).
    this.glint = Math.max(this.glint * Math.exp(-frame.dt / 0.18), frame.impulse.mid);
    if (this.glint > 0.05) {
      const gr = radius * (1.15 + 0.25 * (1 - this.glint));
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.strokeStyle = `hsl(${(hue + 40) % 360}, ${sat}%, ${Math.min(85, 45 + 35 * this.glint)}%)`;
      ctx.lineWidth = Math.max(1.5, unit * 0.005 * this.glint);
      ctx.stroke();
    }

    // --- Junction kink marker (phrase) ----------------------------------
    // A brief bright chord across the mouth right after a turn, so the hard
    // cut reads as a branch, not a glitch. Localized, decays fast.
    if (Number.isFinite(phraseKey)) {
      // Fade a marker for ~one beat after the phrase crossing using lurch as
      // a proxy timer (fires on the phrase's downbeat lurch).
      const justTurned = this.lastPhraseKey === phraseKey;
      if (justTurned && this.lurch > 0.4 && frame.beat && frame.beat.beatInBar === 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.rotation);
        ctx.beginPath();
        ctx.moveTo(-radius * 1.3, 0);
        ctx.lineTo(radius * 1.3, 0);
        ctx.strokeStyle = `hsl(${(hue + 180) % 360}, ${sat}%, ${Math.min(80, 40 + 30 * lurchShape)}%)`;
        ctx.lineWidth = Math.max(1.5, unit * 0.004 * lurchShape);
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- High-driven sparkle stipple (feedback filigree) ----------------
    // Gated by high content (mid/high effect, not kick powder); busier in
    // noisier regimes and on the continuous rush.
    const density = 1 + 0.8 * hardness + 0.7 * this.drive;
    const wanted = SPARKS_PER_S * density * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.0032 * Math.random());
      ctx.fillStyle = `hsl(${(hue + 150 + Math.random() * 60) % 360}, ${Math.max(60, sat)}%, 76%)`;
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
  id: 'g08-tunnel-beat',
  name: 'g08 tunnel-beat',
  params: [
    { id: 'lurch', label: 'lurch reach', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.9 },
  ],
  create: () => new TunnelBeatRenderer(),
};

export default candidate;
