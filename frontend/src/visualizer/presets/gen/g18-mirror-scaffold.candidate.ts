/** g18-mirror-scaffold: one paired truss rises per bar and locks at bar sixteen. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function seededHue(frame: VisualizerFrameData): number {
  const id = frame.decks.find((deck) => deck.channel === frame.dominantChannel)?.trackId ?? 1823;
  return mod(Math.imul(id | 0, 2654435761) / 4294967296 * 360, 360);
}

class MirrorScaffoldRenderer implements PresetRenderer {
  private sway = 0;
  private lastSection = -1;
  private roof = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.sway += dt * (0.08 + slow.mid * 0.16) * (frame.params.motion ?? 1);
    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : Math.floor(frame.time / 2);
    const bar = mod(tierBar, 16);
    const section = Math.floor(tierBar / 16);
    const phase = frame.beat?.barPhase ?? mod(frame.time / 2, 1);
    if (this.lastSection >= 0 && section !== this.lastSection) this.roof = 1;
    this.lastSection = section;
    this.roof = Math.max(0, this.roof - dt / 1.1);

    const bank = Math.floor(bar / 8);
    const hue = mod(seededHue(frame) + section * 119 + bank * 78 + frame.centroid * 35, 360);
    const energy = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
    const buildup = frame.regime?.buildup ?? 0;
    const drop = Math.max(frame.regime?.dropTransition ?? 0, frame.regime?.sustained ?? 0);
    ctx.fillStyle = `hsl(${mod(hue + 190, 360)}, 86%, ${3 + this.roof * 5}%)`;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const cx = width / 2;
    const ground = height * 0.82;
    const halfW = unit * 0.39 * (frame.params.scale ?? 1);
    const top = height * 0.18;
    const bay = halfW / 8;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    for (let i = 0; i < 8; i++) {
      const leftIndex = i;
      const rightIndex = 15 - i;
      for (const index of [leftIndex, rightIndex]) {
        const active = index < bar || (index === bar && phase > 0.03);
        const x = index < 8 ? cx - (i + 1) * bay : cx + (i + 1) * bay;
        const spectrum = clamp(frame.spectrum[index] ?? 0);
        const targetTop = ground - unit * (0.18 + spectrum * 0.34);
        const settle = index === bar ? phase * phase * (3 - 2 * phase) : 1;
        const yTop = ground + (targetTop - ground) * settle;
        ctx.strokeStyle = active ? `hsl(${mod(hue + index * 17, 360)}, 100%, ${44 + spectrum * 28 + drop * 7}%)` : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = active ? Math.max(2, unit * 0.007 * (frame.params.weight ?? 1)) : 1;
        ctx.beginPath();
        ctx.moveTo(x, ground);
        ctx.lineTo(x, active ? yTop : top + (i % 2) * unit * 0.02);
        ctx.lineTo(index < 8 ? x + bay : x - bay, ground);
        ctx.stroke();
        if (active) {
          ctx.fillStyle = `hsl(${mod(hue + index * 17 + 45, 360)}, 100%, 68%)`;
          ctx.fillRect(x - ctx.lineWidth, yTop - ctx.lineWidth, ctx.lineWidth * 2, ctx.lineWidth * 2);
        }
      }
    }

    ctx.strokeStyle = `hsl(${mod(hue + 110, 360)}, 100%, ${54 + energy * 20}%)`;
    ctx.lineWidth = unit * 0.008;
    for (let q = 1; q < 4; q++) {
      const x = cx - halfW + q * halfW / 2;
      ctx.beginPath();
      ctx.moveTo(x, ground + unit * 0.025);
      ctx.lineTo(x, ground + unit * (0.025 + (q % 2) * 0.018));
      ctx.stroke();
    }

    if (bar >= 15) {
      const lock = phase;
      ctx.strokeStyle = `hsl(${mod(hue + 145, 360)}, 100%, ${58 + drop * 18}%)`;
      ctx.lineWidth = unit * 0.012;
      ctx.beginPath();
      ctx.moveTo(cx - halfW * lock, top);
      ctx.lineTo(cx, top - unit * 0.07 * lock);
      ctx.lineTo(cx + halfW * lock, top);
      ctx.stroke();
    }

    if (frame.wave) {
      ctx.beginPath();
      const count = Math.min(128, frame.wave.left.length, frame.wave.right.length);
      for (let i = 0; i < count; i++) {
        const at = Math.floor(i / Math.max(1, count - 1) * (frame.wave.left.length - 1));
        const folded = (frame.wave.left[at] - frame.wave.right[at]) * (frame.params.fold ?? 1);
        const x = cx + folded * halfW * 0.3;
        const y = top + i / Math.max(1, count - 1) * (ground - top);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${mod(hue + 250, 360)}, 100%, 72%, ${0.35 + buildup * 0.45})`;
      ctx.lineWidth = unit * 0.003;
      ctx.stroke();
    }

    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i <= bar ? `hsl(${mod(hue + i * 17, 360)}, 100%, 58%)` : 'rgba(255,255,255,0.11)';
      ctx.fillRect(cx - halfW + i * halfW * 2 / 16, height * 0.91, halfW * 1.35 / 16, unit * (i % 4 === 3 ? 0.026 : 0.012));
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'scaffold width', min: 0.65, max: 1.2, step: 0.05, default: 1 },
  { id: 'weight', label: 'truss weight', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'fold', label: 'stereo fold', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'motion', label: 'structural sway', min: 0, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = { id: 'g18-mirror-scaffold', name: 'g18 mirror-scaffold', wantsWave: true, params, create: () => new MirrorScaffoldRenderer() };
export default preset;
