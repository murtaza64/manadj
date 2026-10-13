/** g18-tally-foundry: sixteen bar-cast slabs make the section count physical. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function genome(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  let x = (deck?.trackId ?? 1801) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

class TallyFoundryRenderer implements PresetRenderer {
  private angle = 0;
  private lastSection = -1;
  private boundary = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.angle += dt * (0.025 + slow.mid * 0.055) * (frame.params.motion ?? 1);
    const beat = frame.beat;
    const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : Math.floor(frame.time / 2);
    const bar = mod(tierBar, 16);
    const section = Math.floor(tierBar / 16);
    const phase = beat?.barPhase ?? mod(frame.time / 2, 1);
    if (this.lastSection >= 0 && section !== this.lastSection) this.boundary = 1;
    this.lastSection = section;
    this.boundary = Math.max(0, this.boundary - dt / 0.7);

    const seed = genome(frame);
    const bank = Math.floor(mod(tierBar, 16) / 8);
    const baseHue = mod(seed * 360 + section * 137 + bank * 82, 360);
    const energy = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
    const buildup = frame.regime?.buildup ?? frame.trend.excitement * (1 - frame.bands.low);
    const sustained = Math.max(frame.regime?.sustained ?? 0, energy);
    ctx.fillStyle = `hsl(${mod(baseHue + 184, 360)}, 80%, ${3 + this.boundary * 5}%)`;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const size = unit * 0.66 * (frame.params.scale ?? 1);
    const cell = size / 4;
    const left = width / 2 - size / 2;
    const top = height / 2 - size / 2;
    const relief = frame.params.relief ?? 1;
    const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
    const eqs = [deck?.eq.low ?? 0.5, deck?.eq.mid ?? 0.5, deck?.eq.high ?? 0.5];

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((section % 2) * Math.PI / 2 + Math.sin(this.angle) * 0.035);
    ctx.translate(-width / 2, -height / 2);
    for (let i = 0; i < 16; i++) {
      const mirrored = section % 2 ? 15 - i : i;
      const row = Math.floor(mirrored / 4);
      const col = mirrored % 4;
      const x = left + col * cell;
      const y = top + row * cell;
      const active = i < bar || (i === bar && phase > 0.04);
      const settle = i === bar ? phase * phase * (3 - 2 * phase) : 1;
      ctx.strokeStyle = `hsla(${mod(baseHue + i * 19, 360)}, 100%, 62%, 0.2)`;
      ctx.lineWidth = Math.max(1, unit * 0.002);
      ctx.strokeRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
      if (!active) continue;
      const spectrum = clamp(frame.spectrum[Math.min(23, i + Math.floor(i / 2))] ?? 0);
      const eq = eqs[Math.min(2, Math.floor(i / 6))];
      const lift = (1 - settle) * height * (row < 2 ? -0.55 : 0.55);
      const hue = mod(baseHue + i * 19 + frame.centroid * 48, 360);
      const light = 34 + spectrum * 25 + sustained * 8;
      ctx.fillStyle = `hsl(${hue}, 100%, ${light}%)`;
      ctx.fillRect(x + cell * 0.1, y + cell * 0.1 + lift, cell * 0.8, cell * 0.8);
      ctx.fillStyle = `hsl(${mod(hue + 38, 360)}, 100%, ${Math.min(78, light + 18)}%)`;
      ctx.fillRect(x + cell * 0.1, y + cell * 0.1 + lift, cell * 0.8, cell * 0.07 * relief * (0.6 + eq));
    }
    ctx.restore();

    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i <= bar ? `hsl(${mod(baseHue + i * 19, 360)}, 100%, 58%)` : 'rgba(255,255,255,0.12)';
      const tickW = size / 20;
      ctx.fillRect(width / 2 - size / 2 + i * size / 16, height * 0.9, tickW, unit * (i % 4 === 3 ? 0.025 : 0.014));
    }
    if (frame.impulse.low > 0.08) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, unit * (0.36 + frame.impulse.low * 0.08), 0, TAU);
      ctx.strokeStyle = `hsla(${baseHue}, 100%, 72%, ${frame.impulse.low * 0.55})`;
      ctx.lineWidth = unit * 0.006;
      ctx.stroke();
    }
    if (buildup > 0.05) {
      ctx.strokeStyle = `hsla(${mod(baseHue + 120, 360)}, 100%, 68%, ${buildup * 0.5})`;
      ctx.lineWidth = unit * 0.004;
      ctx.strokeRect(left - unit * 0.025, top - unit * 0.025, size + unit * 0.05, size + unit * 0.05);
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'monument scale', min: 0.65, max: 1.25, step: 0.05, default: 1 },
  { id: 'relief', label: 'slab relief', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'motion', label: 'foundry drift', min: 0, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = { id: 'g18-tally-foundry', name: 'g18 tally-foundry', params, create: () => new TallyFoundryRenderer() };
export default preset;
