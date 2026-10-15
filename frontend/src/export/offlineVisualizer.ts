/**
 * Offline visualizer feed (#377 review): VisualizerFrameData synthesized
 * from the render's meters (master FFT per control step, per-slot levels)
 * and the Routine clock — the same ballistics the live VisualizerBridge
 * runs, stepped per video frame, so any registered preset renders behind
 * the Routine video exactly as it would over the live Master bus.
 */
import {
  aggregateBands, aggregateMultiband, logBandEdges, spectralCentroid, spectralFlatness,
  spectralSpread, stepBands, stepImpulses, stepLevels, stepSlowBands, stepTrend,
  INITIAL_IMPULSE_STATE, INITIAL_TREND, SILENT_BANDS,
  type BandLevels, type EnergyTrend, type ImpulseState,
} from '../visualizer/bands';
import { INITIAL_REGIME, regimeSignal, stepRegime, type RegimeState } from '../visualizer/regime';
import { energyOf } from '../visualizer/style';
import { SPECTRUM_BAND_COUNT, type DeckStateInfo } from '../visualizer/channel';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../visualizer/presets/types';
import { PRESETS, presetById } from '../visualizer/presets/index';
import { g02MateriaPreset } from '../visualizer/presets/gen/g02-materia.candidate';
import { g05MateriaMercuryPreset } from '../visualizer/presets/gen/g05-materia-mercury.candidate';
import { candidateIds, ensureCandidate, getCachedCandidate } from '../visualizer/presets/gen';
import type { PlannedRoutine } from '../sets/routinePlan';
import { routineSlotStateAt, slotLanesAt, slotOccupyingDeckAt, ROUTINE_DECK_ORDER } from '../sets/routinePlan';
import type { RenderMeters } from './routineAudioRender';
import { meterLevel } from './meterMath';
import { buildUpAt, type ClipMetric } from './clipMetric';

/** Registered presets plus the two "materia" candidates the review asked for. */
export const EXPORT_PRESETS: VisualizerPreset[] = [...PRESETS, g02MateriaPreset, g05MateriaMercuryPreset];
export const DEFAULT_EXPORT_PRESET = 'voyage';

/** Resolve a preset id: curated / bundled first, then a loaded genepool
 * candidate (see ensureExportPresets); unknown or not-yet-loaded ids fall
 * back to the default (callers check `.id` before caching). */
export function exportPresetById(id: string): VisualizerPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? getCachedCandidate(id) ?? presetById(DEFAULT_EXPORT_PRESET);
}

/** Load the genepool candidates among `ids` (lazy modules). */
export async function ensureExportPresets(ids: Iterable<string>): Promise<void> {
  const curated = new Set(EXPORT_PRESETS.map((p) => p.id));
  await Promise.all(Array.from(new Set(ids)).filter((id) => !curated.has(id)).map((id) => ensureCandidate(id)));
}

export function isPresetLoaded(id: string): boolean {
  return EXPORT_PRESETS.some((p) => p.id === id) || !!getCachedCandidate(id);
}

interface GenepoolEntry {
  generation?: number; status?: string; score?: number; rating?: number; approvals?: number; wins?: number; brief?: string;
}
const genepool = (Object.values(import.meta.glob('../visualizer/presets/gen/genepool.json', { eager: true }))[0] as
  { default?: { candidates?: Record<string, GenepoolEntry> } } | undefined)?.default?.candidates ?? {};

export interface PresetListing {
  id: string;
  name: string;
  source: 'curated' | 'genepool';
  generation: number | null;
  /** Arena thumbs score: (wins + approvals) − (losses + rejections). */
  score: number;
  /** Arena approvals + wins (the "likes"). */
  approvals: number;
  rating: number;
  status: 'curated' | 'alive' | 'dead';
  brief: string;
}

