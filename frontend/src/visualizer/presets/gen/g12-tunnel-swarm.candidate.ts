/**
 * g12-tunnel-swarm (gen-12 DUST DIVERSITY, tweak of g02-tunnel-dream / tunnel).
 *
 * Canvas 2D (stays Canvas — the tunnel family's Milkdrop warp-feedback engine
 * is 2D). Dust is BACK by explicit human request, but DIVERSIFIED into a
 * wall-hugging FIREFLY SWARM: discrete individual lights (100-200, readable,
 * never a wash) that STREAM ALONG the tunnel walls (not free space). Density
 * per band REGION follows tunnel-chroma's depth=frequency idea: lows near the
 * mouth (front, large radius), highs deep (back, small radius). Hue per depth
 * band; each firefly leaves a short wall-trail.
 *
 * Interactions:
 *  - KICK = the whole swarm SURGES forward one lurch (a depth impulse).
 *  - SNARE = a spiral band of fireflies DETACHES, orbits once, and re-lands.
 *  - BUILDUP = swarm density rises.
 *  - DROP = the swarm goes INCANDESCENT and streams at max speed riding
 *    max(drop, energy) via bandsSlow (motion smoothness law).
 *
 * The warp-feedback engine keeps the tunnel walls; fireflies are drawn fresh
 * each frame on top and smeared into short trails by the feedback (a natural
 * wall-trail). Motion smoothness: stream speed / swirl rates ride the slow
 * bands; instantaneous bands/impulse drive only brightness, the kick lurch,
 * and the snare detach. Photosensitivity floor respected (no full-field
 * saturated-red strobe; the incandescent lift is bounded and localized to the
 * discrete fireflies, not the whole frame).
 */

import { energyOf } from '../../style';
import type {
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const FIREFLY_COUNT = 160;

/** Depth band a firefly belongs to (0 = mouth/low, 1 = mid, 2 = deep/high). */
interface Firefly {
  /** Angular position around the tunnel (radians). */
  angle: number;
  /** Angular stream velocity (rad/s), slow-band driven. */
  angVel: number;
  /** Depth 0 (mouth) .. 1 (deep) — sets radius on the wall. */
  depth: number;
  /** Radial jitter fraction (fireflies hug the wall, not a perfect ring). */
  wobble: number;
  /** Depth band index 0/1/2. */
  band: number;
  /** Per-firefly phase for twinkle. */
  phase: number;
  /** Detach state for the snare orbit: 0 = on wall, else orbit progress. */
  detach: number;
}

/** Depth-band hues (HSL degrees): lows warm (mouth), mids green, highs cool. */
const BAND_HUE = [28, 140, 205];

function makeFireflies(): Firefly[] {
  const flies: Firefly[] = [];
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    // Bias band by index so all three regions are populated evenly.
    const band = i % 3;
    // depth per band: lows near mouth (~0.15), mids mid (~0.5), highs deep (~0.85).
    const depth = band / 2 + (Math.random() - 0.5) * 0.28;
    flies.push({
      angle: Math.random() * Math.PI * 2,
      angVel: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.35),
      depth: Math.min(0.98, Math.max(0.05, depth)),
      wobble: 0.85 + Math.random() * 0.3,
      band,
      phase: Math.random() * Math.PI * 2,
      detach: 0,
    });
  }
  return flies;
}

class TunnelSwarmRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;
  private fireflies = makeFireflies();
  private smoothDrop = 0;
  private smoothBuildup = 0;
  private lurch = 0; // kick surge-forward envelope (decays)
  private snareOrbit = 0; // active detach envelope

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
    // Motion-grade slow bands drive stream/swirl rates (erratic-motion law).
    const slow = frame.bandsSlow ?? frame.bands;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const dt = frame.dt;

    // ---- Dynamics: excitement split by bass presence (voyage idiom).
    const lowPresence = Math.min(1, Math.max(0, (low - 0.2) / 0.5));
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const energy = energyOf(slow);
    const drive = Math.max(this.smoothDrop, energy); // sustained streaming energy

    // Kick lurch (surge forward one lurch) + snare detach envelopes.
    this.lurch = Math.max(0, this.lurch - dt / 0.4);
    if (frame.impulse.low > 0.35) this.lurch = Math.min(1, this.lurch + frame.impulse.low);
    this.snareOrbit = Math.max(0, this.snareOrbit - dt / 1.2);
    const snareHit = frame.impulse.mid > 0.35;
    if (snareHit && this.snareOrbit < 0.1) this.snareOrbit = 1;

    // ---- Warp the previous frame in (bass zoom + mid twist).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      // Kick lunge on the transient; drop streams the tunnel faster.
      const zoomAmount = frame.params.zoom ?? 0.65;
      const zoom =
        1 +
        (0.3 + 1.4 * low * low + 3.5 * frame.impulse.low + 1.2 * drive * this.lurch) *
          zoomAmount *
          dt;
      // Rotation rides SLOW mid (motion smoothness), kicked by the mid impulse.
      this.rotation = (0.1 + 1.2 * slow.mid + 1.8 * frame.impulse.mid) * dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      ctx.globalAlpha = 0.9 + 0.095 * (frame.params.trail ?? 0.92);
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'lighter';

    // ---- The tunnel-mouth ring (kept from tunnel; the wall origin).
    const mouthHue = (BAND_HUE[0] + frame.time * 8) % 360;
    const radius = unit * (0.12 + 0.16 * low);
    const wobble = unit * 0.02 * mid;
    ctx.beginPath();
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const rr = radius + Math.sin(a * 6 + frame.time * 3) * wobble;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${mouthHue}, 100%, ${45 + 35 * low}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.004 + 0.014 * low));
    ctx.stroke();

    // ---- THE FIREFLY SWARM: discrete wall-hugging lights.
    // Depth maps to wall radius (mouth = large, deep = small — the tunnel
    // recedes). Density per band region rises with that band's level +
    // buildup. Each firefly is drawn as a dot + a short trailing streak (the
    // wall-trail), which the feedback smears further next frame.
    const bandLevel = [low, mid, high];
    const bandSlow = [slow.low, slow.mid, slow.high];
    const density = frame.params.density ?? 1;
    // Incandescence: on a drop, fireflies go white-hot (bounded lift).
    const incand = drive;

    for (const f of this.fireflies) {
      // Stream along the wall: angular velocity rides the SLOW band for its
      // region (motion smoothness), sped by the drop.
      const bandStream = 0.3 + 1.6 * bandSlow[f.band] + 1.4 * drive;
      f.angle += f.angVel * bandStream * dt;

      // Per-region population gate: skip drawing when that band is quiet, so a
      // band region visibly thins out / disappears (EQ-like readability).
      const regionGate = Math.min(1, bandLevel[f.band] * 2.2 + 0.35 * this.smoothBuildup);
      const visible = ((f.phase * 997) % 1) < regionGate * density * 1.15;
      if (!visible && f.detach < 0.01) continue;

      // Depth -> wall radius. Kick lurch pushes the whole swarm deeper briefly.
      const depth = Math.min(0.99, f.depth + 0.12 * this.lurch * drive);
      // Perspective: mouth ring radius scales down toward the vanishing point.
      const wallR = radius + (unit * 0.46 - radius) * (1 - depth);

      // Snare detach: a spiral band peels off, orbits once, re-lands.
      // Select a spiral band by angle+depth so it reads as a coherent ribbon.
      const inBand =
        this.snareOrbit > 0.01 &&
        Math.abs(Math.sin(f.angle * 1.5 + f.depth * 6.0)) > 0.7;
      if (inBand) f.detach = this.snareOrbit;
      else f.detach = Math.max(0, f.detach - dt / 1.2);

      let px: number;
      let py: number;
      let rWall = wallR * f.wobble;
      if (f.detach > 0.01) {
        // Orbit once: lift off the wall (bulge inward) and swing around.
        const orbitPhase = (1 - f.detach) * Math.PI * 2;
        const lift = Math.sin(f.detach * Math.PI) * unit * 0.12;
        rWall = wallR - lift;
        px = cx + Math.cos(f.angle + orbitPhase) * rWall;
        py = cy + Math.sin(f.angle + orbitPhase) * rWall;
      } else {
        px = cx + Math.cos(f.angle) * rWall;
        py = cy + Math.sin(f.angle) * rWall;
      }

      // Twinkle + brightness. Deep fireflies are dimmer (distance).
      const twinkle = 0.55 + 0.45 * Math.sin(frame.time * 9 + f.phase);
      const distFade = 0.4 + 0.6 * (1 - depth);
      const lum = Math.min(
        92,
        (38 + 34 * bandLevel[f.band]) * distFade * (0.7 + 0.6 * twinkle) + 30 * incand
      );
      const sat = Math.max(0, 100 - 70 * incand); // incandescent -> whiter
      const hue = (BAND_HUE[f.band] + 18 * Math.sin(f.phase) + frame.time * 4) % 360;
      const size = unit * (0.0016 + 0.0032 * (1 - depth)) * (1 + 0.7 * incand);

      // Short wall-trail: a streak opposite the stream direction.
      const trailLen = unit * (0.01 + 0.03 * bandStream * 0.1) * (0.5 + drive);
      const tx = px - Math.sin(f.angle) * Math.sign(f.angVel) * trailLen;
      const ty = py + Math.cos(f.angle) * Math.sign(f.angVel) * trailLen;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lum}%, 0.5)`;
      ctx.lineWidth = Math.max(1, size * 0.9);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();

      // The firefly head.
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lum}%)`;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    // Snapshot for the next warp (feedback smears the trails into the walls).
    if (bufferCtx && this.buffer) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(ctx.canvas, 0, 0);
    }
  }
}

export const g12TunnelSwarmPreset: VisualizerPreset = {
  id: 'g12-tunnel-swarm',
  name: 'g12 tunnel-swarm',
  params: [
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.92 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: 0.65 },
    { id: 'density', label: 'swarm density', min: 0.4, max: 2, step: 0.05, default: 1 },
  ],
  create: () => new TunnelSwarmRenderer(),
};

export default g12TunnelSwarmPreset;
