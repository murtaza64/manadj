/**
 * Clip → portrait MP4 (#377). Orchestrates: resolve the clip's source to
 * a RoutineDetail (Routine, Transition projection, candidate / Routine
 * Take / Session-span promotion preview), load the cast's audio /
 * waveforms / grids / cues, build the PlannedRoutine (the same build the
 * Mix editor plays), render the audio offline through the real Mixer
 * DSP, paint frames at exact instants over the visualizer programme, and
 * stream both to the backend muxer (ffmpeg) under <data root>/exports/.
 */
import { api, API_BASE, type RoutineDetailWire } from '../api/client';
import type { HotCue, Track } from '../types';
import type { Transition } from '../editor/mixModel';
import { decodeWaveformBlob } from '../waveform/blob';
import { getSlot } from '../waveform/styleSlots';
import { loadFilterSettings } from '../playback/filterSettings';
import { loadBeatFxSettings } from '../playback/beatFxSettings';
import { buildEditorRoutine } from '../routines/routineEditorModel';
import { transitionToProjection } from '../editor/pairSlotTranslation';
import type { RoutineEdits } from '../routines/routineDraft';
import type { PlannedRoutine } from '../sets/routinePlan';
import { routineActions } from './routineActions';
import {
  DEFAULT_RENDER_SAMPLE_RATE, encodePcm16Wav, renderRoutineAudioChunked, type RenderMeters,
} from './routineAudioRender';
import { drawRoutineFrame, SCENE_H, SCENE_W, type RoutineScene, type SceneTrack } from './routineVideoScene';
import {
  createBackgroundLayer, createOfflineVisualizerFeed, ensureExportPresets, exportPresetById, presetParamsFor,
  type BackgroundLayer,
} from './offlineVisualizer';
import { overlayAt, programmeFrame, programmePresetIds, vizAt, type ClipSource, type ClipSpec } from './clipSpec';
import { FONT_MONO } from '../theme/tokens';
import {
  autoVizCues, buildClipMetric, buildTrackMetric, DEFAULT_AUTO_VIZ, type ClipMetric, type TrackMetric,
} from './clipMetric';

export interface ExportProgress {
  stage: 'load' | 'audio' | 'frames' | 'mux' | 'done';
  fraction: number;
  detail?: string;
}

export interface LoadedClip {
  detail: RoutineDetailWire;
  routine: PlannedRoutine;
  scene: RoutineScene;
  trackBpms: Map<number, number>;
  tracks: Map<number, Track>;
  trackMetrics: Map<number, TrackMetric>;
}

// ── Source resolution ────────────────────────────────────────────────────

interface ResolvedSource {
  detail: RoutineDetailWire;
  castBpms: number[];
  targetBpm: number;
  edits?: RoutineEdits | null;
  title: string;
}

async function fetchTracks(ids: number[]): Promise<Map<number, Track>> {
  const rows = await Promise.all(ids.map((id) => api.tracks.getById(id) as Promise<Track>));
  const out = new Map<number, Track>();
  rows.forEach((t, i) => out.set(ids[i], t));
  return out;
}

function derivedTitle(detail: RoutineDetailWire, tracks: Map<number, Track>, kind: string): string {
  if (detail.name) return detail.name;
  const first = tracks.get(detail.cast[0]);
  const last = tracks.get(detail.cast[detail.cast.length - 1]);
  const t = (x: Track | undefined) => x?.title ?? '?';
  return kind === 'transition'
    ? `${t(first)} → ${t(last)}`
    : `${t(first)} → ${t(last)} (${detail.cast.length} tracks)`;
}

