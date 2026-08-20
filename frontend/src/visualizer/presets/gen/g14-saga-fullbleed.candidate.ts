/**
 * g14-saga-fullbleed (gen-14 tweak of g04-tunnel-saga: class bugfix + glare
 * trim + conic ring flow).
 *
 * Human notes in play (tunnel-class siblings): "there is a bug in tunnel
 * class--outer ring is smaller than viewport, so i can sometimes see past
 * edges of rectangle to the black bg", "could be a little less white", and
 * the family-wide "more dynamic in color" wish.
 *
 * Three execution changes; the chapter engine is the parent's, untouched:
 *
 * 1. FULLBLEED (the class bug): warping the previous frame with a rotation
 *    exposes the buffer's corners — the rotated rectangle no longer covers
 *    the viewport, so black leaks in and gets zoomed toward the center as a
 *    visible box. Fix: scale the feedback draw by the exact cover factor
 *    cos|θ| + (long/short)·sin|θ| (θ = this frame's rotation) so the
 *    rotated buffer always covers the frame. No visible border, ever.
 * 2. LESS WHITE: ring lightness capped ~72% (was 85), sparkles 65% (was
 *    75), punch inner ring 68% (was 80). Saturation stays 100% — the hue
 *    does the work, not white glare.
 * 3. CONIC RING FLOW: the tunnel-mouth ring is stroked in 10 segments, each
 *    offset along a ~70° hue span that slowly rotates around the mouth
 *    (flow rate rides bandsSlow.mid — motion smoothness law). The feedback
 *    smears the multi-hue mouth into the walls: no more monochrome throat.
 *
 * Parent doc (all still true): the tunnel's CHARACTER evolves across every
 * 16-bar section — chapter 0 = dream (long trails, gentle zoom, soft
 * rings, cool palette), chapter 1 = punch (short trails, hard zoom, sharp
 * rings, hot palette). Bars 1-8 dream, 9-15 tighten, 16 punch; drops shove
 * to full punch; buildups accelerate the climb; gridless falls back to an
 * energy/drop drive. Photosensitivity floor respected — localized ring
 * pulses and streaks only, never saturated-red strobing.
 */

import { energyHue, energyOf } from '../../style';
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
const SPARKS_PER_S = 200;
const RING_SEGMENTS = 10;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

class SagaFullbleedRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;
  /** Smoothed chapter position (continuous journey, not a step). */
  private chapter = 0;
  /** Smoothed drop/energy drive (regime smoothing, ~0.35 s per taste). */
  private drive = 0;
  /** Conic hue-flow phase around the mouth — rate rides bandsSlow.mid. */
  private hueFlow = 0;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  /** Section-arc chapter target (parent, verbatim). */
  private chapterTarget(frame: VisualizerFrameData): number {
    const { trend, bands } = frame;
    const energy = energyOf(bands);
    const intensity = Math.max(trend.excitement, energy);

    let arc: number;
    if (frame.beat) {
      const barInSection =
        ((frame.beat.barIndex % BARS_PER_SECTION) + BARS_PER_SECTION) %
        BARS_PER_SECTION;
      const pos = (barInSection + frame.beat.barPhase) / BARS_PER_SECTION;
      arc = pos < 0.5 ? pos * 0.4 : 0.2 + smooth((pos - 0.5) * 2) * 0.8;
    } else {
      const cycle = (frame.time % 24) / 24;
      arc = smooth(cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
    }

    const accelerated = arc * (1 + 1.1 * trend.excitement);
    const target = Math.max(accelerated, intensity * intensity);
    return clamp01(target);
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

    const chapterTarget = this.chapterTarget(frame);
    const chapterAlpha = 1 - Math.exp(-frame.dt / 0.5);
    this.chapter += (chapterTarget - this.chapter) * chapterAlpha;
    const chapter = this.chapter;

    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-frame.dt / 0.35));

    // Conic hue flow: rate rides SLOW mids (motion smoothness law).
    this.hueFlow += frame.dt * (8 + 55 * slow.mid); // degrees/s

    const dreamTrail = frame.params.dreamTrail ?? DREAM_TRAIL;
    const punchZoom = frame.params.punchZoom ?? PUNCH_ZOOM;
    const hueSpan = frame.params.hueSpan ?? 70;
    const trail = lerp(dreamTrail, PUNCH_TRAIL, chapter);
    const zoomDrive = lerp(DREAM_ZOOM, punchZoom, chapter);
    const hardness = chapter;

    // Warp the previous frame in (chroma preserved — composite onto black).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      const kick = frame.impulse.low;
      // motion: slow bands (erratic-motion law)
      const zoom =
        1 +
        (0.28 + 1.4 * slow.low * slow.low + (2.6 + 2.4 * hardness) * kick) *
          zoomDrive *
          frame.dt;
      // motion: slow bands (erratic-motion law)
      this.rotation =
        (0.08 + (0.9 + 0.9 * hardness) * slow.mid + (1.4 + 1.4 * hardness) * frame.impulse.mid) *
        frame.dt;
      // FULLBLEED: the exact scale at which a rectangle rotated by θ still
      // covers its own axis-aligned frame — cos|θ| + (long/short)·sin|θ|.
      // Applied as a floor on the zoom so rotation never exposes corners.
      const a = Math.abs(this.rotation);
      const ratio = Math.max(width, height) / Math.min(width, height);
      const coverScale = Math.cos(a) + ratio * Math.sin(a);
      const effectiveZoom = Math.max(zoom, coverScale * 1.001);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.globalAlpha = 0.88 + 0.11 * trail;
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Fresh geometry: the wobbling ring, now stroked in RING_SEGMENTS conic
    // segments, each with its own hue along a rotating span — the feedback
    // smears a multi-hue throat instead of a monochrome one.
    ctx.globalCompositeOperation = 'lighter';
    const energy = energyOf(frame.bands);
    const hueOffset = lerp(60, -30, chapter);
    const hue = energyHue(energy, frame.time * 6 + hueOffset);
    const radius = unit * (0.1 + 0.16 * low);
    const wobble = unit * (0.008 + 0.03 * (1 - hardness)) * mid;
    const ripple = 6 + 4 * hardness;
    const wobbleRate = 3 + 2 * hardness;
    // LESS WHITE: lightness capped at 72% (was 85) — hue does the work.
    const lightness = Math.min(72, 40 + 26 * low + 14 * hardness * frame.impulse.low);
    const segArc = (Math.PI * 2) / RING_SEGMENTS;
    const steps = 8; // polyline steps per segment
    ctx.lineWidth = Math.max(2, unit * (0.003 + lerp(0.016, 0.008, hardness) + 0.01 * low));
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const segHue =
        (hue + this.hueFlow + (s / RING_SEGMENTS) * hueSpan) % 360;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const angle = s * segArc + (i / steps) * segArc;
        const r = radius + Math.sin(angle * ripple + frame.time * wobbleRate) * wobble;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsl(${segHue}, 100%, ${lightness}%)`;
      ctx.stroke();
    }

    // Punch inner ring (localized pulse — photosensitivity-exempt).
    if (hardness > 0.55) {
      const inner = radius * 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      // LESS WHITE: capped at 68% (was 80).
      ctx.strokeStyle = `hsl(${(hue + this.hueFlow + 30) % 360}, 100%, ${Math.min(68, 50 + 18 * frame.impulse.low)}%)`;
      ctx.lineWidth = Math.max(1.5, unit * 0.004 * hardness);
      ctx.stroke();
    }

    // High-driven sparkles smeared into star-streaks by the feedback.
    // LESS WHITE: 65% lightness (was 75), saturation stays 100.
    const density = 1 + 0.8 * hardness + 0.6 * this.drive;
    const wanted = SPARKS_PER_S * density * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.0035 * Math.random());
      ctx.fillStyle = `hsl(${(hue + this.hueFlow + 180 + Math.random() * 40) % 360}, 100%, 65%)`;
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
  id: 'g14-saga-fullbleed',
  name: 'g14 saga-fullbleed',
  params: [
    { id: 'dreamTrail', label: 'dream trail', min: 0, max: 1, step: 0.02, default: DREAM_TRAIL },
    { id: 'punchZoom', label: 'punch zoom', min: 0.3, max: 2.5, step: 0.05, default: PUNCH_ZOOM },
    { id: 'hueSpan', label: 'ring hue span', min: 0, max: 180, step: 5, default: 70 },
  ],
  create: () => new SagaFullbleedRenderer(),
};

export default candidate;
