/**
 * g04-tunnel-saga (combine: g02-tunnel-dream × g02-tunnel-punch).
 *
 * The parent tunnel, but its CHARACTER is no longer static — it EVOLVES
 * across every 16-bar section as a journey with chapters. A single scalar
 * `chapter` in [0, 1] blends the two surviving mutants continuously:
 *   0 = dream (long trails 0.92, gentle zoom 0.65, soft rings, cool palette)
 *   1 = punch (short trails 0.42, hard zoom 1.8, sharp rings, hot palette)
 *
 * The arc within a section (beat.barIndex mod 16):
 *   bars 1-8   : dream — floated, hypnotic, restrained.
 *   bars 9-15  : tightening — trails shorten, zoom sharpens, rings harden as
 *                the phrase climbs toward the climax.
 *   bar 16     : punch — climax character, maximal.
 *   drops      : shoved to full punch regardless of bar (trend.excitement +
 *                sustained energy override the bar curve).
 *   boundary   : release back toward dream as the next section opens.
 * Buildups ACCELERATE the transformation (excitement gains bar position),
 * so a rising buildup arrives at punch early and hard. Without a beat grid
 * it falls back to a pure energy/drop drive — never flat, never a loop.
 *
 * Canvas 2D, feedback-buffer engine identical in spirit to the parent
 * tunnel (offscreen copy warped in, fresh geometry stamped on top). Chroma
 * is preserved: the warp composites onto black and geometry uses `lighter`.
 * Photosensitivity floor respected — no full-field flash envelope, only the
 * localized ring pulse and streaks (exempt), rings never saturated red.
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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

class TunnelSagaRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;
  /** Smoothed chapter position — keeps the character from snapping across
   * frames / at bar-index wraps (the ride is continuous, not stepped). */
  private chapter = 0;
  /** Smoothed drop/energy drive (regime smoothing, ~0.35 s per taste). */
  private drive = 0;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  /**
   * Where in the section are we, as a raw 0..1 chapter target. Bars 1-8
   * hold near dream, 9-16 climb toward punch (climax on the last bar), with
   * the boundary snapping the curve back down. Drops and sustained energy
   * override upward; buildups let energy gain the bar position so the climb
   * arrives early.
   */
  private chapterTarget(frame: VisualizerFrameData): number {
    const { trend, bands } = frame;
    const energy = energyOf(bands);
    // Sustained intensity: excitement fades over a drop plateau, so ride
    // max(drop, energy) for a state that holds through the drop (taste).
    const intensity = Math.max(trend.excitement, energy);

    // Bar-position arc. Without a grid, fall back to a slow time cycle so
    // the journey still breathes.
    let arc: number;
    if (frame.beat) {
      const barInSection =
        ((frame.beat.barIndex % BARS_PER_SECTION) + BARS_PER_SECTION) %
        BARS_PER_SECTION;
      // Continuous bar position including sub-bar phase.
      const pos = (barInSection + frame.beat.barPhase) / BARS_PER_SECTION;
      // Dream floor over the first half, accelerating climb over the
      // second half toward a climax at the section's end.
      arc = pos < 0.5 ? pos * 0.4 : 0.2 + smooth((pos - 0.5) * 2) * 0.8;
    } else {
      const cycle = (frame.time % 24) / 24;
      arc = smooth(cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
    }

    // Buildups ACCELERATE the transformation: excitement multiplies the bar
    // position so a rising phrase reaches punch early and hard.
    const accelerated = arc * (1 + 1.1 * trend.excitement);
    // The climax/drop override — full punch when the music actually goes
    // hard, independent of the bar.
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

    // Advance the chapter toward its section-arc target. Fast enough to
    // feel a drop hit, slow enough to read as a journey, not a flicker.
    const chapterTarget = this.chapterTarget(frame);
    const chapterAlpha = 1 - Math.exp(-frame.dt / 0.5);
    this.chapter += (chapterTarget - this.chapter) * chapterAlpha;
    const chapter = this.chapter;

    // Smoothed drop drive for the intensity ceiling (regime smoothing).
    const driveTarget = Math.max(frame.trend.excitement, energyOf(frame.bands));
    this.drive += (driveTarget - this.drive) * (1 - Math.exp(-frame.dt / 0.35));

    // Character params interpolated continuously between the two mutants.
    // Endpoints are slider-tunable (fall back to the mutant defaults).
    const dreamTrail = frame.params.dreamTrail ?? DREAM_TRAIL;
    const punchZoom = frame.params.punchZoom ?? PUNCH_ZOOM;
    const trail = lerp(dreamTrail, PUNCH_TRAIL, chapter);
    const zoomDrive = lerp(DREAM_ZOOM, punchZoom, chapter);
    // Ring hardness: dream rings are soft/wide, punch rings tight/bright.
    const hardness = chapter;

    // Warp the previous frame in. Paint black first so warped edges fall
    // into the tunnel (chroma preserved — no per-channel clamp needed).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      const kick = frame.impulse.low;
      // Punch character lunges harder per kick; dream drifts. Zoom rate
      // climbs with the chapter AND the drop drive. Travel speed on slow
      // bands; kick lunge stays on the instantaneous impulse (a punch).
      // motion: slow bands (erratic-motion law)
      const zoom =
        1 +
        (0.28 + 1.4 * slow.low * slow.low + (2.6 + 2.4 * hardness) * kick) *
          zoomDrive *
          frame.dt;
      // Rotation sharpens with the chapter — dreamy slow twist → punchy spin.
      // Rotation RATE on slow bands; impulse.mid accent stays instantaneous.
      // motion: slow bands (erratic-motion law)
      this.rotation =
        (0.08 + (0.9 + 0.9 * hardness) * slow.mid + (1.4 + 1.4 * hardness) * frame.impulse.mid) *
        frame.dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      // Longer trails (dream) = higher feedback alpha; punch clears faster.
      ctx.globalAlpha = 0.88 + 0.11 * trail;
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Fresh geometry: the wobbling ring at the tunnel mouth. Palette travels
    // with the chapter — dream sits cool (hue offset), punch shifts hot; the
    // energy sweep does the fine work so color never goes monochrome.
    ctx.globalCompositeOperation = 'lighter';
    const energy = energyOf(frame.bands);
    // Cool→hot chapter swing layered on the energy hue (never pinned red).
    const hueOffset = lerp(60, -30, chapter);
    const hue = energyHue(energy, frame.time * 6 + hueOffset);
    const radius = unit * (0.1 + 0.16 * low);
    // Dream ring wobbles wide and slow; punch ring is tight and crisp.
    const wobble = unit * (0.008 + 0.03 * (1 - hardness)) * mid;
    ctx.beginPath();
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const ripple = 6 + 4 * hardness;
      const r = radius + Math.sin(angle * ripple + frame.time * (3 + 2 * hardness)) * wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    // Ring pulses HARDEN toward punch: brighter core, thinner tight line,
    // kicked by low impulse (localized pulse — photosensitivity-exempt).
    const lightness = 42 + 30 * low + 15 * hardness * frame.impulse.low;
    ctx.strokeStyle = `hsl(${hue}, 100%, ${Math.min(85, lightness)}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.003 + lerp(0.016, 0.008, hardness) + 0.01 * low));
    ctx.stroke();

    // Punch adds a second inner ring on the climax for a harder pulse —
    // localized, so exempt from the flash floor.
    if (hardness > 0.55) {
      const inner = radius * 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.strokeStyle = `hsl(${(hue + 30) % 360}, 100%, ${Math.min(80, 55 + 20 * frame.impulse.low)}%)`;
      ctx.lineWidth = Math.max(1.5, unit * 0.004 * hardness);
      ctx.stroke();
    }

    // High-driven sparkles smeared into star-streaks by the feedback. More
    // of them, brighter, as the chapter climbs — the ride gets busier at
    // the climax. Gated by high content (mid/high effect, not kick powder).
    const density = 1 + 0.8 * hardness + 0.6 * this.drive;
    const wanted = SPARKS_PER_S * density * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.0035 * Math.random());
      ctx.fillStyle = `hsl(${(hue + 180 + Math.random() * 40) % 360}, 100%, 75%)`;
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
  id: 'g04-tunnel-saga',
  name: 'g04 tunnel-saga',
  params: [
    // Endpoints of the chapter blend — retuning either mutant shifts where
    // the journey starts and where it climaxes.
    { id: 'dreamTrail', label: 'dream trail', min: 0, max: 1, step: 0.02, default: DREAM_TRAIL },
    { id: 'punchZoom', label: 'punch zoom', min: 0.3, max: 2.5, step: 0.05, default: PUNCH_ZOOM },
  ],
  create: () => new TunnelSagaRenderer(),
};

export default candidate;