export async function resolveClipSource(source: ClipSource): Promise<ResolvedSource & { tracks: Map<number, Track> }> {
  if (source.kind === 'transition') {
    const rows = await api.transitions.list();
    const row = rows.find((r) => r.uuid === source.uuid);
    if (!row) throw new Error('Transition not found');
    const tracks = await fetchTracks([row.a_track_id, row.b_track_id]);
    const a = tracks.get(row.a_track_id)!;
    const b = tracks.get(row.b_track_id)!;
    const proj = transitionToProjection({
      uuid: row.uuid, name: row.name, transition: row.data as unknown as Transition,
      trackAId: row.a_track_id, trackBId: row.b_track_id,
      bpmA: a.bpm ?? null, bpmB: b.bpm ?? null,
      durations: { a: a.duration_secs ?? 0, b: b.duration_secs ?? 0 },
    });
    return {
      detail: proj.detail, castBpms: proj.trackBpms, targetBpm: proj.targetBpm, edits: proj.edits,
      title: row.name || derivedTitle(proj.detail, tracks, 'transition'), tracks,
    };
  }
  let detail: RoutineDetailWire;
  if (source.kind === 'routine') detail = await api.routines.get(source.uuid);
  else if (source.kind === 'candidate') detail = await api.routineCandidates.preview(source.uuid);
  else if (source.kind === 'routine-take') detail = await api.routineTakes.preview(source.uuid);
  else {
    const res = await fetch(
      `${API_BASE}/video-export/session-span/${source.uuid}?start_s=${source.startS}&end_s=${source.endS}`
    );
    if (!res.ok) throw new Error(((await res.json().catch(() => null))?.detail as string) ?? `session span: ${res.status}`);
    detail = await res.json();
  }
  const tracks = await fetchTracks(Array.from(new Set(detail.cast)));
  const castBpms = detail.cast.map((id) => tracks.get(id)?.bpm ?? 0);
  if (castBpms.some((b) => !(b > 0))) throw new Error('every cast Track needs a BPM');
  return { detail, castBpms, targetBpm: castBpms[0], edits: undefined, title: derivedTitle(detail, tracks, source.kind), tracks };
}

// ── Scene load ───────────────────────────────────────────────────────────

/** Load everything the scene needs (no audio). */
export async function loadClip(spec: ClipSpec): Promise<LoadedClip> {
  const src = await resolveClipSource(spec.source);
  const { detail, tracks } = src;
  const ids = Array.from(new Set(detail.cast));
  const cueRows = (await api.hotcues.getBulk(ids)) as Record<number, HotCue[]>;
  const trackBpms = new Map<number, number>();
  for (const id of ids) {
    const bpm = tracks.get(id)?.bpm;
    if (typeof bpm === 'number' && bpm > 0) trackBpms.set(id, bpm);
  }
  const { planned } = buildEditorRoutine(detail, src.castBpms, src.targetBpm, src.edits);

  const sceneTracks = new Map<number, SceneTrack>();
  const trackMetrics = new Map<number, TrackMetric>();
  await Promise.all(ids.map(async (id) => {
    const t = tracks.get(id)!;
    const [wave, grid, drops, ladder] = await Promise.all([
      api.waveforms.getData(id).then(decodeWaveformBlob).catch(() => null),
      api.beatgrids.get(id).catch(() => null) as Promise<{ data: { beat_times: number[]; downbeat_times: number[] } } | null>,
      api.drops.get(id).catch(() => null) as Promise<{ drops: { time: number; strength: number }[] } | null>,
      api.metricLadders.get(id).catch(() => null) as Promise<{ reset_marks: number[] } | null>,
    ]);
    const hotCues = (cueRows[id] ?? []).map((c) => ({ slot_number: c.slot_number, time_seconds: c.time_seconds, color: c.color }));
    const beatTimes = grid?.data.beat_times ?? [];
    const downbeatTimes = grid?.data.downbeat_times ?? [];
    const metric = buildTrackMetric({
      beatTimes, downbeatTimes, hotCues, drops: drops?.drops ?? null, resetMarks: ladder?.reset_marks ?? null,
    });
    if (metric) trackMetrics.set(id, metric);
    sceneTracks.set(id, {
      trackId: id,
      title: t.title ?? t.filename,
      artist: t.artist ?? '',
      bpm: t.bpm ?? null,
      durationSec: t.duration_secs ?? wave?.duration ?? 0,
      wave,
      beatTimes,
      downbeatTimes,
      hotCues,
    });
  }));

  const slot = getSlot('full');
  const scene: RoutineScene = {
    routine: planned,
    tracks: sceneTracks,
    actions: routineActions(planned, detail.events),
    style: { styleId: slot.styleId, params: slot.params },
    filterSettings: loadFilterSettings(),
    title: src.title,
    range: clipRange(spec, planned),
    look: spec.look,
  };
  scene.metric = buildClipMetric(planned, trackMetrics, scene.range);
  return { detail, routine: planned, scene, trackBpms, tracks, trackMetrics };
}

