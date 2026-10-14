/**
 * Offline Routine audio render (#377): the real Mixer DSP on an
 * OfflineAudioContext, driven by the PlannedRoutine evaluators instead of
 * the live rAF conductor.
 *
 * Graph: one ChannelStrip PER CAST SLOT (trim → isolator EQ → sweep →
 * fader → Beat FX insert → crossfade@neutral) → program → master Beat FX
 * → recording ceiling → destination. Per-slot strips sidestep deck reuse:
 * a slot's lanes always drive its own strip, exactly what the live
 * occupant rule would have applied to the shared deck.
 *
 * Sources: each slot's trace (the position/rate authority) becomes a list
 * of constant-rate AudioBufferSourceNode segments — sample-accurate jumps
 * and pauses, no drift servo. Lanes and FX are applied at a fixed control
 * rate via suspend/resume so the live `update` paths (ramps, sweep
 * mapping, send gating) run unchanged.
 */
import type { PlannedRoutine, PlannedRoutineSlot } from '../sets/routinePlan';
import { createSlotLanesCursor } from '../sets/routinePlan';
import { ChannelStrip, FLAT_CHANNEL, makeSamplePeakCeiling, rampGain } from '../playback/mixer';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { FilterSettings } from '../playback/filterSettings';
import type { BeatFxSettings } from '../playback/beatFxSettings';
import {
  createBeatFxInsert,
  echoDelaySeconds,
  effectiveBeatFxState,
  flangerPeriodSeconds,
  ECHO_BEATS_DEFAULT,
} from '../playback/beatFx';
import { createBeatFxRepeatNode } from '../playback/worklet/beatFxRepeatNode';
import { routineFxAt } from '../editor/beatFxLane';

/** One constant-rate playback stretch of a slot's track on the mix axis. */
export interface PlaySegment {
  mixStart: number;
  mixEnd: number;
  /** Track seconds at mixStart. */
  trackStart: number;
  /** Track seconds per mix second. */
  rate: number;
}

/** Per-control-step meters captured during the render (#377 review): what
 * the strips actually passed, for the video's knobs/meters/visualizer.
 * Row k covers mix time range.startSec + k·stepSec. */
export interface RenderMeters {
  stepSec: number;
  steps: number;
  /** Per slot (routine.slots order): mean-absolute level, Mixxx style. */
  slot: {
    /** Post-fader, post-FX (what reaches the program bus). */
    post: Float32Array;
    low: Float32Array;
    mid: Float32Array;
    high: Float32Array;
  }[];
  /** Master FFT magnitudes (dB per bin) per step, fftSize/2 bins. */
  masterSpectrum: Float32Array[];
  fftSize: number;
  sampleRate: number;
}

export interface RoutineAudioRenderInput {
  routine: PlannedRoutine;
  /** Decoded track audio, keyed by track id. */
  buffers: ReadonlyMap<number, AudioBuffer>;
  trackBpms: ReadonlyMap<number, number>;
  /** Mix-second range to render. */
  range: { startSec: number; endSec: number };
  sampleRate?: number;
  filterSettings: Readonly<FilterSettings>;
  beatFxSettings: Readonly<BeatFxSettings>;
  /** Control-rate step in samples (multiple of 128). */
  controlStepSamples?: number;
  onProgress?: (fraction: number) => void;
}

export const DEFAULT_RENDER_SAMPLE_RATE = 48000;
const DEFAULT_CONTROL_STEP = 2048;

const beatOf = (routine: PlannedRoutine, mixSec: number): number =>
  (mixSec - routine.beatOriginMixSec) / routine.secPerBeat;
const mixOf = (routine: PlannedRoutine, beat: number): number =>
  routine.beatOriginMixSec + beat * routine.secPerBeat;

