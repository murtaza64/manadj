/**
 * Android visualizer feed (#394 spike): VisualizerFrameData synthesized from
 * what the phone app already has — each deck's desktop waveform bands (MWF1,
 * 8 log bands) looked up at the heard position and weighted by the deck's
 * strip (trim × EQ × fader × crossfader). The 8 bands become a synthetic
 * analyser spectrum so the desktop maths (bands.ts aggregation, ballistics,
 * impulses, trend, regime, dominance) runs unchanged; beat lock comes from
 * the dominant deck's grid (bpm + first-beat anchor).
 */
import {
  aggregateBands, aggregateMultiband, logBandEdges, spectralCentroid, spectralFlatness, spectralSpread,
  stepBands, stepImpulses, stepLevels, stepSlowBands, stepTrend,
  INITIAL_IMPULSE_STATE, INITIAL_TREND, SILENT_BANDS,
  type BandLevels, type EnergyTrend, type ImpulseState,
} from '../visualizer/bands';
import { INITIAL_REGIME, regimeSignal, stepRegime, type RegimeState } from '../visualizer/regime';
import { INITIAL_DOMINANCE, stepDominance, type DominanceState } from '../visualizer/dominance';
import { energyOf } from '../visualizer/style';
import { SPECTRUM_BAND_COUNT, type BeatInfo, type DeckStateInfo } from '../visualizer/channel';
import type { VisualizerFrameData } from '../visualizer/presets/types';

/** One deck as the Android host reports it (VizHost.frame()). */
export interface HostDeck {
  ch: 'A' | 'B' | 'C' | 'D';
  /** 8 band amplitudes (linear RMS, MWF1 BAND_EDGES) at the heard position, post trim + EQ. */
  bands: number[];
  /** Fader × crossfader (0..1). */
  gain: number;
  playing: boolean;
  /** Heard track position, seconds. */
  pos: number;
  /** Grid tempo (null = gridless) and first-beat anchor (track seconds). */
  bpm: number | null;
  anchor: number;
  /** Tempo rate (pitch) — the grid bpm is track-time. */
  rate: number;
  eq: [number, number, number];
  fader: number;
  trackId: number | null;
}

export interface HostFrame {
  decks: HostDeck[];
}

/** MWF1 band edges (backend/waveform_data.py, Waveform.kt BAND_EDGES). */
const MWF_EDGES = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000];
/** Synthetic analyser geometry (AnalyserNode defaults on desktop). */
const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2;
/**
 * Level offset (dB) from MWF band RMS to per-bin analyser magnitude. A
 * full-scale sine reads ≈ −13.5 dB in a Blackman-windowed AnalyserNode bin;
 * tuned by eye on the phone so a loud drop lands near the top of the
 * BAND_DB window like the desktop bridge.
 */
export const BIN_OFFSET_DB = -6;

const binBand = new Int8Array(BINS).fill(-1);
const bandBins = new Array<number>(8).fill(0);
for (let i = 1; i < BINS; i++) {
  const hz = (i * SAMPLE_RATE) / FFT_SIZE;
  for (let b = 0; b < 8; b++) if (hz >= MWF_EDGES[b] && hz < MWF_EDGES[b + 1]) { binBand[i] = b; bandBins[b]++; break; }
}

/** 8 linear band amplitudes → analyser-layout dB magnitudes (band power spread evenly over its bins). */
export function synthSpectrum(bands: ArrayLike<number>, out = new Float32Array(BINS), offsetDb = BIN_OFFSET_DB): Float32Array {
  const perBin = new Array<number>(8);
  for (let b = 0; b < 8; b++) {
    const a = bands[b] ?? 0;
    perBin[b] = a > 1e-6 && bandBins[b] > 0 ? 20 * Math.log10(a) - 10 * Math.log10(bandBins[b]) + offsetDb : -Infinity;
  }
  for (let i = 0; i < BINS; i++) out[i] = binBand[i] < 0 ? -Infinity : perBin[binBand[i]];
  return out;
}

/** Master-bus band amplitudes: decks power-summed after their channel gain. */
export function mixBands(decks: HostDeck[]): number[] {
  const out = new Array<number>(8).fill(0);
  for (const d of decks) {
    if (!d.playing) continue;
    for (let b = 0; b < 8; b++) { const a = (d.bands[b] ?? 0) * d.gain; out[b] += a * a; }
  }
  return out.map(Math.sqrt);
}

