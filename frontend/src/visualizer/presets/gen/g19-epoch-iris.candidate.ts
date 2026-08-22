import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const PALETTES = [
  ['#12142b', '#ff1744', '#00e5ff', '#ffea00'],
  ['#20102f', '#d500f9', '#76ff03', '#ff6d00'],
  ['#071f1d', '#00e676', '#ff3d00', '#651fff'],
  ['#241400', '#ffab00', '#00b0ff', '#f50057'],
];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

class EpochIrisRenderer implements PresetRenderer {
  private spin = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.spin += dt * (.04 + slow.mid * .12);
    const bar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
    const section = Math.floor(bar / 16);
    const mode = mod(section, 4);
    const epochStep = mod(section, 8);
    const progress = epochStep / 7;
    const count = 8 + epochStep * 4;
    const palette = PALETTES[mod(section + Math.floor(progress * 3), PALETTES.length)];
    const beatPhase = frame.beat?.phase ?? mod(frame.time * .5, 1);
    const pulse = 1 + frame.impulse.low * .15 + (1 - beatPhase) * .035;
    const unit = Math.min(width, height) * (frame.params.scale ?? 1);
    const cx = width / 2;
    const cy = height / 2;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = mode % 2 === 0 ? palette[0] : palette[2];
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.spin + (mode === 1 || mode === 3 ? Math.PI / 4 : 0));
    for (let i = 0; i < count; i++) {
      const a0 = i / count * TAU;
      const a1 = (i + .82) / count * TAU;
      const band = frame.spectrum[i % 24] ?? 0;
      const inner = unit * (.055 + progress * .075);
      const baseOuter = unit * (.22 + band * .20) * pulse;
      const outer = mode === 2 ? baseOuter * (i % 2 === 0 ? 1 : .52) : baseOuter;
      ctx.fillStyle = palette[1 + mod(i + mode, 3)];
      if (mode === 1) {
        ctx.save();
        ctx.rotate(a0);
      }
      ctx.beginPath();
      if (mode === 0) {
        ctx.arc(0, 0, inner, a0, a1);
        ctx.arc(0, 0, outer, a1, a0, true);
      } else if (mode === 1) {
        const side = i % 2 === 0 ? 1 : -1;
        ctx.moveTo(side * inner, -inner);
        ctx.lineTo(side * outer, -outer * .18);
        ctx.lineTo(side * outer, outer * .18);
        ctx.lineTo(side * inner, inner);
      } else if (mode === 2) {
        ctx.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
        ctx.lineTo(Math.cos((a0 + a1) * .5) * outer, Math.sin((a0 + a1) * .5) * outer);
        ctx.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
      } else {
        const ring = i % 4;
        const r0 = unit * (.07 + ring * .085);
        const r1 = r0 + unit * (.055 + progress * .018);
        ctx.arc(0, 0, r0, a0, a1);
        ctx.arc(0, 0, r1, a1, a0, true);
      }
      ctx.closePath();
      ctx.fill();
      if (mode === 1) ctx.restore();
    }
    const hubSides = 3 + epochStep;
    const hubR = unit * (.045 + frame.bands.low * .025);
    ctx.fillStyle = palette[3];
    ctx.beginPath();
    for (let i = 0; i <= hubSides; i++) {
      const a = i / hubSides * TAU - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * hubR, Math.sin(a) * hubR);
      else ctx.lineTo(Math.cos(a) * hubR, Math.sin(a) * hubR);
    }
    ctx.fill();
    ctx.restore();
  }
}

const preset: VisualizerPreset = {
  id: 'g19-epoch-iris',
  name: 'g19 epoch iris',
  params: [{ id: 'scale', label: 'iris scale', min: .65, max: 1.35, step: .05, default: 1 }],
  create: () => new EpochIrisRenderer(),
};

export default preset;