/**
 * The slot's trace as constant-rate segments on the mix axis, clipped to
 * `range`, the track's duration and the slot's deck occupancy. Mirrors
 * traceStateAt: a segment leaving a moving point runs to the next point
 * (linear in pos), extrapolates the prior motion into a jump, and the
 * last point extrapolates to the end. Negative positions (silent lead)
 * start the source where the position crosses 0.
 */
export function traceSegments(
  routine: PlannedRoutine,
  slot: PlannedRoutineSlot,
  range: { startSec: number; endSec: number },
  trackDurationSec: number
): PlaySegment[] {
  const out: PlaySegment[] = [];
  const trace = slot.trace;
  const limitSec = Math.min(range.endSec, slot.releaseMixSec);
  const endBeat = beatOf(routine, limitSec);
  const bounds = slot.transportBounds;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    if (!p.moving) continue;
    const next = trace[i + 1];
    let b0 = p.beat;
    let b1 = next ? next.beat : endBeat;
    if (bounds) {
      b0 = Math.max(b0, bounds.startBeat);
      b1 = Math.min(b1, bounds.endBeat);
    }
    if (b1 <= b0) continue;
    const pos0 = p.pos + (b0 - p.beat) * p.ratePerBeat;
    const pos1 = !next || next.jump
      ? p.pos + (b1 - p.beat) * p.ratePerBeat
      : p.pos + (next.pos - p.pos) * ((b1 - p.beat) / (next.beat - p.beat));
    const dBeat = b1 - b0;
    const rate = (pos1 - pos0) / (dBeat * routine.secPerBeat);
    if (!(rate > 0)) continue;
    let mixStart = mixOf(routine, b0);
    let mixEnd = mixOf(routine, b1);
    let trackStart = pos0;
    if (trackStart < 0) {
      mixStart += -trackStart / rate;
      trackStart = 0;
    }
    if (mixStart < range.startSec) {
      trackStart += (range.startSec - mixStart) * rate;
      mixStart = range.startSec;
    }
    mixEnd = Math.min(mixEnd, limitSec);
    // Clip at the track's end.
    const untilTrackEnd = mixStart + (trackDurationSec - trackStart) / rate;
    mixEnd = Math.min(mixEnd, untilTrackEnd);
    if (mixEnd - mixStart <= 1e-4 || trackStart >= trackDurationSec) continue;
    out.push({ mixStart, mixEnd, trackStart, rate });
  }
  return out;
}

/** Deck seconds-per-beat at a trace rate (the echo's beat clock). */
function slotBeatSeconds(routine: PlannedRoutine, slot: PlannedRoutineSlot, trackBpm: number, beat: number): number {
  const base = 60 / (trackBpm * (1 + slot.basePitchPercent / 100));
  const trace = slot.trace;
  if (trace.length === 0 || !(trackBpm > 0)) return routine.secPerBeat;
  let lo = 0;
  let hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (trace[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  const p = trace[lo];
  if (!p.moving || !(p.ratePerBeat > 0)) return base;
  const deckRate = p.ratePerBeat / routine.secPerBeat;
  return 60 / (trackBpm * deckRate);
}

export interface RoutineAudioRenderResult {
  audio: AudioBuffer;
  meters: RenderMeters;
}

const METER_FFT = 1024;
/** Seconds a strip stays live after its last source (echo/reverb tails). */
const ACTIVE_TAIL_SEC = 12;
const MASTER_FFT = 2048;

function meanAbs(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i]);
  return sum / buf.length;
}