const prettify = (id: string): string =>
  id.replace(/^g\d+-/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Every preset the clip can use: the curated set (scored via its g00
 * seed) plus the whole genepool. */
export function presetCatalogue(): PresetListing[] {
  const out: PresetListing[] = [];
  const seen = new Set<string>();
  const entry = (e: GenepoolEntry | undefined) => ({
    score: e?.score ?? 0, approvals: (e?.approvals ?? 0) + (e?.wins ?? 0), rating: e?.rating ?? 1000, brief: e?.brief ?? '',
  });
  for (const p of EXPORT_PRESETS) {
    const g = genepool[p.id] ?? genepool[`g00-${p.id}`];
    out.push({ id: p.id, name: p.name, source: PRESETS.includes(p) ? 'curated' : 'genepool', generation: g?.generation ?? null,
      status: PRESETS.includes(p) ? 'curated' : g?.status === 'dead' ? 'dead' : 'alive', ...entry(g) });
    seen.add(p.id);
  }
  const curatedSeeds = new Set(PRESETS.map((p) => `g00-${p.id}`));
  for (const id of candidateIds()) {
    if (seen.has(id) || curatedSeeds.has(id)) continue;
    const g = genepool[id];
    out.push({ id, name: prettify(id), source: 'genepool', generation: g?.generation ?? Number(/^g(\d+)/.exec(id)?.[1] ?? 0),
      status: g?.status === 'dead' ? 'dead' : 'alive', ...entry(g) });
  }
  return out;
}

/** A preset's params: declared defaults with the clip's overrides on top. */
export function presetParamsFor(id: string, overrides?: Record<string, number> | null): Record<string, number> {
  return { ...presetParamDefaults(exportPresetById(id)), ...(overrides ?? {}) };
}

const SPECTRUM_EDGES = logBandEdges(40, 16000, SPECTRUM_BAND_COUNT);
const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);

export interface OfflineVisualizerFeed {
  frameAt(t: number, dt: number, params: Record<string, number>): VisualizerFrameData;
}

