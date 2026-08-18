/**
 * The visualizer band seam (realtime-visualization 01). Master-bus FFT
 * magnitudes in → normalized band levels out, shaped through
 * frame-rate-independent ballistics. Pure — no AudioContext, no React: the
 * Mixer's visualizer analyser feeds a spectrum snapshot, this file shapes
 * it, and the visualizer bridge is the glue that samples and broadcasts.
 * Mirrors the split midi/levelMeter.ts uses (pure tested seam, thin glue).
 *
 * The shaping pipeline follows the prior-art consensus
 * (docs/research/audio-visualizer-prior-art.md — cava, audioMotion,
 * Rainmeter AudioLevel, Winamp):
 *
 *   1. spectral tilt: music falls ~-4.5 dB/oct, so a rising +4.5 dB/oct
 *      tilt keeps treble bars as alive as bass bars
 *   2. narrow dB window + gamma for contrast (wide windows read as mush)
 *   3. near-instant attack, ~160 ms release, asymmetric one-pole EMA
 *
 * The 3-band edges follow the isolator EQ crossovers (mixer.ts: 250 /
 * 2500 Hz), so killing an EQ band on a playing channel collapses exactly
 * one visual band. Multiband edges are geometric (Rainmeter/cava style).
 */

/** Isolator crossovers (mixer.ts CROSSOVER_*_HZ) plus outer audible caps. */
export const BAND_EDGES_HZ = {
  lowFloor: 30,
  lowMid: 250,
  midHigh: 2500,
  highCeil: 16000,
} as const;

/** The 3-band edge array (low | mid | high). */
export const THREE_BAND_EDGES = [
  BAND_EDGES_HZ.lowFloor,
  BAND_EDGES_HZ.lowMid,
  BAND_EDGES_HZ.midHigh,
  BAND_EDGES_HZ.highCeil,
];

/** Rising spectral tilt canceling music's pink-ish falloff (prior art:
 * cava's freq^0.85 EQ, audioMotion's C/468 weighting). Applied per bin. */
export const TILT_DB_PER_OCT = 4.5;
export const TILT_REF_HZ = 500;

/** Normalization window: tilted band power in dB mapped to [0, 1]. Narrow
 * on purpose (Rainmeter maps a ~25–35 dB "Sensitivity" window) — a wide
 * window flattens musical dynamics into visual mush. */
export const BAND_DB_FLOOR = -48;
export const BAND_DB_CEIL = -12;

/** Contrast gamma (< 1 lifts quiet detail — audioMotion linearBoost). */
export const BAND_GAMMA = 0.6;

/** Near-instant attack, musical release (prior-art consensus for bars). */
export const BAND_ATTACK_S = 0.008;
export const BAND_RELEASE_S = 0.16;

export interface BandLevels {
  low: number;
  mid: number;
  high: number;
}

export const SILENT_BANDS: BandLevels = { low: 0, mid: 0, high: 0 };

/**
 * Geometric (log-spaced) band edges: count+1 edges from minHz to maxHz,
 * edge[i] = minHz · 2^(i·step) with step = log2(maxHz/minHz)/count
 * (the Rainmeter/cava construction).
 */
export function logBandEdges(minHz: number, maxHz: number, count: number): number[] {
  const step = Math.log2(maxHz / minHz) / count;
  const edges: number[] = [];
  for (let i = 0; i <= count; i++) edges.push(minHz * Math.pow(2, i * step));
  return edges;
}

/**
 * Aggregate FFT bin magnitudes (dB, AnalyserNode.getFloatFrequencyData
 * layout: bin i covers i · sampleRate / fftSize Hz) into normalized levels,
 * one per band described by `edgesHz` (length = bands + 1). Per bin, the
 * spectral tilt is applied in dB, then bins power-average within each band
 * (one hot bin must not read as a full band), and the mean maps through
 * [BAND_DB_FLOOR, BAND_DB_CEIL] and BAND_GAMMA to [0, 1].
 */
export function aggregateMultiband(
  magnitudesDb: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  edgesHz: number[]
): number[] {
  const hzPerBin = sampleRate / fftSize;
  const levels: number[] = [];
  for (let b = 0; b < edgesHz.length - 1; b++) {
    levels.push(bandLevel(magnitudesDb, hzPerBin, edgesHz[b], edgesHz[b + 1]));
  }
  return levels;
}