export async function renderRoutineAudio(input: RoutineAudioRenderInput): Promise<RoutineAudioRenderResult> {
  const {
    routine, buffers, trackBpms, range, filterSettings, beatFxSettings, onProgress,
  } = input;
  const sampleRate = input.sampleRate ?? DEFAULT_RENDER_SAMPLE_RATE;
  const step = input.controlStepSamples ?? DEFAULT_CONTROL_STEP;
  const durationSec = Math.max(0.1, range.endSec - range.startSec);
  const length = Math.ceil(durationSec * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });

  // Load the TRANS/ROLL worklet before the inserts ask for it, so every
  // insert splices its node before rendering starts.
  await createBeatFxRepeatNode(ctx).catch(() => null);

  // Beat FX inserts only where the routine engages them: every insert
  // carries a convolver, feedback delays and a free-running LFO that keep
  // its graph busy every quantum — on 8 strips that is most of the render.
  const fxTargets = new Set((routine.beatFx?.steps ?? []).filter((st) => st.on).map((st) => st.target));
  const program = ctx.createGain();
  const ceiling = makeSamplePeakCeiling(ctx);
  const masterFx = fxTargets.has('master') ? createBeatFxInsert(ctx) : null;
  if (masterFx) {
    masterFx.updateSettings(beatFxSettings, true);
    masterFx.update(effectiveBeatFxState(null, false, -1, ECHO_BEATS_DEFAULT), true);
    program.connect(masterFx.input);
    masterFx.output.connect(ceiling);
  } else {
    program.connect(ceiling);
  }
  ceiling.connect(ctx.destination);
  const masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = MASTER_FFT;
  masterAnalyser.smoothingTimeConstant = 0;
  ceiling.connect(masterAnalyser);
  const makeMeter = (): AnalyserNode => {
    const a = ctx.createAnalyser();
    a.fftSize = METER_FFT;
    return a;
  };

  interface SlotRig {
    slot: PlannedRoutineSlot;
    strip: ChannelStrip;
    lanes: ReturnType<typeof createSlotLanesCursor>;
    bpm: number;
    meters: { post: AnalyserNode; low: AnalyserNode; mid: AnalyserNode; high: AnalyserNode };
    /** Render-relative seconds the strip can make sound (sources + FX tail). */
    activeFrom: number;
    activeTo: number;
    /** Last applied control signature (skip unchanged steps). */
    last: string;
    /** The strip keeps its Beat FX insert (the routine targets it). */
    hasFx: boolean;
  }
  const rigs: SlotRig[] = [];
  for (const slot of routine.slots) {
    const buffer = buffers.get(slot.trackId);
    if (!buffer) continue;
    const strip = new ChannelStrip(ctx, FLAT_CHANNEL);
    strip.beatFx.updateSettings(beatFxSettings, true);
    strip.crossfadeGain.gain.value = 1; // automation overlay: crossfader pinned neutral
    strip.pflGain.gain.value = 0;
    strip.crossfadeGain.connect(program);
    const hasFx = fxTargets.has(slot.slotId);
    if (!hasFx) {
      strip.faderGain.disconnect(strip.beatFx.input);
      strip.faderGain.connect(strip.crossfadeGain);
      strip.beatFx.dispose();
    }
    let activeFrom = Infinity;
    let activeTo = -Infinity;
    for (const seg of traceSegments(routine, slot, range, buffer.duration)) {
      activeFrom = Math.min(activeFrom, seg.mixStart - range.startSec);
      activeTo = Math.max(activeTo, seg.mixEnd - range.startSec);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = seg.rate;
      src.connect(strip.input);
      const when = seg.mixStart - range.startSec;
      src.start(when, seg.trackStart, (seg.mixEnd - seg.mixStart) * seg.rate);
    }
    const meters = { post: makeMeter(), low: makeMeter(), mid: makeMeter(), high: makeMeter() };
    strip.crossfadeGain.connect(meters.post);
    strip.bandGains.low.connect(meters.low);
    strip.bandGains.mid.connect(meters.mid);
    strip.bandGains.high.connect(meters.high);
    rigs.push({
      slot, strip, lanes: createSlotLanesCursor(slot), bpm: trackBpms.get(slot.trackId) ?? routine.targetBpm, meters,
      activeFrom: activeFrom - 0.5, activeTo: activeTo + ACTIVE_TAIL_SEC, last: '', hasFx,
    });
  }
  // Let the inserts' async worklet splice settle (module already loaded).
  await new Promise((r) => setTimeout(r, 0));

  const applyControls = (mixSec: number, immediate: boolean): void => {
    const beat = beatOf(routine, mixSec);
    const fx = routine.beatFx ? routineFxAt(routine.beatFx, beat) : null;
    const rel = mixSec - range.startSec;
    for (const rig of rigs) {
      const { strip, slot } = rig;
      // Silent strips (before their first source / after the FX tail) cost
      // nothing: the render is bound by these per-step main-thread calls.
      if (!immediate && (rel < rig.activeFrom || rel > rig.activeTo)) continue;
      const v = rig.lanes(beat);
      const engagedHere = !!fx && fx.on && fx.target === slot.slotId;
      const sig = `${v.fader}|${v.trim}|${v.eq.low}|${v.eq.mid}|${v.eq.high}|${v.filter}|${engagedHere ? `${fx!.selected}|${fx!.depth}|${fx!.beats}` : fx?.selected ?? '-'}`;
      if (!immediate && sig === rig.last && !engagedHere) continue;
      rig.last = sig;
      const fader = channelFaderToGain(v.fader);
      const trim = trimToGain(v.trim);
      const eq = {
        low: eqValueToGain(v.eq.low), mid: eqValueToGain(v.eq.mid), high: eqValueToGain(v.eq.high),
      };
      if (immediate) {
        strip.faderGain.gain.value = fader;
        strip.trimGain.gain.value = trim;
        strip.bandGains.low.gain.value = eq.low;
        strip.bandGains.mid.gain.value = eq.mid;
        strip.bandGains.high.gain.value = eq.high;
      } else {
        rampGain(ctx, strip.faderGain.gain, fader);
        rampGain(ctx, strip.trimGain.gain, trim);
        rampGain(ctx, strip.bandGains.low.gain, eq.low);
        rampGain(ctx, strip.bandGains.mid.gain, eq.mid);
        rampGain(ctx, strip.bandGains.high.gain, eq.high);
      }
      strip.sweep.update(filterSettings, v.filter, immediate);
      if (!rig.hasFx) continue;
      const beatSeconds = slotBeatSeconds(routine, slot, rig.bpm, beat);
      const beats = fx?.beats ?? ECHO_BEATS_DEFAULT;
      strip.beatFx.setDelaySeconds(echoDelaySeconds(beats, beatSeconds), immediate);
      strip.beatFx.setFlangerPeriodSeconds(
        flangerPeriodSeconds(beats, beatSeconds, beatFxSettings.flangerLengthUnit), immediate
      );
      const engaged = !!fx && fx.on && fx.target === slot.slotId;
      strip.beatFx.update(
        effectiveBeatFxState(fx?.selected ?? null, engaged, fx?.depth ?? -1, beats), immediate
      );
      if (engaged) {
        strip.beatFx.setClock({ time: ctx.currentTime, beat, beatSeconds });
      }
    }
    if (!masterFx) return;
    const masterEngaged = !!fx && fx.on && fx.target === 'master';
    const mBeats = fx?.beats ?? ECHO_BEATS_DEFAULT;
    masterFx.setDelaySeconds(echoDelaySeconds(mBeats, routine.secPerBeat), immediate);
    masterFx.setFlangerPeriodSeconds(
      flangerPeriodSeconds(mBeats, routine.secPerBeat, beatFxSettings.flangerLengthUnit), immediate
    );
    masterFx.update(
      effectiveBeatFxState(fx?.selected ?? null, masterEngaged, fx?.depth ?? -1, mBeats), immediate
    );
    if (masterEngaged) masterFx.setClock({ time: ctx.currentTime, beat, beatSeconds: routine.secPerBeat });
  };

  applyControls(range.startSec, true);

  // Control loop: suspend at every step boundary, apply, resume. Suspends
  // are scheduled one ahead from inside the handler (the spec forbids
  // scheduling a suspend at or before the current render time).
  const stepSec = step / sampleRate;
  const totalSteps = Math.floor(length / step);
  const meterBuf = new Float32Array(new ArrayBuffer(METER_FFT * 4));
  const slotMeters = routine.slots.map(() => ({
    post: new Float32Array(totalSteps), low: new Float32Array(totalSteps),
    mid: new Float32Array(totalSteps), high: new Float32Array(totalSteps),
  }));
  const rigIndex = new Map(rigs.map((r) => [r.slot, routine.slots.indexOf(r.slot)] as const));
  const masterSpectrum: Float32Array[] = new Array(totalSteps);
  const readMeters = (k: number): void => {
    const rel = k * stepSec;
    for (const rig of rigs) {
      if (rel < rig.activeFrom || rel > rig.activeTo) continue;
      const m = slotMeters[rigIndex.get(rig.slot)!];
      m.post[k] = meanAbs(rig.meters.post, meterBuf);
      m.low[k] = meanAbs(rig.meters.low, meterBuf);
      m.mid[k] = meanAbs(rig.meters.mid, meterBuf);
      m.high[k] = meanAbs(rig.meters.high, meterBuf);
    }
    const spec = new Float32Array(new ArrayBuffer((MASTER_FFT / 2) * 4));
    masterAnalyser.getFloatFrequencyData(spec);
    masterSpectrum[k] = spec;
  };
  readMeters(0);
  let k = 1;
  const scheduleNext = (): void => {
    if (k > totalSteps - 1) return;
    const at = (k * step) / sampleRate;
    const my = k;
    k++;
    void ctx.suspend(at).then(() => {
      // Meters first: the analysers hold the quantum just rendered —
      // the step that ENDED here.
      readMeters(my);
      applyControls(range.startSec + my * stepSec, false);
      if (onProgress && my % 64 === 0) onProgress(my / totalSteps);
      scheduleNext();
      void ctx.resume();
    });
  };
  scheduleNext();
  const rendered = await ctx.startRendering();
  for (let i = 0; i < totalSteps; i++) {
    if (!masterSpectrum[i]) masterSpectrum[i] = masterSpectrum[i - 1] ?? new Float32Array(MASTER_FFT / 2).fill(-120);
  }
  onProgress?.(1);
  return {
    audio: rendered,
    meters: {
      stepSec, steps: totalSteps, slot: slotMeters, masterSpectrum, fftSize: MASTER_FFT, sampleRate,
    },
  };
}

