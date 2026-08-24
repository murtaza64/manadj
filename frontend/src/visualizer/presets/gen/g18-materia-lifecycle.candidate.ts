/** g18-materia-lifecycle: a mirrored tablet ages through an exact 32-bar cycle. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function hash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

class MateriaLifecycleRenderer implements PresetRenderer {
  private breath = 0;
  private lastCycle = -1;
  private rebirth = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.breath += dt * (0.1 + slow.low * 0.12) * (frame.params.motion ?? 1);
    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : Math.floor(frame.time / 2);
    const lifeBar = mod(tierBar, 32);
    const chapter = Math.floor(lifeBar / 8);
    const barInChapter = mod(lifeBar, 8);
    const cycle = Math.floor(tierBar / 32);
    const phase = frame.beat?.barPhase ?? mod(frame.time / 2, 1);
    if (this.lastCycle >= 0 && cycle !== this.lastCycle) this.rebirth = 1;
    this.lastCycle = cycle;
    this.rebirth = Math.max(0, this.rebirth - dt / 1.2);

    const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
    const seed = hash(deck?.trackId ?? 1831);
    const hue = mod(seed * 360 + cycle * 151 + chapter * 72, 360);
    const energy = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
    const buildup = frame.regime?.buildup ?? 0;
    const sustained = Math.max(frame.regime?.sustained ?? 0, energy);
    ctx.fillStyle = `hsl(${mod(hue + 188, 360)}, 82%, ${3 + this.rebirth * 5}%)`;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const tile = unit * 0.075 * (frame.params.scale ?? 1);
    const gap = tile * 0.16;
    const relief = frame.params.relief ?? 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((Math.floor(lifeBar / 16) % 2) * Math.PI / 2 + Math.sin(this.breath) * 0.018);

    for (let i = 0; i < 8; i++) {
      const born = chapter === 0 ? i < barInChapter || (i === barInChapter && phase > 0.04) : true;
      const reborn = chapter === 3 && i >= 7 - barInChapter;
      const visible = chapter === 3 ? reborn : born;
      const settle = i === barInChapter ? phase * phase * (3 - 2 * phase) : 1;
      for (const side of [-1, 1]) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = side * (tile * (0.75 + col) + gap * col);
        const y = (row - 0.5) * (tile + gap);
        ctx.strokeStyle = `hsla(${mod(hue + i * 27, 360)}, 100%, 64%, 0.18)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - tile / 2, y - tile / 2, tile, tile);
        if (!visible) continue;
        const spectrum = clamp(frame.spectrum[i * 3 + (side > 0 ? 1 : 0)] ?? 0);
        const arrival = chapter === 0 ? (1 - settle) * side * unit * 0.5 : chapter === 3 ? (1 - settle) * -side * unit * 0.5 : 0;
        const light = 34 + spectrum * 25 + sustained * 8 - (chapter === 2 ? 7 : 0);
        ctx.fillStyle = `hsl(${mod(hue + i * 27 + side * 12, 360)}, 100%, ${light}%)`;
        ctx.fillRect(x - tile / 2 + arrival, y - tile / 2, tile, tile);
        ctx.fillStyle = `hsl(${mod(hue + i * 27 + 42, 360)}, 100%, ${Math.min(76, light + 18)}%)`;
        ctx.fillRect(x - tile / 2 + arrival, y - tile / 2, tile, tile * 0.08 * relief);

        if (chapter === 1) {
          const growth = (barInChapter + phase) / 8;
          ctx.fillStyle = `hsla(${mod(hue + 132, 360)}, 100%, 70%, ${0.25 + growth * 0.5})`;
          ctx.fillRect(x - tile * 0.06 + arrival, y - tile / 2, tile * 0.12, tile * growth);
        }
        if (chapter === 2 && i <= barInChapter) {
          ctx.strokeStyle = `hsl(${mod(hue + 185, 360)}, 100%, 74%)`;
          ctx.lineWidth = Math.max(1, unit * 0.003 * (frame.params.cracks ?? 1));
          ctx.beginPath();
          ctx.moveTo(x - tile * 0.4, y - tile * 0.35);
          ctx.lineTo(x + (hash(i * 41 + cycle) - 0.5) * tile * 0.3, y);
          ctx.lineTo(x + tile * 0.38, y + tile * 0.32);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    const chapterProgress = (barInChapter + phase) / 8;
    const chapterColors = [hue, hue + 72, hue + 144, hue + 216];
    for (let i = 0; i < 4; i++) {
      const x = cx - unit * 0.34 + i * unit * 0.18;
      ctx.strokeStyle = `hsla(${mod(chapterColors[i], 360)}, 100%, 62%, 0.24)`;
      ctx.lineWidth = unit * 0.006;
      ctx.strokeRect(x, height * 0.89, unit * 0.14, unit * 0.018);
      if (i <= chapter) {
        ctx.fillStyle = `hsl(${mod(chapterColors[i], 360)}, 100%, 60%)`;
        ctx.fillRect(x, height * 0.89, unit * 0.14 * (i === chapter ? chapterProgress : 1), unit * 0.018);
      }
    }
    if (frame.impulse.low > 0.08) {
      ctx.fillStyle = `hsla(${mod(hue + 110, 360)}, 100%, 68%, ${frame.impulse.low * 0.35})`;
      ctx.fillRect(cx - unit * 0.015, cy - unit * (0.18 + frame.impulse.low * 0.03), unit * 0.03, unit * 0.36);
    }
    if (buildup > 0.05) {
      ctx.strokeStyle = `hsla(${mod(hue + 120, 360)}, 100%, 68%, ${buildup * 0.45})`;
      ctx.lineWidth = unit * 0.004;
      ctx.strokeRect(cx - unit * 0.4, cy - unit * 0.18, unit * 0.8, unit * 0.36);
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'tablet scale', min: 0.65, max: 1.3, step: 0.05, default: 1 },
  { id: 'relief', label: 'ceramic relief', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'cracks', label: 'weathering', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'motion', label: 'tablet breath', min: 0, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = { id: 'g18-materia-lifecycle', name: 'g18 materia-lifecycle', params, create: () => new MateriaLifecycleRenderer() };
export default preset;