export function clipRange(spec: ClipSpec, routine: PlannedRoutine): { startSec: number; endSec: number } {
  const full = { startSec: routine.mixStartSec, endSec: routine.mixEndSec };
  if (!spec.range) return full;
  const startSec = Math.max(full.startSec, Math.min(spec.range.startSec, full.endSec - 1));
  const endSec = Math.max(startSec + 1, Math.min(spec.range.endSec, full.endSec));
  return { startSec, endSec };
}

// ── Audio ────────────────────────────────────────────────────────────────

async function fetchAudioBuffer(trackId: number, sampleRate: number): Promise<AudioBuffer> {
  const res = await fetch(api.tracks.audioUrl(trackId));
  if (!res.ok) throw new Error(`audio ${trackId}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  const decoder = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate });
  return decoder.decodeAudioData(bytes);
}

export interface RenderedClipAudio {
  /** The rendered mix (no fades) from `startSec`. */
  audio: AudioBuffer;
  meters: RenderMeters;
  startSec: number;
}

/** Render a mix range (no fades) through the real DSP, with meters; wires
 * the scene's meters / master level / hypermeter to it. The editor renders
 * the whole source once and trims by slicing (no re-render on trim). */
export async function renderClipAudio(
  loaded: LoadedClip, renderRange: { startSec: number; endSec: number }, onProgress: (p: ExportProgress) => void,
  /** Progressive preview: the render (still filling) and how far it is ready. */
  onPartial?: (rendered: RenderedClipAudio, readyUntilSec: number) => void,
): Promise<RenderedClipAudio> {
  const { routine, scene } = loaded;
  const beatFxSettings = loadBeatFxSettings();
  const key = renderKey(loaded, renderRange, beatFxSettings);
  const hit = renderCache.find((e) => e.key === key);
  if (hit) {
    attachRendered(loaded, hit.rendered);
    return hit.rendered;
  }
  const sampleRate = DEFAULT_RENDER_SAMPLE_RATE;
  const buffers = new Map<number, AudioBuffer>();
  const ids = Array.from(new Set(routine.slots.map((s) => s.trackId)));
  let decoded = 0;
  await Promise.all(ids.map(async (id) => {
    buffers.set(id, await fetchAudioBuffer(id, sampleRate));
    decoded++;
    onProgress({ stage: 'load', fraction: decoded / ids.length, detail: `decoded ${decoded}/${ids.length}` });
  }));
  onProgress({ stage: 'audio', fraction: 0 });
  let lastAttach = 0;
  const { audio, meters } = await renderRoutineAudioChunked({
    routine, buffers, trackBpms: loaded.trackBpms, range: renderRange, sampleRate,
    filterSettings: scene.filterSettings, beatFxSettings,
    onProgress: (f) => onProgress({ stage: 'audio', fraction: f }),
  }, {
    concurrency: RENDER_CONCURRENCY,
    onPartial: onPartial ? (r, readySec) => {
      const partial = { audio: r.audio, meters: r.meters, startSec: renderRange.startSec };
      // Rebuilding the hypermeter is ~O(mix length): not on every piece.
      const now = performance.now();
      if (now - lastAttach > 4000 || readySec >= renderRange.endSec - renderRange.startSec - 0.01) {
        attachRendered(loaded, partial);
        lastAttach = now;
      }
      onPartial(partial, renderRange.startSec + readySec);
    } : undefined,
  });
  const rendered = { audio, meters, startSec: renderRange.startSec };
  renderCache.unshift({ key, rendered });
  renderCache.length = Math.min(renderCache.length, RENDER_CACHE_SIZE);
  attachRendered(loaded, rendered);
  return rendered;
}

/** Pieces rendering at once (each its own OfflineAudioContext). */
const RENDER_CONCURRENCY = 3;
/** Recent renders kept in memory: reopening / switching back is instant. */
const RENDER_CACHE_SIZE = 2;
const renderCache: { key: string; rendered: RenderedClipAudio }[] = [];

function hashString(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Everything the render depends on: the performance, the range and the DSP settings. */
function renderKey(loaded: LoadedClip, range: { startSec: number; endSec: number }, beatFx: unknown): string {
  return [
    hashString(JSON.stringify(loaded.detail)),
    range.startSec.toFixed(3), range.endSec.toFixed(3),
    hashString(JSON.stringify(loaded.scene.filterSettings)), hashString(JSON.stringify(beatFx)),
  ].join(':');
}

/** Point the scene at a render (meters, master level, hypermeter). */
export function attachRendered(loaded: LoadedClip, r: RenderedClipAudio): void {
  const { scene, routine } = loaded;
  scene.meters = r.meters;
  scene.metersStartSec = r.startSec;
  scene.masterLevel = masterLevelReader(r.audio, r.startSec);
  scene.meterState = undefined;
  scene.metric = buildClipMetric(routine, loaded.trackMetrics, { startSec: r.startSec, endSec: r.startSec + r.audio.duration }, r.meters);
}

/** The clip's audio: the render sliced to `range` with the spec's fades
 * (pure gain ramps — the performance is untouched). */
export function clipAudioFor(r: RenderedClipAudio, range: { startSec: number; endSec: number }, spec: ClipSpec): AudioBuffer {
  const sr = r.audio.sampleRate;
  const from = Math.max(0, Math.round((range.startSec - r.startSec) * sr));
  const to = Math.min(r.audio.length, Math.round((range.endSec - r.startSec) * sr));
  const length = Math.max(1, to - from);
  const out = new AudioBuffer({ length, numberOfChannels: r.audio.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < r.audio.numberOfChannels; c++) {
    const d = r.audio.getChannelData(c).slice(from, from + length);
    const inN = Math.min(length, Math.round(spec.fadeInSec * sr));
    for (let i = 0; i < inN; i++) d[i] *= i / inN;
    const outN = Math.min(length, Math.round(spec.fadeOutSec * sr));
    for (let i = 0; i < outN; i++) d[length - 1 - i] *= i / outN;
    out.copyToChannel(d, c);
  }
  return out;
}

/** The spec with its visualizer programme resolved: `viz.auto` replaced
 * by cues placed on the mix's hypermeter (needs the rendered meters). */
export function resolveAutoViz(spec: ClipSpec, loaded: LoadedClip): ClipSpec {
  if (!spec.viz.auto || !loaded.scene.metric) return spec;
  const cues = autoVizCues(loaded.scene.metric, clipRange(spec, loaded.routine), { ...DEFAULT_AUTO_VIZ, ...spec.viz.auto }, loaded.routine.secPerBeat * 4);
  return { ...spec, viz: { ...spec.viz, cues, auto: null } };
}

/** Peak-ish level per channel over a 1/30 s window ending at `t`,
 * mapped through a −48 dB floor to 0..1. */
export function masterLevelReader(audio: AudioBuffer, startSec: number): (t: number) => { left: number; right: number } {
  const sr = audio.sampleRate;
  const win = Math.round(sr / 30);
  const chans = [audio.getChannelData(0), audio.getChannelData(Math.min(1, audio.numberOfChannels - 1))];
  const toLevel = (peak: number): number => {
    if (peak <= 1e-6) return 0;
    const db = 20 * Math.log10(peak);
    return Math.max(0, Math.min(1, (db + 48) / 48));
  };
  return (t) => {
    const end = Math.min(audio.length, Math.round((t - startSec) * sr));
    const start = Math.max(0, end - win);
    const out = [0, 0];
    for (let c = 0; c < 2; c++) {
      const d = chans[c];
      let peak = 0;
      for (let i = start; i < end; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
      out[c] = toLevel(peak);
    }
    return { left: out[0], right: out[1] };
  };
}

// ── Visualizer programme ─────────────────────────────────────────────────

export const BG_W = 540;
export const BG_H = 960;

/** Sequential background painter: owns one renderer per preset the
 * programme uses and the frame feed's ballistics. */
export class BackgroundProgramme {
  private layers = new Map<string, BackgroundLayer>();
  private feed: ReturnType<typeof createOfflineVisualizerFeed>;
  private range: { startSec: number; endSec: number };
  /** `range` = the clip (cue times are clip-relative); `metersStartSec` =
   * the render's start (meter step 0). */
  constructor(meters: RenderMeters, routine: PlannedRoutine, range: { startSec: number; endSec: number }, metric?: ClipMetric | null, metersStartSec = range.startSec) {
    this.range = range;
    this.feed = createOfflineVisualizerFeed(meters, routine, metersStartSec, metric);
  }
  private layer(id: string): BackgroundLayer {
    let l = this.layers.get(id);
    if (!l) {
      const preset = exportPresetById(id);
      l = createBackgroundLayer(preset, BG_W, BG_H);
      // A genepool preset not loaded yet renders the fallback uncached.
      if (preset.id === id) this.layers.set(id, l);
    }
    return l;
  }
  /** Render the programme at mix instant `t`; returns the layers to composite. */
  at(spec: ClipSpec, t: number, dt: number): { canvas: HTMLCanvasElement; alpha: number }[] {
    const s = t - this.range.startSec;
    const v = vizAt(spec, s);
    const cur = this.layer(v.presetId);
    const frame = this.feed.frameAt(t, dt, presetParamsFor(v.presetId, v.params));
    const ov = overlayAt(spec, s);
    if (ov?.kind === 'blackout') return [];
    if (ov?.kind === 'blast' && ov.presetId) {
      const blast = this.layer(ov.presetId);
      blast.render({ ...frame, params: presetParamsFor(ov.presetId, null) });
      return [{ canvas: blast.canvas, alpha: 1 }];
    }
    const out: { canvas: HTMLCanvasElement; alpha: number }[] = [];
    if (v.from) {
      const prev = this.layer(v.from);
      prev.render({ ...frame, params: presetParamsFor(v.from, v.fromParams) });
      out.push({ canvas: prev.canvas, alpha: 1 - v.mix });
    }
    cur.render(frame);
    out.push({ canvas: cur.canvas, alpha: v.from ? v.mix : 1 });
    return out;
  }
}

// ── Export ───────────────────────────────────────────────────────────────

export interface RoutineVideoExportOptions {
  onProgress?: (p: ExportProgress) => void;
  /** Mirror rendered frames here (UI preview). */
  previewCanvas?: HTMLCanvasElement | null;
  /** Skip the mux (audio/frames only — tests and dry runs). */
  dryRun?: boolean;
  /** Reuse an already-loaded clip + rendered audio (the editor's preview). */
  loaded?: LoadedClip;
  rendered?: RenderedClipAudio;
}

export interface RoutineVideoExportResult {
  url: string | null;
  path: string | null;
  frames: number;
  seconds: number;
  audio: AudioBuffer;
}

/** Frame → JPEG bytes. Encodes in a worker when OffscreenCanvas exists
 * (Chromium/Electron), else on the main thread via toBlob. */
const ENCODE_WORKERS = 4;
class JpegEncoder {
  private workers: Worker[] = [];
  private next = 1;
  private waiting = new Map<number, (bytes: ArrayBuffer) => void>();

  constructor() {
    if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < ENCODE_WORKERS; i++) {
          const w = new Worker(new URL('./jpegEncodeWorker.ts', import.meta.url), { type: 'module' });
          w.onmessage = (e: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
            const resolve = this.waiting.get(e.data.id);
            this.waiting.delete(e.data.id);
            resolve?.(e.data.bytes);
          };
          this.workers.push(w);
        }
      } catch {
        this.workers = [];
      }
    }
  }

  async encode(canvas: HTMLCanvasElement, quality: number): Promise<ArrayBuffer> {
    if (this.workers.length > 0) {
      const bitmap = await createImageBitmap(canvas);
      const id = this.next++;
      const done = new Promise<ArrayBuffer>((resolve) => this.waiting.set(id, resolve));
      this.workers[id % this.workers.length].postMessage({ id, bitmap, quality }, [bitmap]);
      return done;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('toBlob failed');
    return blob.arrayBuffer();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

async function post(url: string, body: BodyInit | null): Promise<Response> {
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res;
}

const FRAME_BATCH_BYTES = 12 * 1024 * 1024;
const JPEG_QUALITY = 0.92;

/** Export one clip to an MP4. Resolves with the served file URL. */
export async function exportClip(specIn: ClipSpec, opts: RoutineVideoExportOptions = {}): Promise<RoutineVideoExportResult> {
  let spec = specIn;
  const { fps, width, height } = spec;
  const progress = opts.onProgress ?? (() => {});
  progress({ stage: 'load', fraction: 0 });
  await Promise.race([
    document.fonts?.load(`bold 32px ${FONT_MONO}`).catch(() => null),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  const loaded = opts.loaded ?? await loadClip(spec);
  const { routine, scene } = loaded;
  scene.look = spec.look;
  const range = clipRange(spec, routine);
  scene.range = range;
  const rendered = opts.rendered ?? await renderClipAudio(loaded, range, progress);
  attachRendered(loaded, rendered);
  const { meters } = rendered;
  spec = resolveAutoViz(spec, loaded);
  await ensureExportPresets(programmePresetIds(spec));
  const audio = clipAudioFor(rendered, range, spec);
  // Header meter reads the faded clip audio.
  scene.masterLevel = masterLevelReader(audio, range.startSec);
  scene.stripState = undefined;
  const seconds = audio.duration;

  let jobId: string | null = null;
  if (!opts.dryRun) {
    const wav = encodePcm16Wav(audio);
    const name = (spec.look.title || scene.title).replace(/\s+/g, '-');
    const res = await post(
      `${API_BASE}/video-export/jobs?name=${encodeURIComponent(name)}&fps=${fps}&width=${width}&height=${height}`, wav
    );
    jobId = ((await res.json()) as { id: string }).id;
  }

  progress({ stage: 'frames', fraction: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2d context');
  const programme = new BackgroundProgramme(meters, routine, range, scene.metric, rendered.startSec);
  const frameCount = Math.ceil(seconds * fps);
  let batch: ArrayBuffer[] = [];
  let batchBytes = 0;
  const flush = async (): Promise<void> => {
    if (!jobId || batch.length === 0) return;
    const blob = new Blob(batch, { type: 'application/octet-stream' });
    const count = batch.length;
    batch = [];
    batchBytes = 0;
    await post(`${API_BASE}/video-export/jobs/${jobId}/frames?count=${count}`, blob);
  };
  const preview = opts.previewCanvas ?? null;
  const previewCtx = preview?.getContext('2d') ?? null;
  const ENCODE_LAG = 12;
  const encoder = new JpegEncoder();
  let pending: Promise<ArrayBuffer>[] = [];
  const settle = async (): Promise<void> => {
    const done = await Promise.all(pending);
    pending = [];
    for (const jpeg of done) {
      batch.push(jpeg);
      batchBytes += jpeg.byteLength;
    }
    if (batchBytes >= FRAME_BATCH_BYTES) await flush();
  };
  for (let i = 0; i < frameCount; i++) {
    const t = range.startSec + i / fps;
    const background = programme.at(spec, t, 1 / fps);
    const pf = programmeFrame(spec, i / fps, seconds);
    scene.look = pf.look;
    drawRoutineFrame(ctx, scene, t, width, height, { background, fade: pf.fade, impact: pf.impact, overlay: pf.overlay });
    if (previewCtx && preview && i % 3 === 0) {
      previewCtx.drawImage(canvas, 0, 0, preview.width, preview.height);
    }
    if (jobId) {
      pending.push(encoder.encode(canvas, JPEG_QUALITY));
      if (pending.length >= ENCODE_LAG) await settle();
    } else if (i % 8 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    if (i % 15 === 0) progress({ stage: 'frames', fraction: i / frameCount, detail: `${i}/${frameCount}` });
  }
  await settle();
  await flush();
  encoder.dispose();

  if (!jobId) {
    progress({ stage: 'done', fraction: 1 });
    return { url: null, path: null, frames: frameCount, seconds, audio };
  }
  progress({ stage: 'mux', fraction: 0 });
  const fin = await post(`${API_BASE}/video-export/jobs/${jobId}/finish`, null);
  const out = (await fin.json()) as { path: string; url: string; frames: number };
  progress({ stage: 'done', fraction: 1, detail: out.path });
  return { url: `${API_BASE.replace(/\/api$/, '')}${out.url}`, path: out.path, frames: out.frames, seconds, audio };
}

export { SCENE_W, SCENE_H };