/** Interleaved 16-bit PCM WAV of an AudioBuffer. */
export function encodePcm16Wav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const dataBytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const data = new Int16Array(out, 44, frames * channels);
  for (let c = 0; c < channels; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0, j = c; i < frames; i++, j += channels) {
      const s = Math.max(-1, Math.min(1, src[i]));
      data[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

/**
 * Chunked render (#377 r3): the range splits into ~`chunkSec` pieces, each
 * its own OfflineAudioContext started `prerollSec` early so filter / echo
 * state has settled where its part begins. Pieces render `concurrency` at
 * a time IN ORDER and stitch at control-step boundaries (audio and meters
 * line up exactly with a single render's), and `onPartial` reports the
 * contiguous rendered prefix after each piece — the editor previews the
 * head of a long mix while the rest renders.
 */
export async function renderRoutineAudioChunked(
  input: RoutineAudioRenderInput,
  opts: {
    chunkSec?: number; prerollSec?: number; concurrency?: number;
    onPartial?: (result: RoutineAudioRenderResult, readySec: number) => void;
  } = {}
): Promise<RoutineAudioRenderResult> {
  const sampleRate = input.sampleRate ?? DEFAULT_RENDER_SAMPLE_RATE;
  const step = input.controlStepSamples ?? DEFAULT_CONTROL_STEP;
  const { range } = input;
  const durationSec = Math.max(0.1, range.endSec - range.startSec);
  const n = Math.max(1, Math.round(durationSec / (opts.chunkSec ?? 30)));
  const totalSamples = Math.ceil(durationSec * sampleRate);
  const totalSteps = Math.floor(totalSamples / step);
  const chunkSteps = Math.ceil(totalSteps / n);
  const preSteps = Math.ceil(((opts.prerollSec ?? 6) * sampleRate) / step);
  const stepSec = step / sampleRate;
  const pieces = Array.from({ length: n }, (_, i) => {
    const s0 = Math.min(totalSteps, i * chunkSteps);
    const s1 = i === n - 1 ? totalSteps : Math.min(totalSteps, (i + 1) * chunkSteps);
    const pre = i === 0 ? 0 : Math.min(preSteps, s0);
    return {
      s0, s1, pre,
      range: {
        startSec: range.startSec + (s0 - pre) * stepSec,
        endSec: i === n - 1 ? range.endSec : range.startSec + s1 * stepSec,
      },
    };
  }).filter((p) => p.s1 > p.s0 || n === 1);
  const audio = new AudioBuffer({ length: totalSamples, numberOfChannels: 2, sampleRate });
  const slot = input.routine.slots.map(() => ({
    post: new Float32Array(totalSteps), low: new Float32Array(totalSteps),
    mid: new Float32Array(totalSteps), high: new Float32Array(totalSteps),
  }));
  const masterSpectrum: Float32Array[] = new Array(totalSteps);
  const meters: RenderMeters = { stepSec, steps: totalSteps, slot, masterSpectrum, fftSize: MASTER_FFT, sampleRate };
  const result: RoutineAudioRenderResult = { audio, meters };
  const done = new Array<boolean>(pieces.length).fill(false);
  const fractions = new Array<number>(pieces.length).fill(0);
  const place = (i: number, r: RoutineAudioRenderResult): void => {
    const p = pieces[i];
    const from = p.pre * step;
    const at = p.s0 * step;
    const end = i === pieces.length - 1 ? totalSamples : p.s1 * step;
    const count = Math.max(0, Math.min(end - at, r.audio.length - from));
    for (let c = 0; c < 2; c++) {
      audio.copyToChannel(r.audio.getChannelData(Math.min(c, r.audio.numberOfChannels - 1)).subarray(from, from + count), c, at);
    }
    for (let k = p.s0; k < p.s1; k++) {
      const src = k - p.s0 + p.pre;
      if (src >= r.meters.steps) break;
      r.meters.slot.forEach((m, si) => {
        slot[si].post[k] = m.post[src];
        slot[si].low[k] = m.low[src];
        slot[si].mid[k] = m.mid[src];
        slot[si].high[k] = m.high[src];
      });
      masterSpectrum[k] = r.meters.masterSpectrum[src];
    }
    done[i] = true;
    let prefix = 0;
    while (prefix < pieces.length && done[prefix]) prefix++;
    const readySteps = prefix === pieces.length ? totalSteps : pieces[prefix].s0;
    for (let k = 0; k < readySteps; k++) {
      if (!masterSpectrum[k]) masterSpectrum[k] = masterSpectrum[k - 1] ?? new Float32Array(MASTER_FFT / 2).fill(-120);
    }
    opts.onPartial?.(result, prefix === pieces.length ? durationSec : readySteps * stepSec);
  };
  // In-order pool: piece i starts once a slot frees, so the head lands first.
  let nextPiece = 0;
  const worker = async (): Promise<void> => {
    while (nextPiece < pieces.length) {
      const i = nextPiece++;
      const r = await renderRoutineAudio({
        ...input,
        range: pieces[i].range,
        onProgress: (f) => {
          fractions[i] = f;
          input.onProgress?.(fractions.reduce((a, b) => a + b, 0) / pieces.length);
        },
      });
      place(i, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, pieces.length)) }, worker));
  for (let k = 0; k < totalSteps; k++) {
    if (!masterSpectrum[k]) masterSpectrum[k] = masterSpectrum[k - 1] ?? new Float32Array(MASTER_FFT / 2).fill(-120);
  }
  input.onProgress?.(1);
  return result;
}