/** The 3-band aggregation (isolator-aligned) used by the classic presets
 * and the nebula scene. */
export function aggregateBands(
  magnitudesDb: ArrayLike<number>,
  sampleRate: number,
  fftSize: number
): BandLevels {
  const [low, mid, high] = aggregateMultiband(
    magnitudesDb,
    sampleRate,
    fftSize,
    THREE_BAND_EDGES
  );
  return { low, mid, high };
}

function bandLevel(
  magnitudesDb: ArrayLike<number>,
  hzPerBin: number,
  fromHz: number,
  toHz: number
): number {
  let first = Math.max(1, Math.ceil(fromHz / hzPerBin)); // skip DC
  let last = Math.min(magnitudesDb.length - 1, Math.floor(toHz / hzPerBin));
  // Narrow log-spaced bands can fall between bins: widen to ≥1 bin
  // (cava enforces a minimum bandwidth the same way).
  if (last < first) [first, last] = [last, first];
  if (first < 1 || first >= magnitudesDb.length) return 0;
  let powerSum = 0;
  for (let i = first; i <= last; i++) {
    const db = magnitudesDb[i];
    // Analyser silence is -Infinity; contribute zero power, not NaN.
    if (!Number.isFinite(db)) continue;
    const tilted = db + TILT_DB_PER_OCT * Math.log2((i * hzPerBin) / TILT_REF_HZ);
    powerSum += Math.pow(10, tilted / 10);
  }
  const meanPower = powerSum / (last - first + 1);
  if (meanPower <= 0) return 0;
  const meanDb = 10 * Math.log10(meanPower);
  const normalized = clamp01((meanDb - BAND_DB_FLOOR) / (BAND_DB_CEIL - BAND_DB_FLOOR));
  return Math.pow(normalized, BAND_GAMMA);
}

/**
 * One asymmetric exponential-smoother step over `dt` seconds, per level.
 * Rising levels chase the target with BAND_ATTACK_S, falling ones with
 * BAND_RELEASE_S — dt-driven so the sampling cadence is not load-bearing
 * (same rationale as midi/levelMeter.ts smoothLevel).
 */
export function stepLevels(previous: number[], target: number[], dt: number): number[] {
  return target.map((t, i) => stepLevel(previous[i] ?? 0, t, dt));
}

/** stepLevels for the named 3-band shape. */
export function stepBands(previous: BandLevels, target: BandLevels, dt: number): BandLevels {
  return {
    low: stepLevel(previous.low, target.low, dt),
    mid: stepLevel(previous.mid, target.mid, dt),
    high: stepLevel(previous.high, target.high, dt),
  };
}

function stepLevel(previous: number, target: number, dt: number): number {
  const tau = target > previous ? BAND_ATTACK_S : BAND_RELEASE_S;
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-Math.max(0, dt) / tau);
  return previous + (target - previous) * alpha;
}

/**
 * The "monstercat" spatial filter (cava, Rainmeter skins): every bar lifts
 * its neighbors to `level / factor^distance`, so a transient reads as a
 * shape instead of an isolated spike. factor ≈ 1.5–2; larger = tighter.
 * Pure — returns a new array.
 */
export function monstercatSpread(levels: number[], factor = 1.8): number[] {
  const spread = levels.slice();
  for (let z = 0; z < levels.length; z++) {
    for (let m = 0; m < levels.length; m++) {
      if (m === z) continue;
      const lifted = levels[z] / Math.pow(factor, Math.abs(z - m));
      if (lifted > spread[m]) spread[m] = lifted;
    }
  }
  return spread;
}

/**
 * cava's "waves" spatial variant: neighbors get a parabolic skirt
 * (`level - drop · distance²`) instead of the monstercat exponential —
 * bars melt into a smooth mountain silhouette. Pure — returns a new array.
 * With the default drop a full-scale spike reaches zero four bars out.
 */
export function wavesSpread(levels: number[], drop = 1 / 16): number[] {
  const spread = levels.slice();
  for (let z = 0; z < levels.length; z++) {
    for (let m = 0; m < levels.length; m++) {
      if (m === z) continue;
      const de = Math.abs(z - m);
      const skirt = levels[z] - drop * de * de;
      if (skirt > spread[m]) spread[m] = skirt;
    }
  }
  return spread;
}