function deckLevel(d: HostDeck): number {
  if (!d.playing) return 0;
  let p = 0;
  for (const a of d.bands) p += a * a;
  // Same normalization window as a band: RMS dB over [-48, -12] → 0..1.
  const db = 10 * Math.log10(Math.max(1e-12, p)) + 20 * Math.log10(Math.max(1e-6, d.gain));
  return Math.min(1, Math.max(0, (db + 36) / 30));
}

function gridPosition(d: HostDeck): { beats: number } | null {
  if (!d.bpm || d.bpm <= 0) return null;
  return { beats: ((d.pos - d.anchor) * d.bpm) / 60 };
}

const frac = (x: number) => x - Math.floor(x);
const mod = (x: number, m: number) => ((x % m) + m) % m;

export interface AndroidFeed {
  frameAt(host: HostFrame, dt: number, params: Record<string, number>): VisualizerFrameData;
}

export function createAndroidFeed(): AndroidFeed {
  const edges = logBandEdges(40, 16000, SPECTRUM_BAND_COUNT);
  const spec = new Float32Array(BINS);
  let bands: BandLevels = SILENT_BANDS;
  let bandsSlow: BandLevels = SILENT_BANDS;
  let spectrum: number[] = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);
  let impulse: ImpulseState = INITIAL_IMPULSE_STATE;
  let trend: EnergyTrend = INITIAL_TREND;
  let regime: RegimeState = INITIAL_REGIME;
  let dominance: DominanceState = INITIAL_DOMINANCE;
  let time = 0;
  return {
    frameAt(host, dt, params) {
      time += dt;
      synthSpectrum(mixBands(host.decks), spec);
      const bandTarget = aggregateBands(spec, SAMPLE_RATE, FFT_SIZE);
      const spectrumTarget = aggregateMultiband(spec, SAMPLE_RATE, FFT_SIZE, edges);
      bands = stepBands(bands, bandTarget, dt);
      bandsSlow = stepSlowBands(bandsSlow, bandTarget, dt);
      spectrum = stepLevels(spectrum, spectrumTarget, dt);
      impulse = stepImpulses(impulse, bandTarget, dt);
      trend = stepTrend(trend, energyOf(bandTarget), dt);
      regime = stepRegime(regime, bandTarget, dt);

      const decks: DeckStateInfo[] = host.decks.map((d) => {
        const g = d.playing ? gridPosition(d) : null;
        return {
          channel: d.ch,
          level: deckLevel(d),
          playing: d.playing,
          trackId: d.trackId,
          beatPhase: g ? frac(g.beats) : null,
          barPhase: g ? mod(g.beats, 4) / 4 : null,
          beatInBar: g ? Math.floor(mod(g.beats, 4)) : null,
          beatsPerBar: 4,
          bpm: d.bpm ? d.bpm * d.rate : null,
          eq: { low: d.eq[0], mid: d.eq[1], high: d.eq[2] },
          fader: d.fader,
        };
      });
      dominance = stepDominance(dominance, decks.map((d) => ({ id: d.channel, level: d.level, eligible: d.playing && d.level > 0.02 })), dt);
      const dominantChannel = (dominance.dominantId as DeckStateInfo['channel'] | null) ?? null;
      const dom = host.decks.find((d) => d.ch === dominantChannel);
      const g = dom ? gridPosition(dom) : null;
      const beat: BeatInfo | null = g && dom ? {
        phase: frac(g.beats),
        barPhase: mod(g.beats, 4) / 4,
        beatInBar: Math.floor(mod(g.beats, 4)),
        beatsPerBar: 4,
        barIndex: Math.floor(g.beats / 4),
        ladderBarIndex: g.beats >= 0 ? Math.floor(g.beats / 4) : null,
        bpm: dom.bpm ? dom.bpm * dom.rate : null,
      } : null;
      return {
        bands, bandsSlow, spectrum, wave: null, beat,
        impulse: impulse.impulse, trend, regime: regimeSignal(regime),
        centroid: spectralCentroid(spectrum), spread: spectralSpread(spectrum), flatness: spectralFlatness(spectrum),
        decks, dominantChannel, params, time, dt,
      };
    },
  };
}
