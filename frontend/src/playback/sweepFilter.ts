import { BUTTERWORTH_Q_DB, sweepPositionToFilter } from './graph';
import { FILTER_MODELS, type FilterSettings } from './filterSettings';

/** Target response; Web Audio's low/high-pass Q is expressed in dB. */
export function describeSweepFilter(
  s: Readonly<FilterSettings>,
  position: number,
  sampleRate: number,
) {
  const p = Number.isFinite(position) ? Math.max(-1, Math.min(1, position)) : 0;
  const limit = sampleRate * 0.49;
  if (s.model === 'current') {
    const legacy = sweepPositionToFilter(p);
    const frequency = Math.min(limit, legacy.frequency);
    return {
      type: legacy.type,
      frequency,
      wet: 1,
      gainDb: s.trim,
      stages: [{ frequency, qDb: legacy.qDb }],
    };
  }
  const distance = Math.max(0, Math.abs(p) - s.deadzone);
  const amount = (distance / (1 - s.deadzone)) ** s.curve;
  const type = p < 0 ? 'lowpass' : 'highpass';
  const open = type === 'lowpass' ? Math.min(20000, limit) : 20;
  const end = type === 'lowpass' ? s.lpMin : Math.min(s.hpMax, limit);
  const frequency = open * (end / open) ** amount;
  // Butterworth pole alignments at zero added resonance.
  const qs =
    s.model === 'res48'
      ? [0.50979558, 0.60134489, 0.89997622, 2.56291545]
      : s.model === 'res24'
        ? [0.5411961, 1.30656296]
        : s.model === 'dual'
          ? [Math.SQRT1_2, Math.SQRT1_2]
          : [Math.SQRT1_2];
  return {
    type,
    frequency,
    wet: Math.min(1, distance / 0.07),
    gainDb: s.trim - s.resonance * s.compensation,
    stages: qs.map((q, i) => ({
      frequency: Math.min(
        limit,
        Math.max(
          10,
          frequency * (s.model === 'dual' ? 2 ** ((i - 0.5) * s.spread) : 1),
        ),
      ),
      qDb:
        20 * Math.log10(q) +
        (s.model === 'dual'
          ? s.resonance / 2
          : i === qs.length - 1
            ? s.resonance
            : 0),
    })),
  };
}

/** Linear response including the phase of the dry/wet crossfade, before drive. */
export function sweepResponseDb(
  s: Readonly<FilterSettings>,
  position: number,
  frequencies: Float32Array,
  sampleRate: number,
): number[] {
  const d = describeSweepFilter(s, position, sampleRate);
  if (d.wet === 0) return Array.from(frequencies, () => s.trim);
  return Array.from(frequencies, (hz) => {
    let real = 1,
      imag = 0;
    for (const stage of d.stages) {
      const w = (2 * Math.PI * stage.frequency) / sampleRate;
      const c = Math.cos(w),
        alpha = Math.sin(w) / (2 * 10 ** (stage.qDb / 20));
      const b0 = (d.type === 'lowpass' ? 1 - c : 1 + c) / 2;
      const b1 = d.type === 'lowpass' ? 1 - c : -(1 + c);
      const z = (2 * Math.PI * hz) / sampleRate;
      const nr = b0 + b1 * Math.cos(z) + b0 * Math.cos(2 * z);
      const ni = -b1 * Math.sin(z) - b0 * Math.sin(2 * z);
      const dr =
        1 + alpha - 2 * c * Math.cos(z) + (1 - alpha) * Math.cos(2 * z);
      const di = 2 * c * Math.sin(z) - (1 - alpha) * Math.sin(2 * z);
      const den = dr * dr + di * di;
      const r = (nr * dr + ni * di) / den,
        im = (ni * dr - nr * di) / den;
      [real, imag] = [real * r - imag * im, real * im + imag * r];
    }
    const gain = 10 ** (d.gainDb / 20);
    real = d.wet * real * gain + (1 - d.wet) * 10 ** (s.trim / 20);
    imag *= d.wet * gain;
    return 20 * Math.log10(Math.max(1e-6, Math.hypot(real, imag)));
  });
}

const DRIVE_CURVE = Float32Array.from({ length: 16385 }, (_, i) =>
  Math.tanh(4 * ((2 * i) / 16384 - 1)),
);