/**
 * Group a fine multiband array into coarser bands by taking the max of
 * each run of `groupSize` (max = the punchier aggregation, per the
 * prior-art survey). Geometric edges compose exactly: every 3rd edge of a
 * 24-band geometric split IS the 8-band split.
 */
export function maxGroup(levels: number[], groupSize: number): number[] {
  const grouped: number[] = [];
  for (let i = 0; i < levels.length; i += groupSize) {
    let max = 0;
    for (let j = i; j < Math.min(i + groupSize, levels.length); j++) {
      if (levels[j] > max) max = levels[j];
    }
    grouped.push(max);
  }
  return grouped;
}


/**
 * Per-band onset impulses (realtime-visualization 05): the TRANSIENT
 * signal the smoothed levels erase. A slow reference envelope tracks the
 * sustained level per band; the positive delta of the fast target above
 * it is an onset (a kick, a snare, a hat), captured into a hit envelope
 * with instant attack and fast decay. Sustained material (basslines,
 * vocals, pads) sits near zero here while still driving the levels.
 */

/** Reference envelope time constant: what counts as "sustained". */
export const IMPULSE_REF_S = 0.25;
/** Hit envelope decay: how long a hit visibly rings. */
export const IMPULSE_DECAY_S = 0.12;
/** Onset gain: reference-to-target delta scaling into [0, 1]. */
export const IMPULSE_GAIN = 2.5;

export interface ImpulseState {
  /** Slow reference envelope per band. */
  reference: BandLevels;
  /** Current hit envelopes per band. */
  impulse: BandLevels;
}

export const INITIAL_IMPULSE_STATE: ImpulseState = {
  reference: SILENT_BANDS,
  impulse: SILENT_BANDS,
};

/** One impulse step against the RAW (unsmoothed) band targets. */
export function stepImpulses(
  state: ImpulseState,
  target: BandLevels,
  dt: number
): ImpulseState {
  const refAlpha = 1 - Math.exp(-Math.max(0, dt) / IMPULSE_REF_S);
  const decay = Math.exp(-Math.max(0, dt) / IMPULSE_DECAY_S);
  const step = (band: keyof BandLevels) => {
    const onset = Math.min(1, Math.max(0, target[band] - state.reference[band]) * IMPULSE_GAIN);
    return {
      reference: state.reference[band] + (target[band] - state.reference[band]) * refAlpha,
      impulse: Math.max(onset, state.impulse[band] * decay),
    };
  };
  const low = step('low');
  const mid = step('mid');
  const high = step('high');
  return {
    reference: { low: low.reference, mid: mid.reference, high: high.reference },
    impulse: { low: low.impulse, mid: mid.impulse, high: high.impulse },
  };
}

/**
 * Energy trend (realtime-visualization 05): a slow baseline (~6 s) plus
 * "excitement" — sustained energy ABOVE the baseline, i.e. the drop
 * signal. Rises over the first seconds of a drop, returns to zero in
 * breakdowns; presets scale scene intensity with it instead of flicking
 * per frame.
 */
export const TREND_S = 6;
export const EXCITEMENT_GAIN = 3;

export interface EnergyTrend {
  /** Slow energy baseline in [0, 1]. */
  slow: number;
  /** Sustained energy above baseline, clamped to [0, 1]. */
  excitement: number;
}

export const INITIAL_TREND: EnergyTrend = { slow: 0, excitement: 0 };

export function stepTrend(previous: EnergyTrend, energy: number, dt: number): EnergyTrend {
  const alpha = 1 - Math.exp(-Math.max(0, dt) / TREND_S);
  const slow = previous.slow + (energy - previous.slow) * alpha;
  return {
    slow,
    excitement: Math.min(1, Math.max(0, (energy - slow) * EXCITEMENT_GAIN)),
  };
}


/**
 * Normalized spectral centroid over the (log-spaced) multiband levels
 * (realtime-visualization 05): 0 = all energy in the lowest band, 1 = all
 * in the highest, 0.5 = neutral/silence. The realtime "harmonic content"
 * scalar — dark bass passages sit low, bright harmonic material sits
 * high; presets swing hue with it.
 */
export function spectralCentroid(levels: ArrayLike<number>): number {
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < levels.length; i++) {
    sum += levels[i];
    weighted += levels[i] * i;
  }
  if (sum <= 1e-6 || levels.length < 2) return 0.5;
  return weighted / sum / (levels.length - 1);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
