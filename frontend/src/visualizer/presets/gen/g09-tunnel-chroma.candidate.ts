/**
 * g09-tunnel-chroma (gen-9 TWEAK of g02-tunnel-dream — spectrally-informed
 * palettes). The Milkdrop-style Canvas-2D warp-feedback tunnel of the parent
 * (offscreen copy zoomed + twisted in each frame, fresh geometry stamped on
 * top, dreamy long trails), re-wired so DEPTH = FREQUENCY: the tunnel is a
 * journey through the spectrum.
 *
 *   DEPTH = FREQUENCY. The 24-band spectrum is laid out along the tunnel:
 *   band 0 (lows) sits NEAREST the mouth, band 23 (highs) at the vanishing
 *   point. Each band paints one wall ring at its depth, and the ring's hue
 *   walks ONE FULL hue-wheel turn from mouth (lows) to vanishing point
 *   (highs) — the whole spectrum reads as colored rings receding into the
 *   dark.
 *
 *   LOUDNESS = SATURATION + GLOW. A band's level drives its ring's
 *   saturation and lightness/line-weight (its glow). A quiet band is a faint
 *   desaturated hoop; a loud band is a vivid glowing ring.
 *
 *   EQ KILL = GRAY DEAD ZONE. The dominant audible deck's EQ knobs gate the
 *   low/mid/high thirds of the spectrum: killing a band region drains those
 *   rings' saturation toward gray — a visible dead zone you fly through.
 *
 *   KICK = DEPTH-WARD LUMINANCE PULSE. A kick launches a bright band of
 *   luminance that races from the mouth toward the vanishing point through
 *   all rings (color stays; only brightness pulses). Structural, on a smooth
 *   envelope — no full-field flash.
 *
 *   DROP = EVERY DEPTH SATURATES, riding max(drop, energy) under the
 *   contraction rule (the feedback trail alpha stays < 1; drama lives in the
 *   fresh geometry's saturation, not a persistent-field multiply).
 *
 * SHARED SPECTRAL VOCAB (gen-9): a slow ~1 s centroid EMA + spread give the
 * palette a global hue center/span drift so the wheel itself rotates with
 * the music over phrases (not per-frame flicker).
 *
 * Canvas 2D like the parent: warp composites onto black, geometry uses
 * `lighter` (a soft-knee ceiling on lightness, never a per-channel clamp);
 * lightness ceilings keep chroma. Photosafe: rings are structural markers on
 * smooth envelopes; the kick pulse is a localized moving band, never a
 * saturated-red full-field strobe.
 */

import { energyOf } from '../../style';
import { SPECTRUM_BAND_COUNT } from '../../channel';
import type { DeckStateInfo } from '../../channel';
import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Dominant audible deck (highest master-audible level) — its EQ knobs gate
 * the spectrum thirds for the dead-zone effect. */
function dominantDeck(decks: DeckStateInfo[]): DeckStateInfo | null {
  let best: DeckStateInfo | null = null;
  for (const d of decks) {
    if (!d.playing) continue;
    if (!best || d.level > best.level) best = d;
  }
  return best;
}

/** EQ knob (0..1, 0.5 = flat) -> a saturation gate. 0.5 flat = full; a kill
 * (knob toward 0) drains toward gray; a boost lifts a touch. */
function eqGate(knob: number): number {
  // 0 -> 0.08 (near-gray dead zone), 0.5 -> 1.0, 1 -> 1.15.
  if (knob <= 0.5) return lerp(0.08, 1.0, clamp01(knob / 0.5));
  return lerp(1.0, 1.15, clamp01((knob - 0.5) / 0.5));
}

class TunnelChromaRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;

  /** Smoothed per-band levels (attack fast, release slow) so rings glow and
   * fade rather than strobe. */
  private bandLevel: number[] = new Array(SPECTRUM_BAND_COUNT).fill(0);
  /** Smoothed drop/energy drive for the global saturation ceiling (~0.35 s). */
  private drive = 0;
  /** Slow centroid EMA (~1 s) — global hue-wheel rotation. */
  private hueCenter = 0.5;
  /** Smoothed spread — hue-span breadth. */
  private hueSpan = 0.5;
  /** Kick luminance-pulse position in depth [0..1], -1 when inactive. */
  private kickPulseDepth = -1;
  /** Kick pulse strength (fades as it travels). */
  private kickPulseAmp = 0;
  /** Smoothed EQ region gates (low/mid/high) so kills ease, not pop. */
  private eqLow = 1;
  private eqMid = 1;
  private eqHigh = 1;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
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
    const dt = frame.dt;

    // --- Global drives ---------------------------------------------------
    // Sustained states ride max(drop, energy) so a drop plateau stays lit.
    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-dt / 0.35));

    // Slow centroid EMA rotates the hue wheel; spread widens the span. Both
    // slow so the palette drifts across phrases, never flickers per frame.
    this.hueCenter += (clamp01(frame.centroid) - this.hueCenter) * (1 - Math.exp(-dt / 1.0));
    this.hueSpan += (clamp01(frame.spread) - this.hueSpan) * (1 - Math.exp(-dt / 0.6));

    // Smoothed per-band levels (fast attack, slow release).
    const n = Math.min(SPECTRUM_BAND_COUNT, frame.spectrum.length);
    for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) {
      const target = i < n ? clamp01(frame.spectrum[i] ?? 0) : 0;
      const tau = target > this.bandLevel[i] ? 0.05 : 0.18;
      this.bandLevel[i] += (target - this.bandLevel[i]) * (1 - Math.exp(-dt / tau));
    }

    // EQ kill gates from the dominant audible deck (eased).
    const dom = dominantDeck(frame.decks);
    const tgtLow = eqGate(dom?.eq.low ?? 0.5);
    const tgtMid = eqGate(dom?.eq.mid ?? 0.5);
    const tgtHigh = eqGate(dom?.eq.high ?? 0.5);
    const eqAlpha = 1 - Math.exp(-dt / 0.12);
    this.eqLow += (tgtLow - this.eqLow) * eqAlpha;
    this.eqMid += (tgtMid - this.eqMid) * eqAlpha;
    this.eqHigh += (tgtHigh - this.eqHigh) * eqAlpha;

    // --- Warp the previous frame in (the tunnel travel) ------------------
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    let zoom = 1;
    if (this.buffer && bufferCtx) {
      // Kick lunge (parent grammar): the transient throws you forward.
      const zoomAmount = frame.params.zoom ?? 0.65;
      zoom = 1 + (0.3 + 1.4 * low * low + 3.5 * frame.impulse.low) * zoomAmount * dt;
      this.rotation = (0.1 + 1.2 * mid + 1.8 * frame.impulse.mid) * dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      // CONTRACTION RULE: trail alpha stays < 1 (persistent field never
      // multiplied by a sustained factor > 1).
      ctx.globalAlpha = Math.min(0.99, 0.9 + 0.095 * (frame.params.trail ?? 0.92));
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // --- Kick = depth-ward luminance pulse -------------------------------
    // A kick launches a bright band that races from the mouth (depth 0)
    // toward the vanishing point (depth 1). Color stays; only luminance
    // pulses. Localized moving band — photosafe.
    if (frame.impulse.low > 0.32 && this.kickPulseDepth < 0) {
      this.kickPulseDepth = 0;
      this.kickPulseAmp = clamp01(frame.impulse.low);
    }
    if (this.kickPulseDepth >= 0) {
      this.kickPulseDepth += dt * 2.2; // races depth-ward (~0.45 s traverse)
      this.kickPulseAmp *= Math.exp(-dt / 0.5);
      if (this.kickPulseDepth > 1.05 || this.kickPulseAmp < 0.02) {
        this.kickPulseDepth = -1;
        this.kickPulseAmp = 0;
      }
    }

    // --- The spectral rings: DEPTH = FREQUENCY ---------------------------
    // band 0 (lows) nearest the mouth (large radius), band 23 (highs) at the
    // vanishing point (small radius). Hue walks one full wheel over depth,
    // offset by the slow centroid center. Loudness = saturation + glow. EQ
    // kill drains a region's saturation. Drop saturates everything.
    ctx.globalCompositeOperation = 'lighter';
    const bands = SPECTRUM_BAND_COUNT;
    // Mouth radius (lows) large; vanishing radius (highs) small.
    const rMouth = unit * 0.34;
    const rVanish = unit * 0.03;
    const wobble = unit * 0.02 * (0.4 + 0.6 * mid);
    // Global saturation lift on drops (fresh geometry only — bounded, not a
    // persistent-field multiply).
    const dropSat = 0.15 * this.drive;

    for (let b = 0; b < bands; b++) {
      const depth = b / (bands - 1); // 0 = lows/mouth, 1 = highs/vanish
      // Perspective: rings crowd toward the vanishing point (ease the radius
      // so the receding row reads as depth, not linear spacing).
      const persp = depth * depth * (3 - 2 * depth); // smoothstep
      const radius = lerp(rMouth, rVanish, persp);
      if (radius < 1) continue;

      const level = this.bandLevel[b];

      // Hue: one full wheel over depth, rotated by the slow centroid center,
      // span widened by spread so wide sounds show more of the wheel.
      const span = 0.6 + 0.4 * this.hueSpan; // 0.6 .. 1.0 turns of the wheel
      const hueDeg = ((this.hueCenter + depth * span) % 1) * 360;

      // EQ region gate: which third of the spectrum this band lives in.
      const eqGateVal = depth < 0.34 ? this.eqLow : depth < 0.67 ? this.eqMid : this.eqHigh;

      // Loudness = saturation. Quiet -> desaturated; loud -> vivid. EQ kill
      // drains toward gray. Drop lifts everything. Chroma-preserving: we vary
      // HSL saturation, never clamp channels.
      const sat = Math.round(
        100 * clamp01((0.22 + 0.78 * level + dropSat) * eqGateVal)
      );

      // Glow = loudness -> lightness + line weight (soft-knee ceiling).
      const baseL = 30 + 34 * level + 6 * this.drive;
      // Kick pulse: a moving luminance band brightens rings near its depth.
      let pulseL = 0;
      if (this.kickPulseDepth >= 0) {
        const d = Math.abs(depth - this.kickPulseDepth);
        pulseL = Math.exp(-(d * d) * 90) * this.kickPulseAmp * 34;
      }
      const lightness = Math.min(82, baseL + pulseL); // soft ceiling, no clamp

      // Wall wobble: bass corrugation on the ring (smeared into walls by
      // feedback). Slight fine detail from highs on the far rings.
      const wob = wobble * (0.5 + 0.5 * level) * (1 - 0.5 * persp);
      const fineFreq = 4 + Math.round(8 * high);

      ctx.beginPath();
      const segs = 56;
      for (let i = 0; i <= segs; i++) {
        const angle = (i / segs) * Math.PI * 2;
        const rr =
          radius +
          Math.sin(angle * 4 + frame.time * (2 + 3 * low)) * wob +
          Math.sin(angle * fineFreq + frame.time * 4) * wob * 0.3;
        const x = cx + Math.cos(angle) * rr;
        const y = cy + Math.sin(angle) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsl(${hueDeg}, ${sat}%, ${lightness}%)`;
      // Near rings (lows) thick, far rings (highs) thin; loud rings glow wider.
      ctx.lineWidth = Math.max(1, unit * (0.0015 + 0.006 * (1 - persp) + 0.006 * level));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';

    // Snapshot this frame for the next warp.
    if (bufferCtx && this.buffer) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(ctx.canvas, 0, 0);
    }
  }
}

const candidate: VisualizerPreset = {
  id: 'g09-tunnel-chroma',
  name: 'g09 tunnel-chroma',
  params: [
    // Parent dreamy defaults (long trails, gentle zoom) kept.
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.92 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: 0.65 },
  ],
  create: () => new TunnelChromaRenderer(),
};

export default candidate;