/** Owned post-EQ processor. Parallel branches avoid discontinuous biquad type changes. */
export function createSweepFilter(ctx: BaseAudioContext) {
  const input = ctx.createGain(),
    sum = ctx.createGain(),
    output = ctx.createGain();
  const dry = ctx.createGain(),
    clean = ctx.createGain(),
    driveIn = ctx.createGain(),
    driveOut = ctx.createGain(),
    driven = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = DRIVE_CURVE;
  shaper.oversample = '2x';
  input.connect(dry).connect(sum);
  sum.connect(clean).connect(output);
  sum
    .connect(driveIn)
    .connect(shaper)
    .connect(driveOut)
    .connect(driven)
    .connect(output);
  const nodes: AudioNode[] = [
    input,
    sum,
    output,
    dry,
    clean,
    driveIn,
    driveOut,
    driven,
    shaper,
  ];
  const branches = FILTER_MODELS.flatMap((model) =>
    (['lowpass', 'highpass'] as const).map((type) => {
      const count =
        model.id === 'res48' ? 4 : ['res24', 'dual'].includes(model.id) ? 2 : 1;
      const filters = Array.from({ length: count }, () =>
        ctx.createBiquadFilter(),
      );
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let previous: AudioNode = input;
      for (const filter of filters) {
        filter.type = type;
        filter.frequency.value =
          type === 'lowpass' ? Math.min(20000, ctx.sampleRate * 0.49) : 20;
        filter.Q.value = BUTTERWORTH_Q_DB;
        previous.connect(filter);
        previous = filter;
      }
      previous.connect(gain).connect(sum);
      nodes.push(...filters, gain);
      return { model: model.id, type, filters, gain };
    }),
  );
  const targets = new Map<AudioParam, number>();
  let disposed = false;
  let lastSettings: Readonly<FilterSettings> | null = null;
  let lastPosition = NaN;
  function target(
    param: AudioParam,
    value: number,
    immediate: boolean,
    smoothing: number | 'exponential' = 0,
  ) {
    if (!immediate && targets.get(param) === value) return;
    targets.set(param, value);
    const current = param.value;
    param.cancelScheduledValues(ctx.currentTime);
    param.setValueAtTime(immediate ? value : current, ctx.currentTime);
    if (!immediate) {
      if (smoothing === 'exponential')
        param.exponentialRampToValueAtTime(value, ctx.currentTime + 0.035);
      else if (smoothing)
        param.setTargetAtTime(value, ctx.currentTime, smoothing);
      else param.linearRampToValueAtTime(value, ctx.currentTime + 0.035);
    }
  }
  return {
    input,
    output,
    update(s: Readonly<FilterSettings>, position: number, immediate = false) {
      if (disposed) return;
      if (!immediate && lastSettings === s && Object.is(lastPosition, position))
        return;
      lastSettings = s;
      lastPosition = position;
      const d = describeSweepFilter(s, position, ctx.sampleRate);
      target(dry.gain, (1 - d.wet) * 10 ** (s.trim / 20), immediate);
      for (const branch of branches) {
        const selected = branch.model === s.model && branch.type === d.type;
        if (selected) {
          // Initialize a fully silent branch at its target before fading it in.
          const instant = immediate || branch.gain.gain.value === 0;
          branch.filters.forEach((filter, i) => {
            target(
              filter.frequency,
              d.stages[i].frequency,
              instant,
              s.model === 'current' ? 0.015 : s.smoothing / 1000,
            );
            target(
              filter.Q,
              d.stages[i].qDb,
              instant,
              s.model === 'current' ? 0.015 : s.smoothing / 1000,
            );
          });
        }
        target(
          branch.gain.gain,
          selected ? d.wet * 10 ** (d.gainDb / 20) : 0,
          immediate,
        );
      }
      const driveMix = s.model !== 'current' && s.drive > 0 ? d.wet : 0;
      // Reciprocal exponential ramps keep the compensated small-signal gain constant.
      target(driveIn.gain, 10 ** (s.drive / 20) / 4, immediate, 'exponential');
      target(driveOut.gain, 10 ** (-s.drive / 20), immediate, 'exponential');
      target(clean.gain, 1 - driveMix, immediate);
      target(driven.gain, driveMix, immediate);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const param of targets.keys())
        param.cancelScheduledValues(ctx.currentTime);
      for (const node of nodes) node.disconnect();
      targets.clear();
    },
  };
}
