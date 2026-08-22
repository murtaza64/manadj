import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const COLORS = ['#ff1744', '#ffea00', '#00e5ff', '#651fff', '#76ff03'];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

class EpochTricentricRenderer implements PresetRenderer {
  private advance = 0;
  private rotation = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.advance += dt * (.08 + slow.low * .3);
    this.rotation += dt * (.025 + slow.high * .04);
    const bar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
    const section = Math.floor(bar / 16);
    const mode = mod(section, 4);
    const epochStep = mod(section, 8);
    const epoch = epochStep / 7;
    const sides = [3, 4, 6, 8][mode] + Math.floor(epochStep / 3);
    const ringCount = 9 + epochStep * 2;
    const anchors: Array<[number, number]> = [[.5, .5], [.24, .3], [.76, .7], [.5, .18]];
    const [ax, ay] = anchors[mode];
    const invert = mode % 2 === 1;
    ctx.fillStyle = invert ? '#f5f000' : '#090b20';
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height) * (frame.params.scale ?? 1);
    const kick = frame.impulse.low;
    for (let i = ringCount - 1; i >= 0; i--) {
      const depth = mod(i + this.advance, ringCount) / ringCount;
      const radius = unit * (.025 + depth * depth * .68) * (1 + kick * .07);
      const shear = mode === 2 ? 1.5 : mode === 3 ? .62 : 1;
      const cx = width * ax + (width * .5 - width * ax) * depth * .6;
      const cy = height * ay + (height * .5 - height * ay) * depth * .6;
      const color = COLORS[mod(i + section + Math.floor(epoch * 4), COLORS.length)];
      ctx.beginPath();
      for (let p = 0; p <= sides; p++) {
        const a = p / sides * TAU + this.rotation + mode * Math.PI / 8 + depth * (mode - 1.5) * .7;
        const x = cx + Math.cos(a) * radius * shear;
        const y = cy + Math.sin(a) * radius / shear;
        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const solid = mod(i + mode, Math.max(2, 5 - Math.floor(epoch * 3))) === 0;
      if (solid) {
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.strokeStyle = invert ? '#111329' : color;
      ctx.lineWidth = Math.max(1.5, unit * (.003 + slow.mid * .008));
      ctx.stroke();
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g19-epoch-tricentric',
  name: 'g19 epoch tricentric',
  params: [{ id: 'scale', label: 'tunnel scale', min: .7, max: 1.35, step: .05, default: 1 }],
  create: () => new EpochTricentricRenderer(),
};

export default preset;
