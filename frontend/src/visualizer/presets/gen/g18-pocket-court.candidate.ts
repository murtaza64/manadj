import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const COLORS = ['#ff2b6a', '#00e5ff', '#ffe600', '#74ff00'];

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function smooth(x: number): number { const t = clamp01(x); return t * t * (3 - 2 * t); }
function mod(x: number, n: number): number { return ((x % n) + n) % n; }
function seedOf(frame: VisualizerFrameData): number {
  return frame.decks.find((d) => d.channel === frame.dominantChannel)?.trackId ?? 18;
}

class PocketCourtRenderer implements PresetRenderer {
  private freeBeat = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    const fallbackHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 1.3 + slow.mid * 0.7;
    this.freeBeat += dt * fallbackHz;
    const beat = frame.beat;
    if (beat) {
      const tier = beat.ladderBarIndex ?? beat.barIndex;
      this.freeBeat = tier * beat.beatsPerBar + beat.beatInBar + beat.phase;
    }
    const phase = beat?.phase ?? mod(this.freeBeat, 1);
    const active = beat?.beatInBar ?? mod(Math.floor(this.freeBeat), 4);
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : Math.floor(this.freeBeat / 4);
    const seed = seedOf(frame);
    const swing = frame.params.swing ?? 0.62;
    const leanGain = frame.params.lean ?? 1;
    const anticipate = smooth((phase - swing) / (1 - swing));
    const rebound = phase * Math.exp(1 - phase * 7.5) * 7.5;
    const tempoScale = Math.max(0.75, Math.min(1.25, (beat?.bpm ?? 120) / 120));
    const offbeat = Math.exp(-Math.pow((phase - 0.5) * 9, 2));
    const drop = Math.max(frame.regime?.dropTransition ?? 0, frame.regime?.sustained ?? 0);

    ctx.fillStyle = '#090b18';
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const floor = height * 0.72;
    const spacing = width * (frame.params.spacing ?? 0.18);
    const start = width / 2 - spacing * 1.5;

    ctx.fillStyle = '#171a32';
    ctx.fillRect(0, floor, width, height - floor);
    for (let i = 0; i < 4; i++) {
      const x = start + i * spacing;
      const isActive = i === active;
      const isAnticipating = i === mod(active + 1, 4);
      const passed = i < active;
      const color = COLORS[mod(i + seed, COLORS.length)];
      ctx.fillStyle = passed ? color : '#303553';
      ctx.fillRect(x - unit * 0.045, floor + unit * 0.035, unit * 0.09, unit * 0.012);

      const crouch = isAnticipating ? anticipate * unit * 0.09 : 0;
      const lift = isActive ? rebound * unit * (0.018 + frame.impulse.low * 0.025) * tempoScale : 0;
      const answer = i === mod(active + 1, 4) ? offbeat * (0.75 + frame.impulse.high * 0.25) : 0;
      const lean = (isAnticipating ? -anticipate : answer) * unit * 0.07 * leanGain;
      const bodyY = floor - unit * 0.19 + crouch - lift - answer * unit * 0.025;
      const bodyH = unit * (0.13 + drop * 0.025);

      ctx.save();
      ctx.translate(x, bodyY);
      ctx.rotate(lean / unit);
      ctx.fillStyle = color;
      ctx.fillRect(-unit * 0.032, -bodyH * 0.15, unit * 0.064, bodyH);
      ctx.beginPath();
      ctx.arc(0, -bodyH * 0.32, unit * 0.035, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = unit * 0.018;
      ctx.beginPath();
      ctx.moveTo(-unit * 0.018, bodyH * 0.82);
      ctx.lineTo(-unit * 0.04 - lean * 0.25, floor - bodyY);
      ctx.moveTo(unit * 0.018, bodyH * 0.82);
      ctx.lineTo(unit * 0.04 - lean * 0.25, floor - bodyY);
      ctx.stroke();
      ctx.restore();

      if (isActive) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, unit * 0.004);
        ctx.strokeRect(x - unit * 0.065, floor + unit * 0.02, unit * 0.13, unit * 0.04);
      }
    }
    ctx.fillStyle = COLORS[mod(Math.floor(tierBar / 16) + seed, COLORS.length)];
    ctx.fillRect(start - spacing * 0.2, height * 0.88, spacing * 3.4, unit * 0.012);
  }
}

const preset: VisualizerPreset = {
  id: 'g18-pocket-court', name: 'g18 pocket court',
  params: [
    { id: 'swing', label: 'anticipation point', min: 0.5, max: 0.82, step: 0.01, default: 0.62 },
    { id: 'lean', label: 'body lean', min: 0.4, max: 1.6, step: 0.05, default: 1 },
    { id: 'spacing', label: 'court spacing', min: 0.13, max: 0.24, step: 0.01, default: 0.18 },
  ],
  create: () => new PocketCourtRenderer(),
};
export default preset;
