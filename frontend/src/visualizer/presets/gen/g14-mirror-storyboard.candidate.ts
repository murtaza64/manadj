/** g14-mirror-storyboard: Mirror Ladder retold as a flat stereo stage. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

class MirrorStoryboardRenderer implements PresetRenderer {
  private angle = 0;
  private lastBar: number | null = null;
  private inversion = false;
  private chapter = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const slow = frame.bandsSlow ?? frame.bands;
    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
    if (tierBar !== null && tierBar !== this.lastBar) {
      if (this.lastBar !== null && mod(tierBar, 8) === 0) this.chapter++;
      if (this.lastBar !== null && mod(tierBar, 16) === 0) this.inversion = !this.inversion;
      this.lastBar = tierBar;
      this.angle = mod(tierBar, 4) * Math.PI / 2;
    } else if (tierBar === null) {
      this.angle += frame.dt * (0.08 + slow.mid * 0.18);
    }

    const bar = tierBar === null ? 0 : mod(tierBar, 8);
    const panels = Math.min(4, 1 + Math.floor(bar / 2));
    const hue = mod(frame.centroid * 300 + this.chapter * 71, 360);
    const bgHue = mod(hue + (this.inversion ? 0 : 180), 360);
    const fgHue = mod(hue + (this.inversion ? 180 : 0), 360);
    ctx.fillStyle = `hsl(${bgHue}, 90%, 7%)`;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const stageW = unit * 0.78 * (frame.params.scale ?? 1);
    const stageH = unit * 0.58 * (frame.params.scale ?? 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    for (let panel = 0; panel < panels; panel++) {
      const inset = panel * unit * 0.035;
      ctx.strokeStyle = `hsl(${mod(fgHue + panel * 34, 360)}, 100%, ${48 + panel * 6}%)`;
      ctx.lineWidth = Math.max(2, unit * 0.008);
      ctx.strokeRect(-stageW / 2 + inset, -stageH / 2 + inset, stageW - inset * 2, stageH - inset * 2);
    }

    const spectrum = frame.spectrum;
    const columns = Math.min(24, spectrum.length);
    const gap = stageW * 0.003;
    const bw = (stageW * 0.47 - gap * columns) / Math.max(1, columns);
    for (let i = 0; i < columns; i++) {
      const level = clamp(spectrum[i] ?? 0);
      const h = Math.max(1, level * stageH * 0.42 + frame.impulse.low * (i < 8 ? stageH * 0.04 : 0));
      const x = gap + i * (bw + gap);
      const light = 43 + level * 28;
      ctx.fillStyle = `hsl(${mod(fgHue + i * 5, 360)}, 100%, ${light}%)`;
      ctx.fillRect(x, -h, bw, h * 2);
      ctx.fillRect(-x - bw, -h, bw, h * 2);
    }

    const wave = frame.wave;
    const samples = wave ? Math.min(wave.left.length, wave.right.length, 256) : 96;
    const waveGain = frame.params.fold ?? 1;
    const drawFold = (side: -1 | 1) => {
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const source = wave
          ? side < 0 ? wave.left : wave.right
          : null;
        const index = source ? Math.floor((i / samples) * source.length) : 0;
        const sample = source ? source[index] : Math.sin(i * 0.35 + frame.time * 2) * slow.high * 0.2;
        const y = -stageH / 2 + (i / Math.max(1, samples - 1)) * stageH;
        const x = side * (unit * 0.018 + Math.abs(sample) * stageW * 0.2 * waveGain);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsl(${mod(fgHue + (side < 0 ? 70 : 290), 360)}, 100%, 70%)`;
      ctx.lineWidth = Math.max(2, unit * 0.004);
      ctx.stroke();
    };
    drawFold(-1);
    drawFold(1);
    ctx.restore();

    const beatPulse = frame.beat ? Math.pow(1 - frame.beat.phase, 4) : frame.impulse.low;
    ctx.fillStyle = `hsla(${fgHue}, 100%, 68%, ${0.25 + beatPulse * 0.7})`;
    const marker = unit * (0.018 + beatPulse * 0.025);
    ctx.fillRect(cx - marker, cy - marker, marker * 2, marker * 2);

    const bpm = frame.beat?.bpm ?? 0;
    const story = ['OPEN', 'BUILD', 'FOLD', 'PAYOFF'][Math.min(3, panels - 1)];
    ctx.font = `700 ${Math.max(12, unit * 0.025)}px monospace`;
    ctx.fillStyle = `hsl(${fgHue}, 100%, 66%)`;
    ctx.fillText(`${story}  ${Math.round(bpm)} BPM`, width * 0.04, height * 0.08);
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'stage scale', min: 0.65, max: 1.2, step: 0.05, default: 1 },
  { id: 'fold', label: 'stereo fold', min: 0.4, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-mirror-storyboard',
  name: 'g14 mirror-storyboard',
  wantsWave: true,
  params,
  create: () => new MirrorStoryboardRenderer(),
};

export default preset;