export function createOfflineVisualizerFeed(
  meters: RenderMeters, routine: PlannedRoutine, startSec: number, metric?: ClipMetric | null
): OfflineVisualizerFeed {
  const drops = (metric?.events ?? []).filter((e) => e.drop).map((e) => e.t);
  let bands: BandLevels = SILENT_BANDS;
  let bandsSlow: BandLevels = SILENT_BANDS;
  let spectrum: number[] = SILENT_SPECTRUM;
  let impulse: ImpulseState = INITIAL_IMPULSE_STATE;
  let trend: EnergyTrend = INITIAL_TREND;
  let regime: RegimeState = INITIAL_REGIME;
  let time = 0;
  const stepOf = (t: number): number =>
    Math.max(0, Math.min(meters.steps - 1, Math.floor((t - startSec) / meters.stepSec)));

  const readDecks = (t: number): DeckStateInfo[] => {
    const beat = (t - routine.beatOriginMixSec) / routine.secPerBeat;
    const k = stepOf(t);
    const out: DeckStateInfo[] = [];
    for (const deck of ROUTINE_DECK_ORDER) {
      const slot = slotOccupyingDeckAt(routine, deck, t);
      if (!slot) continue;
      const i = routine.slots.indexOf(slot);
      const s = routineSlotStateAt(routine, slot, t);
      const lanes = slotLanesAt(slot, beat);
      const phase = beat - Math.floor(beat);
      out.push({
        channel: deck,
        level: meterLevel(meters.slot[i]?.post[k] ?? 0),
        playing: s.playing,
        trackId: slot.trackId,
        beatPhase: s.playing ? phase : null,
        barPhase: s.playing ? (((beat % 4) + 4) % 4) / 4 : null,
        beatInBar: s.playing ? ((Math.floor(beat) % 4) + 4) % 4 : null,
        beatsPerBar: 4,
        bpm: routine.targetBpm,
        eq: lanes.eq,
        fader: lanes.fader,
      });
    }
    return out;
  };

  return {
    frameAt(t, dt, params) {
      time += dt;
      const spec = meters.masterSpectrum[stepOf(t)];
      const bandTarget = spec ? aggregateBands(spec, meters.sampleRate, meters.fftSize) : SILENT_BANDS;
      const spectrumTarget = spec
        ? aggregateMultiband(spec, meters.sampleRate, meters.fftSize, SPECTRUM_EDGES)
        : SILENT_SPECTRUM;
      bands = stepBands(bands, bandTarget, dt);
      bandsSlow = stepSlowBands(bandsSlow, bandTarget, dt);
      spectrum = stepLevels(spectrum, spectrumTarget, dt);
      impulse = stepImpulses(impulse, bandTarget, dt);
      trend = stepTrend(trend, energyOf(bandTarget), dt);
      regime = stepRegime(regime, bandTarget, dt);
      const beat = (t - routine.beatOriginMixSec) / routine.secPerBeat;
      const decks = readDecks(t);
      let dominant: DeckStateInfo | null = null;
      for (const d of decks) if (!dominant || d.level > dominant.level) dominant = d;
      // Hypermeter beat (#377 r3): the dominant track's bars, anchored at
      // its drop (hot cue 4), so phrase/section tiers roll over on the
      // music's real boundaries.
      const domSlot = metric ? metric.dominantAt(t) : -1;
      const mp = metric && domSlot >= 0 ? metric.positionAt(domSlot, t) : null;
      if (domSlot >= 0) {
        const deck = routine.slots[domSlot]?.deck;
        const d = decks.find((x) => x.channel === deck);
        if (d) dominant = d;
      }
      const beatInfo = mp ? {
        phase: mp.phase,
        barPhase: (mp.beatInBar + mp.phase) / 4,
        beatInBar: mp.beatInBar,
        beatsPerBar: 4,
        barIndex: mp.bar,
        ladderBarIndex: mp.bar,
        bpm: routine.targetBpm,
      } : beat >= 0 ? {
        phase: beat - Math.floor(beat),
        barPhase: (((beat % 4) + 4) % 4) / 4,
        beatInBar: ((Math.floor(beat) % 4) + 4) % 4,
        beatsPerBar: 4,
        barIndex: Math.floor(beat / 4),
        ladderBarIndex: Math.floor(beat / 4),
        bpm: routine.targetBpm,
      } : null;
      // Known drops land as the regime's drop transition.
      let reg = regimeSignal(regime);
      let lastDrop = -Infinity;
      for (const d of drops) if (d <= t) lastDrop = d;
      if (reg && t - lastDrop < 6) {
        const age = t - lastDrop;
        reg = { ...reg, dropTransition: Math.max(reg.dropTransition, Math.exp(-age * 1.2)), dropAgeS: Math.min(reg.dropAgeS, age) };
      }
      // ...and the 16 bars before one are its build-up, whatever the energy says.
      const build = buildUpAt(drops, t, routine.secPerBeat * 4);
      if (reg && build > 0) reg = { ...reg, buildup: Math.max(reg.buildup, build), sustained: reg.sustained * (1 - build) };
      return {
        bands, bandsSlow, spectrum, wave: null,
        beat: beatInfo,
        impulse: impulse.impulse,
        trend,
        regime: reg,
        centroid: spectralCentroid(spectrum),
        spread: spectralSpread(spectrum),
        flatness: spectralFlatness(spectrum),
        decks,
        dominantChannel: dominant?.channel ?? null,
        params,
        time,
        dt,
      };
    },
  };
}

/** A preset renderer bound to its own backing canvas at a fixed size. */
export interface BackgroundLayer {
  canvas: HTMLCanvasElement;
  render(frame: VisualizerFrameData): void;
  dispose(): void;
}

export function createBackgroundLayer(preset: VisualizerPreset, width: number, height: number): BackgroundLayer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const renderer: PresetRenderer = preset.create();
  return {
    canvas,
    render(frame) {
      renderer.render(ctx, width, height, frame);
    },
    dispose() {
      renderer.dispose?.();
    },
  };
}

export function presetParamDefaults(preset: VisualizerPreset): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of preset.params ?? []) out[p.id] = p.default;
  return out;
}
