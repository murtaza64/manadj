/**
 * "g01 tunnel-dust" (gen tweak of Tunnel): keeps Tunnel's warp-feedback
 * flight and wobbling ring exactly as they feel — bass lunges the zoom,
 * mids twist, highs streak into sparkles. The one addition is a THIN
 * mid-driven dust haze painted into the tunnel walls (voyage-style fbm,
 * palette-colored), and a traveling kick REVERBERATION that visibly lights
 * up the dust as it passes. Kicks stay SOLID (lunge + ring), never sparkly:
 * the dust is a mid effect and the reverb only brightens what's already
 * there.
 */

import { energyHue, energyOf } from '../../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const SPARKS_PER_S = 160;

// --- Value noise + fbm (voyage's technique, ported to plain JS for the
// canvas-2D haze). Cheap hash-lattice noise summed over 4 octaves.
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function fbm2(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    v += amp * noise2(px, py);
    const nx = px * 2.03 + 17.3;
    const ny = py * 2.03 + 9.1;
    px = nx;
    py = ny;
    amp *= 0.5;
  }
  return v;
}

/** Coarse angular resolution for the haze: a ring of blobs stamped around
 * the tunnel mouth. Kept low so the fbm sampling stays cheap; the feedback
 * warp smears the blobs into continuous wall texture. */
const HAZE_SEGMENTS = 96;

class TunnelDustRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;

  // Traveling kick reverberation: a radial wavefront that expands from the
  // tunnel mouth and lights the dust it passes through, then fades.
  private rippleAge = 999;
  private rippleAmp = 0;

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

    // Warp the previous frame in: zoom toward the viewer (bass-driven)
    // with a mid-driven twist. Paint black first — the warp must composite
    // onto darkness so edges fall away.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      // Kick lunge: the transient, not the level, throws you forward.
      const zoomAmount = frame.params.zoom ?? 1;
      const zoom = 1 + (0.3 + 1.4 * low * low + 3.5 * frame.impulse.low) * zoomAmount * frame.dt;
      this.rotation = (0.1 + 1.2 * mid + 1.8 * frame.impulse.mid) * frame.dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      ctx.globalAlpha = 0.9 + 0.095 * (frame.params.trail ?? 0.68);
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Fresh geometry: a wobbling ring at the tunnel mouth. The feedback
    // zoom smears successive rings into the tunnel walls.
    ctx.globalCompositeOperation = 'lighter';
    const hue = energyHue(energyOf(frame.bands), frame.time * 6);
    const radius = unit * (0.1 + 0.16 * low);
    const wobble = unit * 0.02 * mid;
    ctx.beginPath();
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = radius + Math.sin(angle * 6 + frame.time * 3) * wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue}, 100%, ${45 + 35 * low}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.004 + 0.014 * low));
    ctx.stroke();

    // --- THIN dust haze in the tunnel walls. A ring of small palette-hued
    // fbm blobs stamped just outside the mouth; the feedback warp smears
    // them down the walls into continuous, drifting dust. Mid-gated so it's
    // a texture of the mids, not the bass — kicks never turn it sparkly.
    const dustAmount = frame.params.dust ?? 1;
    const midGate = Math.min(1, Math.max(0, (mid - 0.04) / 0.26));
    if (midGate > 0.001 && dustAmount > 0.001) {
      // Traveling kick reverberation: retrigger on a strong kick, capture
      // its strength; the wavefront then expands and fades over ~0.7 s.
      this.rippleAge += frame.dt;
      if (frame.impulse.low > 0.35 && this.rippleAge > 0.12) {
        this.rippleAge = 0;
        this.rippleAmp = Math.min(1, frame.impulse.low * 1.2);
      }
      const waveFront = radius * (1.0 + this.rippleAge * 4.2);
      const rippleDecay = Math.exp(-this.rippleAge * 2.4) * this.rippleAmp;

      const hazeR = radius * 1.12;
      const blobSize = unit * 0.05;
      const drift = frame.time * 0.15;
      for (let i = 0; i < HAZE_SEGMENTS; i++) {
        const angle = (i / HAZE_SEGMENTS) * Math.PI * 2;
        // voyage-style fbm sampled in (angle, drift) — the wall texture.
        const n = fbm2(angle * 2.2 + drift, drift * 0.4 + 3.0);
        const density = Math.pow(n, 2.4);
        if (density < 0.02) continue;
        // Reverb brightens the dust the wavefront currently overlaps.
        const bandDist = Math.abs(hazeR - waveFront);
        const reverb =
          1 + 2.6 * Math.exp(-Math.pow(bandDist / (unit * 0.04), 2)) * rippleDecay;
        const r = hazeR + (n - 0.5) * blobSize * 1.5;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        // Palette-colored: rides the same energy hue as the ring, drifting
        // per-blob so the haze isn't monochrome.
        const bhue = (hue + 30 + n * 60) % 360;
        const light = Math.min(85, (14 + 26 * n) * reverb);
        const alpha = Math.min(0.5, 0.16 * density * dustAmount * midGate * reverb);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, blobSize);
        grad.addColorStop(0, `hsla(${bhue}, 100%, ${light}%, ${alpha})`);
        grad.addColorStop(1, `hsla(${bhue}, 100%, ${light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, blobSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // High-driven sparkles — the feedback stretches them into star-streaks.
    // (High-band, not kick-band: bass impacts stay SOLID.)
    const wanted = SPARKS_PER_S * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.003 * Math.random());
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

    // Snapshot this frame for the next warp.
    if (bufferCtx && this.buffer) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(ctx.canvas, 0, 0);
    }
  }
}

const candidate: VisualizerPreset = {
  id: 'g01-tunnel-dust',
  name: 'g01 tunnel-dust',
  params: [
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.68 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => new TunnelDustRenderer(),
};

export default candidate;
