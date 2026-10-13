import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(x: number, n: number): number { return ((x % n) + n) % n; }
function seedOf(frame: VisualizerFrameData): number {
  return frame.decks.find((d) => d.channel === frame.dominantChannel)?.trackId ?? 72;
}

class MeterPendulumRenderer implements PresetRenderer {
  private clock = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    const fallbackHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 1.2 + slow.low * 0.6;
    this.clock += dt * fallbackHz;
    const beat = frame.beat;
    if (beat) {
      const tier = beat.ladderBarIndex ?? beat.barIndex;
      this.clock = tier * beat.beatsPerBar + beat.beatInBar + beat.phase;
    }
    const rawPhase = beat?.phase ?? mod(this.clock, 1);
    const active = beat?.beatInBar ?? mod(Math.floor(this.clock), 4);
    const bar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : Math.floor(this.clock / 4);
    const buildup = frame.regime?.buildup ?? 0;
    const fluid = Math.max(
      frame.regime?.dropTransition ?? 0,
      frame.regime?.sustained ?? 0,
      frame.trend.excitement * 0.25
    );
    const steps = Math.max(2, Math.round(frame.params.quantization ?? 8));
    const stepped = Math.floor(rawPhase * steps) / steps;
    const quantized = buildup * (1 - fluid);
    const phase = rawPhase * (1 - quantized) + stepped * quantized;
    const arc = (frame.params.arc ?? 0.72) * (0.82 + frame.spread * 0.28);
    const seed = seedOf(frame);

    ctx.fillStyle = '#100917';
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const top = height * 0.2;
    const left = width * 0.14;
    const span = width * 0.72;

    ctx.fillStyle = `hsl(${mod(seed * 17 + bar * 31, 360)}, 100%, 54%)`;
    ctx.fillRect(left, top - unit * 0.025, span, unit * 0.025);

    for (let i = 0; i < 4; i++) {
      const px = left + span * (i + 0.5) / 4;
      const isActive = i === active;
      const counterPose = (i - active) * Math.PI / 6;
      // The active angle is exactly zero whenever rawPhase is zero.
      const angle = isActive
        ? Math.sin(phase * Math.PI * 2) * arc
        : counterPose;
      const length = unit * (isActive
        ? 0.33 + frame.centroid * 0.05 + (frame.spectrum[i * 5] ?? 0) * 0.07
        : 0.34 + i * 0.012);
      const bx = px + Math.sin(angle) * length;
      const by = top + Math.cos(angle) * length;
      const hue = mod(seed * 17 + i * 83, 360);

      ctx.strokeStyle = isActive ? '#ffffff' : `hsl(${hue}, 90%, 38%)`;
      ctx.lineWidth = unit * (isActive ? 0.012 : 0.006);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = `hsl(${hue}, ${100 - frame.flatness * 18}%, ${isActive ? 58 : 43}%)`;
      const bob = unit * (frame.params.bobSize ?? 0.045) * (1 + (isActive ? frame.impulse.low * 0.28 : 0));
      if (frame.flatness > 0.55) ctx.fillRect(bx - bob, by - bob, bob * 2, bob * 2);
      else { ctx.beginPath(); ctx.arc(bx, by, bob, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = i === active ? '#ffffff' : '#584c62';
      ctx.fillRect(px - unit * 0.018, top - unit * 0.055, unit * 0.036, unit * 0.036);
    }

    const barPhase = beat?.barPhase ?? mod(this.clock / 4, 1);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < active || (i === active && barPhase > 0) ? `hsl(${mod(seed * 17 + i * 83, 360)}, 100%, 50%)` : '#34283a';
      ctx.fillRect(left + i * span / 4 + unit * 0.01, height * 0.82, span / 4 - unit * 0.02, unit * 0.035);
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g18-meter-pendulum', name: 'g18 meter pendulum',
  params: [
    { id: 'arc', label: 'swing arc', min: 0.3, max: 1.15, step: 0.05, default: 0.72 },
    { id: 'bobSize', label: 'bob size', min: 0.025, max: 0.08, step: 0.005, default: 0.045 },
    { id: 'quantization', label: 'buildup steps', min: 2, max: 16, step: 1, default: 8 },
  ],
  create: () => new MeterPendulumRenderer(),
};
export default preset;
