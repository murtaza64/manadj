/** g18-materia-rings: one solid, notched stratum is cast per bar. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function trackHue(frame: VisualizerFrameData): number {
  const id = frame.decks.find((deck) => deck.channel === frame.dominantChannel)?.trackId ?? 1811;
  let x = Math.imul((id | 0) ^ 0x9e3779b9, 0x21f0aaad);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

class MateriaRingsRenderer implements PresetRenderer {
  private rotation = 0;
  private lastSection = -1;
  private lock = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.rotation += dt * (0.035 + slow.high * 0.08) * (frame.params.motion ?? 1);
    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : Math.floor(frame.time / 2);
    const bar = mod(tierBar, 16);
    const section = Math.floor(tierBar / 16);
    const phase = frame.beat?.barPhase ?? mod(frame.time / 2, 1);
    if (this.lastSection >= 0 && section !== this.lastSection) this.lock = 1;
    this.lastSection = section;
    this.lock = Math.max(0, this.lock - dt / 0.9);

    const bank = Math.floor(bar / 8);
    const hue = mod(trackHue(frame) * 360 + section * 103 + bank * 96, 360);
    const energy = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
    const drop = Math.max(frame.regime?.dropTransition ?? 0, frame.regime?.sustained ?? 0);
    const buildup = frame.regime?.buildup ?? 0;
    ctx.fillStyle = `hsl(${mod(hue + 172, 360)}, 78%, ${3 + this.lock * 4}%)`;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const spacing = unit * 0.018 * (frame.params.spacing ?? 1);
    const facets = 4 + (section % 4) * 2;
    const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((section % 4) * Math.PI / 2 + this.rotation);
    for (let i = 0; i < 16; i++) {
      const active = i < bar || (i === bar && phase > 0.03);
      const radius = unit * 0.075 + i * spacing;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.strokeStyle = active ? `hsl(${mod(hue + i * 21, 360)}, 100%, ${38 + (frame.spectrum[i] ?? 0) * 34 + drop * 8}%)` : 'rgba(255,255,255,0.1)';
      const eq = i < 6 ? deck?.eq.low : i < 11 ? deck?.eq.mid : deck?.eq.high;
      ctx.lineWidth = active ? Math.max(2, unit * 0.006 * (0.7 + (eq ?? 0.5)) * (frame.params.relief ?? 1)) : 1;
      ctx.stroke();
      if (!active) continue;
      const notch = (i / 16) * TAU + section * Math.PI / facets;
      ctx.save();
      ctx.rotate(notch);
      ctx.fillStyle = `hsl(${mod(hue + i * 21 + 45, 360)}, 100%, 72%)`;
      ctx.fillRect(radius - unit * 0.012, -ctx.lineWidth, unit * 0.024 + phase * unit * 0.006, ctx.lineWidth * 2);
      ctx.restore();
    }
    for (let i = 0; i < facets; i++) {
      ctx.rotate(TAU / facets);
      ctx.fillStyle = `hsla(${mod(hue + 150, 360)}, 100%, 64%, ${0.14 + buildup * 0.18})`;
      ctx.fillRect(unit * 0.065, -unit * 0.002, unit * 0.31, unit * 0.004);
    }
    const coreR = unit * (0.052 + frame.bands.low * 0.025 + frame.impulse.low * 0.018) * scale;
    ctx.beginPath();
    for (let i = 0; i <= facets; i++) {
      const a = i / facets * TAU;
      const r = coreR * (1 + frame.flatness * 0.12 * (i % 2));
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fillStyle = `hsl(${mod(hue + frame.centroid * 90, 360)}, 100%, ${44 + energy * 24}%)`;
    ctx.fill();
    ctx.restore();

    const markerY = height * 0.91;
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i <= bar ? `hsl(${mod(hue + i * 21, 360)}, 100%, 60%)` : 'rgba(255,255,255,0.1)';
      ctx.fillRect(cx - unit * 0.34 + i * unit * 0.043, markerY, unit * 0.027, unit * (i % 4 === 3 ? 0.025 : 0.012));
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'core scale', min: 0.6, max: 1.5, step: 0.05, default: 1 },
  { id: 'spacing', label: 'ring spacing', min: 0.65, max: 1.35, step: 0.05, default: 1 },
  { id: 'relief', label: 'cast relief', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'motion', label: 'mold drift', min: 0, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = { id: 'g18-materia-rings', name: 'g18 materia-rings', params, create: () => new MateriaRingsRenderer() };
export default preset;
