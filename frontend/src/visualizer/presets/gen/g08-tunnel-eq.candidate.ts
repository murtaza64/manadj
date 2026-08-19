/**
 * g08-tunnel-eq (tweak of g02-tunnel-dream, raiding g04-tunnel-saga).
 *
 * A tunnel wired as a THREE-KNOB EQ instrument: each band owns ONE
 * independently-legible property, so you can read the mix off the screen.
 *
 *   LOWS  = tunnel GEOMETRY. Bass kill -> a wide, slow, calm tube (the
 *           parent's dreamy drift). Heavy bass -> a tight, fast,
 *           clenching throat: diameter shrinks, travel speed climbs, the
 *           wall undulation depth (the ring wobble that the feedback
 *           smears into corrugated walls) deepens. Kick = a lunge on top.
 *   MIDS  = wall COLOR. Mid content drives palette warmth/saturation:
 *           mid kill -> desaturated, ghostly walls; heavy mids -> hot,
 *           fully-saturated color. Hue travels (energy sweep + spatial
 *           drift) so the walls never go monochrome.
 *   HIGHS = wall TEXTURE detail. High kill -> smooth, dreamy walls (the
 *           parent's soft dreaminess is the low-high STATE, not a default).
 *           Heavy highs -> fine engraving: dense sparkle stipple + a
 *           high-frequency ripple carved into the ring, smeared to
 *           filigree by the feedback.
 *
 * BEAT = a RUNWAY of ring lights. One lit ring is dropped at the tunnel
 * mouth on each beat and rides the feedback zoom away down the tunnel, so
 * the row of receding lights reads the bar position like landing-strip
 * markers. The downbeat ring is brighter/bigger; the current ring FLARES
 * on the kick. Drop = every ring lit + max travel speed on max(drop,
 * energy). Ring placement is quantized hard to the grid (ladderBarIndex ??
 * barIndex + beatInBar) so lights never interpolate onto the beat.
 *
 * Canvas 2D, feedback-buffer engine identical in spirit to the parent
 * tunnel (offscreen copy warped in, fresh geometry stamped on top). Chroma
 * is preserved: the warp composites onto black and geometry uses `lighter`
 * (a soft-knee ceiling on lightness, never a per-channel clamp). Photo-
 * safety: ring lights are STRUCTURAL runway markers on smooth envelopes,
 * no full-field flash; localized ring/kick pulses are exempt, never
 * saturated red.
 */

import { energyHue, energyOf } from '../../style';
import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const SPARKS_PER_S = 220;
/** Ring lights currently riding the tunnel (runway depth). */
const MAX_RINGS = 24;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** One ring light launched at the tunnel mouth on a beat, then swept away
 * by the feedback zoom. `age` grows each frame; `depth` in [0,1] is how far
 * down the tunnel it has receded (fades out as it reaches the vanishing
 * point). */
interface RingLight {
  /** 0 = downbeat (brighter/bigger), else the beat ordinal within the bar. */
  beatInBar: number;
  /** Kick flare charge on this ring, decays over time. */
  flare: number;
  /** Normalized recede depth, 0 (at the mouth) .. 1 (vanished). */
  depth: number;
}

class TunnelEqRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;

  /** The runway of receding ring lights (newest at the mouth). */
  private rings: RingLight[] = [];
  /** Last integer beat we launched a ring on (grid-quantized, no interp). */
  private lastBeatKey = Number.NaN;
  /** Smoothed drop/energy drive for the intensity ceiling (~0.35 s). */
  private drive = 0;
  /** Time carrier for the fallback beat when there is no grid. */
  private fallbackBeatClock = 0;

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

    // Smoothed drop drive — sustained states ride max(drop, energy) so they
    // hold across a drop plateau (excitement alone fades on the plateau).
    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-frame.dt / 0.35));

    // --- LOWS = GEOMETRY -------------------------------------------------
    // Bass kill: wide, slow, calm. Heavy bass: tight, fast, clenching.
    const geomZoomDrive = frame.params.geomDrive ?? 1;
    // Diameter shrinks with bass (throat clench); high-drop keeps it moving.
    const diameter = lerp(0.22, 0.085, clamp01(low)); // fraction of unit
    // Travel speed climbs with bass squared + the kick lunge + the drop.
    const kick = frame.impulse.low;
    const speed =
      0.28 +
      1.5 * low * low +
      3.4 * kick +
      1.3 * this.drive; // drop/energy floor keeps the rush alive
    // Undulation depth: how deep the wall corrugation runs (bass clenches).
    const undulation = unit * (0.006 + 0.05 * low);

    // --- Warp the previous frame in (the tunnel travel) ------------------
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      const zoom = 1 + speed * geomZoomDrive * frame.dt;
      // Rotation is a gentle geometry drift (mid-independent — mids own
      // color now, not spin), nudged by the kick.
      this.rotation = (0.09 + 0.6 * low + 1.2 * kick) * frame.dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      // Trail length: dreamy long feedback (slider-tunable). Kept high so
      // the runway lights streak into a receding row.
      const trail = frame.params.trail ?? 0.9;
      ctx.globalAlpha = 0.9 + 0.09 * trail;
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;

      // Advance every ring light down the tunnel by the same zoom that
      // warped the frame, so the drawn rings ride the corrugation exactly.
      for (const ring of this.rings) {
        ring.depth = clamp01(ring.depth + (zoom - 1) * 3.2 + 0.015);
        ring.flare *= Math.exp(-frame.dt / 0.18);
      }
      this.rings = this.rings.filter((r) => r.depth < 0.995);
      if (this.rings.length > MAX_RINGS) this.rings.length = MAX_RINGS;
    }

    // --- MIDS = COLOR ----------------------------------------------------
    // Palette warmth + saturation track mid content. Hue travels with the
    // energy sweep and a spatial/time drift so walls never go monochrome.
    const colorDrive = frame.params.colorDrive ?? 1;
    const midAmt = clamp01(mid * colorDrive);
    const energy = energyOf(frame.bands);
    // Mid content pushes the hue warm (blue -> magenta/amber) on top of the
    // energy sweep; kept off saturated red by the offset span.
    const hue = energyHue(energy, frame.time * 6 + lerp(40, -20, midAmt));
    // Saturation IS the mid legibility: mid kill -> ghostly desaturated.
    const sat = Math.round(lerp(18, 100, midAmt));

    // --- HIGHS = TEXTURE -------------------------------------------------
    // High kill -> smooth dreamy walls; heavy highs -> fine engraving.
    const texDrive = frame.params.texDrive ?? 1;
    const highAmt = clamp01(high * texDrive);

    // --- Fresh geometry: the wall ring at the tunnel mouth ---------------
    ctx.globalCompositeOperation = 'lighter';
    const radius = unit * diameter;
    ctx.beginPath();
    const segments = 96;
    // Texture carves a high-frequency ripple into the ring; smooth base
    // undulation is bass-owned, the fine engraving is high-owned.
    const fineFreq = 6 + Math.round(30 * highAmt);
    const fineDepth = undulation * (0.15 + 0.85 * highAmt);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const baseWave = Math.sin(angle * 4 + frame.time * (2 + 3 * low)) * undulation;
      const engrave = Math.sin(angle * fineFreq + frame.time * 5) * fineDepth;
      const r = radius + baseWave + engrave;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    // Soft-knee lightness ceiling (never a hard per-channel clamp — chroma
    // preserved through the feedback tunnel).
    const wallL = 40 + 30 * low + 8 * this.drive;
    ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${Math.min(82, wallL)}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.004 + 0.014 * low));
    ctx.stroke();

    // --- BEAT = runway ring lights --------------------------------------
    // Launch one lit ring at the mouth on each beat, quantized HARD to the
    // grid so lights never interpolate onto the beat.
    let beatInBar = 0;
    let beatKey = Number.NaN;
    const allLit = this.drive > 0.62 ? 1 : 0; // drops light the whole runway
    if (frame.beat) {
      const bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
      beatInBar = frame.beat.beatInBar;
      // (bar, beatInBar) is the unique integer beat address — no phase.
      beatKey = bar * frame.beat.beatsPerBar + beatInBar;
    } else {
      // No grid: a steady ~2 Hz fallback pulse keeps the runway alive.
      this.fallbackBeatClock += frame.dt;
      const period = 0.5;
      beatKey = Math.floor(this.fallbackBeatClock / period);
      beatInBar = ((beatKey % 4) + 4) % 4;
    }
    if (beatKey !== this.lastBeatKey && Number.isFinite(beatKey)) {
      this.lastBeatKey = beatKey;
      this.rings.unshift({ beatInBar, flare: 1, depth: 0 });
      if (this.rings.length > MAX_RINGS) this.rings.length = MAX_RINGS;
    }

    // Draw the receding runway. Each ring shrinks toward the vanishing
    // point along the same corrugation; the current (newest) ring flares on
    // the kick; the downbeat ring is brighter/bigger. Structural markers on
    // smooth envelopes — no full-field flash.
    for (let idx = 0; idx < this.rings.length; idx++) {
      const ring = this.rings[idx];
      const recede = 1 - ring.depth; // 1 at mouth -> 0 at vanish
      const rr = radius * (0.55 + 0.95 * recede);
      const fade = recede * recede; // dim as it recedes
      const isDown = ring.beatInBar === 0;
      const flareBoost = idx === 0 ? ring.flare * frame.impulse.low : 0;
      const ringL =
        (isDown ? 58 : 44) * fade + 26 * flareBoost + 10 * allLit;
      const ringSat = Math.round(lerp(30, 100, midAmt));
      const ringHue = (hue + (isDown ? 0 : 24)) % 360;
      ctx.strokeStyle = `hsl(${ringHue}, ${ringSat}%, ${Math.min(85, ringL)}%)`;
      ctx.lineWidth = Math.max(1, unit * (0.0025 + (isDown ? 0.006 : 0.0035) * fade + 0.004 * flareBoost));
      ctx.beginPath();
      const segs = 48;
      for (let i = 0; i <= segs; i++) {
        const angle = (i / segs) * Math.PI * 2;
        const wave = Math.sin(angle * 4 + frame.time * (2 + 3 * low)) * undulation * recede;
        const r = rr + wave;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // --- HIGHS = sparkle stipple (texture density) ----------------------
    // Fine engraving grain: high-gated (not kick powder), smeared into
    // filigree by the feedback. Density IS the high legibility.
    const density = highAmt;
    const wanted = SPARKS_PER_S * density * density * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.85 + Math.random() * 0.45);
      const size = unit * (0.0012 + 0.0028 * Math.random());
      ctx.fillStyle = `hsl(${(hue + 150 + Math.random() * 60) % 360}, ${Math.max(60, sat)}%, 78%)`;
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
  id: 'g08-tunnel-eq',
  name: 'g08 tunnel-eq',
  params: [
    // Per-knob gain so the EQ split can be dialed independently.
    { id: 'geomDrive', label: 'lows geometry', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'colorDrive', label: 'mids color', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'texDrive', label: 'highs texture', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.9 },
  ],
  create: () => new TunnelEqRenderer(),
};

export default candidate;
