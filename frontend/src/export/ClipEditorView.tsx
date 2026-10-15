/**
 * CLIP mode (#377 r3): the clip editor as an app mode (?view=clip&clip=
 * <kind>:<uuid>[:<start>-<end>][&autostart=1]).
 *
 * The source's whole mix renders once offline (real DSP + meters; the
 * preview needs real levels); trimming slices that render, so in/out and
 * fades never re-render. Layout: source bar · portrait preview + inspector
 * (PROGRAMME / LOOK / OUTPUT) · transport + timeline (deck presence, drops,
 * phrases, cue flags, draggable in/out). The performance itself is never
 * edited here; preview audio plays on its own AudioContext.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  api, type CameoRowWire, type RoutineCandidateWire, type RoutineRowWire, type RoutineTakeRowWire, type SessionRowWire,
  type TakeRowWire,
} from '../api/client';
import type { Track } from '../types';
import { MixPicker } from '../routines/MixPicker';
import type { MixArtifactRef, TransitionRowLike } from '../routines/mixPickerModel';
import { useDecks } from '../hooks/useDeck';
import { ROUTINE_DECK_ORDER } from '../sets/routinePlan';
import { useToast } from '../components/Toast';
import '../routines/routineEditor.css';
import {
  attachRendered, BackgroundProgramme, clipRange, exportClip, loadClip, renderClipAudio, resolveAutoViz,
  type ExportProgress, type LoadedClip, type RenderedClipAudio, type RoutineVideoExportResult,
} from './routineVideoExport';
import { drawRoutineFrame, sceneDecks } from './routineVideoScene';
import {
  DEFAULT_HOLD_SEC, DEFAULT_LOOK, defaultPlacement, fadeGainAt, HELD_TRANSITIONS, loadClipSpec, lookAfterCue,
  clipSpecFile, overlayAt, parseClipSpecFile, programmeFrame, sourceKey, transitionBadge, programmePresetIds, rememberHandle, saveClipSpec,
  type ClipLook, type ClipSource, type ClipSpec, type CueTransition, type CueTransitionKind, type TransitionVfx,
  type VizCue,
} from './clipSpec';
import { autoVizCues, DEFAULT_AUTO_VIZ, type AutoVizOptions, type VizImpact } from './clipMetric';
import { ensureExportPresets, exportPresetById, isPresetLoaded, presetCatalogue } from './offlineVisualizer';
import { PresetBrowser } from './PresetBrowser';
import { LookControls } from './LookControls';
import { clipSourceString, OPEN_CLIP_EVENT, parseClipSource, takePendingClipSource } from './clipEvents';
import { ClipTimeline } from './ClipTimeline';
import { useViewActive } from '../contexts/viewActive';
import { DECK_COLORS } from '../theme/deckColors';
import './clipEditor.css';

declare global {
  interface Window {
    manadjClipEditorStarted?: boolean;
    manadjClipEditor?: {
      run: () => Promise<RoutineVideoExportResult>;
      state: () => { progress: ExportProgress | null; result: RoutineVideoExportResult | null; error: string | null; ready: boolean };
      /** Preview at a clip-relative second (headless checks). */
      seek: (clipSec: number) => void;
      /** The source's structure for authoring (headless): slots, hypermeter events, takeovers. */
      structure: () => unknown;
    };
  }
}

function fmt(sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return tenths ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
}

const IMPACTS: VizImpact[] = ['none', 'flash', 'zoom', 'shockwave', 'strobe'];
const TRANSITIONS: { id: CueTransitionKind; label: string; title: string }[] = [
  { id: 'crossfade', label: 'CROSSFADE', title: 'Fade the presets (and blend numeric look changes) over the fade length' },
  { id: 'cut', label: 'CUT', title: 'Instant switch' },
  { id: 'blackout', label: 'BLACKOUT', title: 'The visualizer goes black for a while (before: a build into the cue)' },
  { id: 'solo', label: 'SOLO', title: 'One deck’s waveform fills the frame for a while' },
  { id: 'blast', label: 'BLAST', title: 'Another preset takes over for a while, then the programme returns' },
  { id: 'vfx', label: 'VFX', title: 'A beat-synced effect over the frame for a while' },
];
const VFX: { id: TransitionVfx; label: string }[] = [
  { id: 'rgb', label: 'RGB SPLIT' }, { id: 'glitch', label: 'GLITCH' }, { id: 'kaleido', label: 'KALEIDO' },
  { id: 'mirror', label: 'MIRROR' }, { id: 'invert', label: 'INVERT' }, { id: 'tunnel', label: 'TUNNEL' }, { id: 'strobe', label: 'STROBE' },
];
type Tab = 'storyboard' | 'scene' | 'look' | 'output';


export default function ClipEditorView() {
  const viewActive = useViewActive();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [source, setSource] = useState<ClipSource | null>(() => takePendingClipSource() ?? parseClipSource(params.get('clip')));
  const [spec, setSpec] = useState<ClipSpec | null>(() => (source ? loadClipSpec(source) : null));
  const [sessions, setSessions] = useState<SessionRowWire[]>([]);
  const [spanOpen, setSpanOpen] = useState(false);
  const [sessionSpan, setSessionSpan] = useState({ uuid: '', startS: 0, endS: 120 });

  const [loaded, setLoaded] = useState<LoadedClip | null>(null);
  const [rendered, setRendered] = useState<RenderedClipAudio | null>(null);
  /** Mix second the (progressive) render is ready to; preview stops here. */
  const [readyUntil, setReadyUntil] = useState(-Infinity);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<RoutineVideoExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewT, setPreviewT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>('storyboard');
  const [selectedCue, setSelectedCue] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [auto, setAuto] = useState<AutoVizOptions>(DEFAULT_AUTO_VIZ);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ progress, result, error, ready: false });
  const renderDone = !!rendered && !!loaded && readyUntil >= loaded.routine.mixEndSec - 0.01;
  useEffect(() => { stateRef.current = { progress, result, error, ready: renderDone }; }, [progress, result, error, renderDone]);
  const audioRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number } | null>(null);
  const programmeRef = useRef<{ key: string; programme: BackgroundProgramme } | null>(null);

  // ── External opens (Mix editor ⇥ clip) ──
  useEffect(() => {
    const open = (e: Event) => { takePendingClipSource(); setSource((e as CustomEvent<ClipSource>).detail); };
    window.addEventListener(OPEN_CLIP_EVENT, open);
    return () => window.removeEventListener(OPEN_CLIP_EVENT, open);
  }, []);

  // ── Source inventory: the Mix editor's picker, same queries ──
  const toast = useToast();
  useEffect(() => { api.sessions.list().then(setSessions).catch(() => {}); }, []);
  const { data: routineRows = [] } = useQuery<RoutineRowWire[]>({ queryKey: ['routines'], queryFn: api.routines.list });
  const { data: routineTakeRows = [] } = useQuery<RoutineTakeRowWire[]>({ queryKey: ['routine-takes'], queryFn: api.routineTakes.list });
  const { data: candidateRows = [] } = useQuery<RoutineCandidateWire[]>({ queryKey: ['routine-candidates'], queryFn: api.routineCandidates.list });
  const { data: transitionRows = [] } = useQuery<TransitionRowLike[]>({ queryKey: ['transitions'], queryFn: () => api.transitions.list() as Promise<TransitionRowLike[]> });
  const { data: cameoRows = [] } = useQuery<CameoRowWire[]>({ queryKey: ['cameos'], queryFn: () => api.cameos.list() });
  const { data: takeRows = [] } = useQuery<TakeRowWire[]>({ queryKey: ['takes'], queryFn: () => api.takes.list() });
  const { data: allTracksPage } = useQuery<{ items: Track[] }>({
    queryKey: ['tracks-picker'],
    queryFn: () => api.tracks.list(1, 10000) as Promise<{ items: Track[] }>,
    staleTime: 60_000,
  });
  const allTracks = useMemo(() => allTracksPage?.items ?? [], [allTracksPage]);
  const trackByIdMap = useMemo(() => new Map(allTracks.map((t) => [t.id, t])), [allTracks]);
  const trackById = useCallback((id: number) => trackByIdMap.get(id), [trackByIdMap]);
  const unpromotedTakes = useMemo(() => routineTakeRows.filter((t) => !t.promoted_routine_uuid), [routineTakeRows]);
  const unconfirmedCandidates = useMemo(() => {
    const confirmed = new Set(routineTakeRows.map((t) => t.origin_candidate_uuid).filter(Boolean));
    return candidateRows.filter((c) => !confirmed.has(c.uuid) && c.cast.length >= 3);
  }, [candidateRows, routineTakeRows]);
  const decks = useDecks();
  const deckTracks = useMemo(
    () => ROUTINE_DECK_ORDER.flatMap((deck) => { const track = decks[deck].loadedTrack; return track ? [{ deck, track }] : []; }),
    [decks],
  );
  /** Picker row → clip source (Routines, Transitions, Routine Takes,
   * candidates clip directly; the rest are Mix-editor-only kinds). */
  const onPick = (ref: MixArtifactRef) => {
    if (ref.kind === 'routine' || ref.kind === 'transition' || ref.kind === 'routine-take' || ref.kind === 'candidate') {
      setSource({ kind: ref.kind, uuid: ref.uuid });
    } else {
      toast('That kind opens in the Mix editor — clips take Routines, Transitions, Routine Takes, candidates or Session spans.');
    }
  };
  const pickerRefKey = source && source.kind !== 'session' ? `${source.kind}:${source.uuid}` : null;
  const noopEdit = () => toast('Rename, favorite and delete Transitions in the Mix editor.');

  // ── Source load + one full render ──
  useEffect(() => {
    if (!source) return;
    const s = loadClipSpec(source);
    setSpec(s);
    setLoaded(null);
    setRendered(null);
    setReadyUntil(-Infinity);
    setResult(null);
    setLoadError(null);
    setSelectedCue(null);
    setThumbs(new Map());
    programmeRef.current?.programme.dispose();
    programmeRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const l = await loadClip(s);
        if (cancelled) return;
        setLoaded(l);
        setPreviewT(clipRange(s, l.routine).startSec);
        const full = { startSec: l.routine.mixStartSec, endSec: l.routine.mixEndSec };
        const r = await renderClipAudio(l, full, (p) => { if (!cancelled) setProgress(p); }, (partial, ready) => {
          if (cancelled) return;
          setRendered(partial);
          setReadyUntil(ready);
        });
        if (cancelled) return;
        setRendered(r);
        setReadyUntil(full.endSec);
        setProgress(null);
        if (s.viz.auto) setSpec((cur) => (cur ? resolveAutoViz(cur, l) : cur));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    const url = new URL(window.location.href);
    url.searchParams.set('clip', clipSourceString(source));
    window.history.replaceState(null, '', url);
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => { if (spec) saveClipSpec(spec); }, [spec]);
  // Genepool presets load lazily: fetch any the programme references, then repaint.
  const [presetEpoch, setPresetEpoch] = useState(0);
  useEffect(() => {
    if (!spec) return;
    const ids = programmePresetIds(spec);
    if (ids.every(isPresetLoaded)) return;
    let live = true;
    void ensureExportPresets(ids).then(() => { if (live) { programmeRef.current?.programme.dispose(); programmeRef.current = null; setPresetEpoch((n) => n + 1); } });
    return () => { live = false; };
  }, [spec]);
  const presetName = useMemo(() => {
    const names = new Map(presetCatalogue().map((p) => [p.id, p.name]));
    return (id: string) => names.get(id) ?? id;
  }, []);

  const range = loaded && spec ? clipRange(spec, loaded.routine) : null;
  const full = loaded ? { startSec: loaded.routine.mixStartSec, endSec: loaded.routine.mixEndSec } : null;
  const clipDur = range ? range.endSec - range.startSec : 0;
  const sortedCues = useMemo(() => (spec ? [...spec.viz.cues].sort((a, b) => a.atSec - b.atSec) : []), [spec]);

  // ── Preview painter ──
  const thumbsRef = useRef(thumbs);
  useEffect(() => { thumbsRef.current = thumbs; }, [thumbs]);
  const paint = useCallback((t: number) => {
    const canvas = previewRef.current;
    if (!canvas || !loaded || !spec) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const r = clipRange(spec, loaded.routine);
    loaded.scene.look = spec.look;
    loaded.scene.range = r;
    let background: { canvas: HTMLCanvasElement; alpha: number }[] | undefined;
    if (rendered) {
      const key = `${r.startSec}:${rendered.startSec}`;
      if (!programmeRef.current || programmeRef.current.key !== key) {
        programmeRef.current?.programme.dispose();
        programmeRef.current = { key, programme: new BackgroundProgramme(rendered.meters, loaded.routine, r, loaded.scene.metric, rendered.startSec) };
      }
      background = programmeRef.current.programme.at(spec, t, 1 / 30);
      // Thumbnail the running preset the first time it is seen.
      const s = t - r.startSec;
      const cur = [...sortedCues].reverse().find((c) => c.atSec <= s);
      const top = background[background.length - 1];
      if (cur && top && top.alpha >= 0.99 && !thumbsRef.current.has(cur.presetId) && !overlayAt(spec, s)) {
        const th = document.createElement('canvas');
        th.width = 54;
        th.height = 96;
        th.getContext('2d')?.drawImage(top.canvas, 0, 0, 54, 96);
        const url = th.toDataURL('image/jpeg', 0.7);
        thumbsRef.current = new Map(thumbsRef.current).set(cur.presetId, url);
        setThumbs(thumbsRef.current);
      }
    }
    const pf = programmeFrame(spec, t - r.startSec, r.endSec - r.startSec);
    loaded.scene.look = pf.look;
    drawRoutineFrame(ctx, loaded.scene, t, canvas.width, canvas.height, {
      background, fade: pf.fade, impact: pf.impact, overlay: pf.overlay,
    });
    void presetEpoch;
  }, [loaded, spec, rendered, sortedCues, presetEpoch]);

  useEffect(() => { if (!playing) paint(previewT); }, [paint, previewT, playing]);

  // ── Preview transport ──
  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try { a.src.stop(); } catch { /* already stopped */ }
      void a.ctx.close();
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);
  const play = useCallback(() => {
    if (!rendered || !range) return;
    stopAudio();
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = rendered.audio;
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);
    const startT = previewT >= range.endSec - 0.05 ? range.startSec : previewT;
    const offset = Math.max(0, startT - rendered.startSec);
    src.start(0, offset);
    src.onended = () => { if (audioRef.current?.src === src) stopAudio(); };
    audioRef.current = { ctx, src, gain, startedAt: ctx.currentTime, offset };
    setPlaying(true);
  }, [rendered, range, previewT, stopAudio]);
  useEffect(() => {
    if (!playing || !spec || !range || !rendered) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      const t = rendered.startSec + a.offset + (a.ctx.currentTime - a.startedAt);
      const stopAt = Math.min(range.endSec, readyUntil);
      if (t >= stopAt) { stopAudio(); setPreviewT(stopAt); return; }
      a.gain.gain.value = fadeGainAt(spec, t - range.startSec, range.endSec - range.startSec);
      setPreviewT(t);
      paint(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, spec, range, rendered, readyUntil, paint, stopAudio]);
  useEffect(() => () => stopAudio(), [stopAudio]);
  useEffect(() => { if (!viewActive) stopAudio(); }, [viewActive, stopAudio]);

  // ── Export ──
  const run = useCallback(async () => {
    if (!spec || !loaded || !rendered || !renderDone) throw new Error('not loaded');
    stopAudio();
    setError(null);
    setResult(null);
    setProgress({ stage: 'frames', fraction: 0 });
    try {
      const r = await exportClip(spec, { loaded, rendered, previewCanvas: previewRef.current, onProgress: setProgress });
      setResult(r);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      programmeRef.current?.programme.dispose();
      programmeRef.current = null;
      attachRendered(loaded, rendered);
    }
  }, [spec, loaded, rendered, renderDone, stopAudio]);
  const seekRef = useRef<(s: number) => void>(() => {});
  useEffect(() => {
    seekRef.current = (s) => { if (range) { stopAudio(); setPreviewT(range.startSec + s); } };
  });
  const structureRef = useRef<() => unknown>(() => null);
  useEffect(() => {
    structureRef.current = () => {
      if (!loaded || !range) return null;
      const m = loaded.scene.metric;
      const rel = (t: number) => Math.round((t - range.startSec) * 100) / 100;
      return {
        range, secPerBeat: loaded.routine.secPerBeat,
        slots: loaded.routine.slots.map((sl, i) => ({ i, deck: sl.deck, title: loaded.scene.tracks.get(sl.trackId)?.title, entry: rel(sl.entryMixSec) })),
        events: (m?.events ?? []).filter((e) => e.tier >= 3 || e.drop).map((e) => ({ s: rel(e.t), slot: e.slot, tier: e.tier, drop: e.drop, dominant: e.dominant, level: Math.round(e.level * 100) / 100 })),
        takeovers: (m?.takeovers ?? []).map((x) => ({ s: rel(x.t), slot: x.slot })),
        actions: loaded.scene.actions.map((a) => ({ s: rel(loaded.routine.beatOriginMixSec + a.beat * loaded.routine.secPerBeat), slot: a.slot, kind: a.kind, label: a.label })),
      };
    };
  });
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    window.manadjClipEditor = {
      run: () => runRef.current(), state: () => stateRef.current, seek: (s) => seekRef.current(s), structure: () => structureRef.current(),
    };
  }, []);
  useEffect(() => {
    if (params.get('autostart') === '1' && renderDone && !window.manadjClipEditorStarted) {
      window.manadjClipEditorStarted = true;
      void runRef.current().catch(() => {});
    }
  }, [renderDone, params]);

  // ── Spec editing ──
  const update = (patch: Partial<ClipSpec>) => setSpec((s) => (s ? { ...s, ...patch } : s));
  const updateLook = (patch: Partial<ClipLook>) => setSpec((s) => (s ? { ...s, look: { ...s.look, ...patch } } : s));
  const setCues = (cues: VizCue[]) => setSpec((s) => (s ? { ...s, viz: { ...s.viz, cues: [...cues].sort((a, b) => a.atSec - b.atSec), auto: null } } : s));
  const patchCue = (i: number, patch: Partial<VizCue>) => setCues(sortedCues.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const pct = progress ? Math.round(progress.fraction * 100) : 0;
  const busy = !!progress && progress.stage !== 'done';
  const exporting = busy && (progress?.stage === 'frames' || progress?.stage === 'mux') && !!rendered;
  const metric = loaded?.scene.metric ?? null;

  /** Snap a clip second to the nearest audible phrase/drop within 2 s. */
  const snap = (s: number): number => {
    if (!metric || !range) return s;
    let best = s;
    let bestD = 2;
    for (const e of metric.events) {
      if (e.tier < 4 && !e.drop) continue;
      const d = Math.abs(e.t - range.startSec - s);
      if (d < bestD) { bestD = d; best = e.t - range.startSec; }
    }
    return best;
  };

  const look = spec?.look ?? DEFAULT_LOOK;
  const secPerBar = loaded ? loaded.routine.secPerBeat * 4 : 2;

  // ── Scenes: a cue is a scene — its preset, its look changes and how it arrives ──
  /** The scene in force at the preview playhead. */
  const sceneAtPlayhead = range ? Math.max(0, sortedCues.reduce((k, c, i) => (c.atSec <= previewT - range.startSec + 1e-3 ? i : k), 0)) : 0;
  const sceneIdx = selectedCue !== null && sortedCues[selectedCue] ? selectedCue : null;
  const sceneCue = sceneIdx !== null ? sortedCues[sceneIdx] : null;
  const sceneLook: ClipLook = spec && sceneIdx !== null ? lookAfterCue(spec, sceneIdx) : look;
  /** Preview just past a cue's switch (its fade / held segment). */
  const previewAfterCue = (cue: VizCue) => {
    if (!range || !spec) return;
    const tr = cue.transition;
    const fade = !tr || tr.kind === 'crossfade' ? tr?.durationSec ?? spec.viz.crossfadeSec : 0;
    const hold = tr && HELD_TRANSITIONS.includes(tr.kind) && (tr.placement ?? defaultPlacement(tr.kind)) === 'after' ? tr.durationSec ?? DEFAULT_HOLD_SEC : 0;
    const at = range.startSec + cue.atSec + Math.max(fade, hold) + 0.1;
    const next = sortedCues.find((c) => c.atSec > cue.atSec);
    const end = next ? range.startSec + next.atSec - 0.05 : range.endSec;
    if (previewT < at || previewT > end) { stopAudio(); setPreviewT(Math.min(at, end)); }
  };
  const openScene = (i: number) => {
    setSelectedCue(i);
    setTab('scene');
    const c = sortedCues[i];
    if (c) previewAfterCue(c);
  };
  const setSceneLook = (patch: Partial<ClipLook>) => {
    if (!sceneCue || sceneIdx === null) return;
    patchCue(sceneIdx, { look: { ...(sceneCue.look ?? {}), ...patch } });
    previewAfterCue(sceneCue);
  };
  const clearSceneLook = (keys: (keyof ClipLook)[]) => {
    if (!sceneCue || sceneIdx === null) return;
    const next = { ...(sceneCue.look ?? {}) };
    for (const k of keys) delete next[k];
    patchCue(sceneIdx, { look: Object.keys(next).length > 0 ? next : undefined });
  };
  /** Short labels for a scene's look changes (storyboard cards). */
  const lookSummary = (i: number): string[] => {
    const raw = sortedCues[i]?.look;
    if (!raw || !spec) return [];
    const before = i > 0 ? lookAfterCue(spec, i - 1) : spec.look;
    const l: Partial<ClipLook> = {};
    for (const [k, v] of Object.entries(raw) as [keyof ClipLook, unknown][]) if (before[k] !== v) (l as Record<string, unknown>)[k] = v;
    const out: string[] = [];
    if (l.composite) out.push(l.composite === 'cards' ? 'solid' : l.composite === 'mask' ? 'window' : l.composite === 'screen' ? 'light' : l.composite);
    if (l.wavePalette) out.push(l.wavePalette);
    if (l.vizDim !== undefined && l.vizDim <= 0.05 && (l.vignette ?? 1) <= 0.05) out.push('bright');
    const hidden = (['showKnobs', 'showTitles', 'showPlayhead', 'showCues', 'showTicker'] as const).filter((k) => l[k] === false);
    if (hidden.length >= 4) out.push('waves only');
    else if (hidden.length) out.push(`− ${hidden.map((k) => k.replace('show', '').toLowerCase()).join(' ')}`);
    const shown = (['showKnobs', 'showTitles'] as const).filter((k) => l[k] === true);
    if (shown.length === 2 && !hidden.length) out.push('mixer');
    return out;
  };

  const [browseOpen, setBrowseOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  /** ◀ ▶ on a scene: the storyboard presets first, then the catalogue. */
  const stepPreset = (i: number, dir: 1 | -1) => {
    const cue = sortedCues[i];
    if (!cue) return;
    const ring = [...new Set([...auto.presets, ...presetCatalogue().map((p) => p.id)])];
    const k = ring.indexOf(cue.presetId);
    const id = ring[(k + dir + ring.length) % ring.length];
    patchCue(i, { presetId: id, params: undefined });
    previewAfterCue(cue);
  };
  /** Scene thumbnails: a small frame of each scene as it looks once landed. */
  const sceneThumbKey = (i: number): string => {
    const c = sortedCues[i];
    return c && spec ? `${c.atSec}|${c.presetId}|${JSON.stringify(lookAfterCue(spec, i))}|${JSON.stringify(c.params ?? null)}` : '';
  };
  const [sceneThumbs, setSceneThumbs] = useState<Map<string, string>>(new Map());
  const thumbJobs = sortedCues.map((c, i) => {
    const next = sortedCues.slice(i + 1).find((n) => n.atSec > c.atSec + 0.5);
    const tr = c.transition;
    const settle = !tr || tr.kind === 'crossfade' ? (tr?.durationSec ?? spec?.viz.crossfadeSec ?? 2) : tr && HELD_TRANSITIONS.includes(tr.kind) && (tr.placement ?? defaultPlacement(tr.kind)) === 'after' ? (tr.durationSec ?? DEFAULT_HOLD_SEC) : 0;
    const end = next ? next.atSec : clipDur;
    return { key: sceneThumbKey(i), at: Math.min(c.atSec + settle + 1.5, (c.atSec + end) / 2) };
  });
  const thumbSig = thumbJobs.map((j) => j.key).join('\n');
  const thumbJobsRef = useRef(thumbJobs);
  useEffect(() => { thumbJobsRef.current = thumbJobs; });
  useEffect(() => {
    if (!renderDone || !spec || !loaded || !rendered || !range) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        const r = range;
        const programme = new BackgroundProgramme(rendered.meters, loaded.routine, r, loaded.scene.metric, rendered.startSec);
        const canvas = document.createElement('canvas');
        canvas.width = 108;
        canvas.height = 192;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const out = new Map(sceneThumbs);
        let changed = false;
        for (const job of thumbJobsRef.current) {
          if (!live) return;
          if (out.has(job.key)) continue;
          const t = r.startSec + job.at;
          // Two frames back: the feed's ballistics settle a little.
          programme.at(spec, t - 1 / 15, 1 / 30);
          const background = programme.at(spec, t, 1 / 30);
          const pf = programmeFrame(spec, job.at, r.endSec - r.startSec);
          loaded.scene.look = pf.look;
          loaded.scene.range = r;
          drawRoutineFrame(ctx, loaded.scene, t, 108, 192, { background, fade: 1, impact: null, overlay: pf.overlay });
          out.set(job.key, canvas.toDataURL('image/jpeg', 0.7));
          changed = true;
          await new Promise((res) => setTimeout(res, 0));
        }
        programme.dispose();
        if (live && changed) setSceneThumbs(out);
      })();
    }, 700);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbSig, renderDone, presetEpoch]);

  const renderTransition = (cue: VizCue, index: number) => {
    const tr: CueTransition = cue.transition ?? { kind: 'crossfade' };
    const held = HELD_TRANSITIONS.includes(tr.kind);
    const setTr = (patch: Partial<CueTransition>) => { patchCue(index, { transition: { ...tr, ...patch } }); };
    const setKind = (kind: CueTransitionKind) => {
      const nowHeld = HELD_TRANSITIONS.includes(kind);
      const next: CueTransition = { ...tr, kind };
      if (!nowHeld) delete next.placement;
      if (kind === 'cut') delete next.durationSec;
      else if (nowHeld && !held) next.durationSec = Math.round(secPerBar * 2 * 100) / 100;
      else if (kind === 'crossfade' && held) delete next.durationSec;
      if (kind === 'blast' && !next.presetId) next.presetId = presetCatalogue().find((p) => p.id !== cue.presetId)?.id;
      if (kind === 'vfx' && !next.vfx) next.vfx = 'rgb';
      patchCue(index, { transition: kind === 'crossfade' && next.durationSec === undefined ? undefined : next });
    };
    const decksHere = loaded ? sceneDecks(loaded.routine) : [];
    return (
      <>
        <div className="ce-seg ce-wrap">
          {TRANSITIONS.map((k) => <button key={k.id} title={k.title} className={`btn btn-mini${tr.kind === k.id ? ' btn-selected' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </div>
        {tr.kind === 'crossfade' && (
          <div className="ce-fields">
            <label>fade s<input type="number" step={0.25} min={0} placeholder={String(spec?.viz.crossfadeSec ?? 2)} value={tr.durationSec ?? ''}
              onChange={(e) => setTr({ durationSec: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          </div>
        )}
        {held && (
          <>
            <div className="ce-seg ce-wrap">
              <span className="ce-muted">for</span>
              <input className="ce-inline-num" type="number" step={0.25} min={0.1} value={tr.durationSec ?? DEFAULT_HOLD_SEC} onChange={(e) => setTr({ durationSec: Number(e.target.value) })} />
              <span className="ce-muted">s</span>
              {[0.5, 1, 2, 4, 8].map((b) => {
                const d = Math.round(b * secPerBar * 100) / 100;
                return <button key={b} className={`btn btn-mini${Math.abs((tr.durationSec ?? DEFAULT_HOLD_SEC) - d) < 0.02 ? ' btn-selected' : ''}`} onClick={() => setTr({ durationSec: d })}>{b === 0.5 ? '½' : b} BAR{b > 1 ? 'S' : ''}</button>;
              })}
            </div>
            <div className="ce-seg">
              {(['before', 'after'] as const).map((p) => (
                <button key={p} className={`btn btn-mini${(tr.placement ?? defaultPlacement(tr.kind)) === p ? ' btn-selected' : ''}`} onClick={() => setTr({ placement: p })}
                  title={p === 'before' ? 'The segment builds into the cue and ends on it' : 'The segment starts on the cue, then hands back'}>{p === 'before' ? '⇥ INTO CUE' : 'FROM CUE ⇤'}</button>
              ))}
            </div>
          </>
        )}
        {tr.kind === 'blackout' && (
          <label className="ce-check"><input type="checkbox" checked={!!tr.hideWaves} onChange={(e) => setTr({ hideWaves: e.target.checked })} />waves out too (full black)</label>
        )}
        {tr.kind === 'solo' && (
          <div className="ce-seg">
            <span className="ce-muted">deck</span>
            <button className={`btn btn-mini${!tr.deck ? ' btn-selected' : ''}`} title="Whoever dominates as the solo begins" onClick={() => setTr({ deck: undefined })}>AUTO</button>
            {decksHere.map((d) => <button key={d} className={`btn btn-mini${tr.deck === d ? ' btn-selected' : ''}`} style={{ color: tr.deck === d ? undefined : DECK_COLORS[d] }} onClick={() => setTr({ deck: d })}>{d}</button>)}
          </div>
        )}
        {tr.kind === 'vfx' && (
          <div className="ce-seg ce-wrap">
            {VFX.map((v) => <button key={v.id} className={`btn btn-mini${(tr.vfx ?? 'rgb') === v.id ? ' btn-selected' : ''}`} onClick={() => setTr({ vfx: v.id })}>{v.label}</button>)}
          </div>
        )}
        {tr.kind === 'blast' && (
          <>
            <span className="ce-muted">blast preset: {tr.presetId ? presetName(tr.presetId) : '—'}</span>
            <PresetBrowser selected={tr.presetId ? [tr.presetId] : []} height={130} onPick={(id) => setTr({ presetId: id })} />
          </>
        )}
      </>
    );
  };


  return (
    <div className="ce-view" data-testid="clip-editor">
      {/* ── Source bar ── */}
      <header className="ce-bar">
        <span className="ce-mode-label">CLIP</span>
        {source?.kind === 'session' && <span className="ce-muted">Session span {fmt(source.startS)}–{fmt(source.endS)}</span>}
        <button className={`btn btn-mini${spanOpen ? ' btn-selected' : ''}`} onClick={() => setSpanOpen(!spanOpen)} title="Clip an arbitrary Session span">SESSION SPAN</button>
        {spanOpen && (
          <span className="ce-span">
            <select value={sessionSpan.uuid} onChange={(e) => setSessionSpan({ ...sessionSpan, uuid: e.target.value })}>
              <option value="">session…</option>
              {sessions.map((s) => <option key={s.uuid} value={s.uuid}>{s.started_at.slice(0, 16)}</option>)}
            </select>
            <input type="number" value={sessionSpan.startS} onChange={(e) => setSessionSpan({ ...sessionSpan, startS: Number(e.target.value) })} title="start (session seconds)" />
            <span className="ce-muted">→</span>
            <input type="number" value={sessionSpan.endS} onChange={(e) => setSessionSpan({ ...sessionSpan, endS: Number(e.target.value) })} title="end (session seconds)" />
            <button className="btn btn-mini" disabled={!sessionSpan.uuid || sessionSpan.endS <= sessionSpan.startS}
              onClick={() => { setSource({ kind: 'session', uuid: sessionSpan.uuid, startS: sessionSpan.startS, endS: sessionSpan.endS }); setSpanOpen(false); }}>OPEN</button>
          </span>
        )}
        <span className="ce-grow" />
        {loaded && <span className="ce-title" title={loaded.scene.title}>{look.title || loaded.scene.title}</span>}
        {busy && !exporting && <span className="ce-muted">{progress?.stage === 'audio' ? 'rendering mix' : progress?.stage} {pct}%</span>}
        {spec && <button className="btn btn-mini" title="Download this clip (programme, look, range) as a .clip.json — carries it to another app instance" onClick={() => {
          const url = URL.createObjectURL(new Blob([clipSpecFile(spec)], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(spec.look.title || loaded?.scene.title || 'clip').replace(/[^\w.-]+/g, '-')}.clip.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>SAVE CLIP</button>}
        <label className="btn btn-mini" title="Open a .clip.json (its source opens with it)">
          LOAD CLIP
          <input type="file" accept=".json,application/json" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void file.text().then((text) => {
              const next = parseClipSpecFile(text);
              saveClipSpec(next);
              if (source && sourceKey(source) === sourceKey(next.source)) setSpec(next);
              else setSource(next.source);
              toast('Clip loaded.');
            }).catch((err: unknown) => toast(`Not a clip file: ${err instanceof Error ? err.message : String(err)}`));
          }} />
        </label>
        <button className="btn btn-primary" disabled={!renderDone || busy} onClick={() => void run().catch(() => {})} data-testid="export-button">
          {exporting ? `EXPORTING ${pct}%` : 'EXPORT MP4'}
        </button>
      </header>
      {(loadError || error) && <div className="ce-error" data-testid="load-error">{loadError ?? error}</div>}

      {/* ── Preview + inspector ── */}
      <div className="ce-body">
        <div className="ce-stage">
          <canvas ref={previewRef} width={540} height={960} className="ce-preview" />
          {!source && <div className="ce-empty">Pick a Routine, Transition, Take or Session span.</div>}
          {source && !rendered && !loadError && (
            <div className="ce-empty">
              {loaded ? `Rendering the mix for preview… ${pct}%` : 'Loading…'}
              <div className="ce-progress"><div style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </div>

        {spec && loaded && range && full && (
          <aside className="ce-inspector">
            <nav className="ce-tabs">
              {([['storyboard', 'STORYBOARD'], ['scene', sceneIdx !== null ? `SCENE ${sceneIdx + 1}` : 'SCENE'], ['look', 'BASE LOOK'], ['output', 'OUTPUT']] as [Tab, string][]).map(([t, label]) => (
                <button key={t} className={`btn btn-mini${tab === t ? ' btn-selected' : ''}`}
                  onClick={() => { if (t === 'scene' && sceneIdx === null) setSelectedCue(sceneAtPlayhead); setTab(t); }}>{label}</button>
              ))}
            </nav>

            {tab === 'storyboard' && (
              <div className="ce-pane">
                <details className="ce-group ce-details" open={sortedCues.length <= 1}>
                  <summary><h4>Auto storyboard <span className="ce-muted">scenes on the drops + phrases of the audible tracks</span></h4></summary>
                  <div className="ce-seg">
                    {([['storyboard', 'ARC', 'Mixer-forward intro → blackout into the drop → restyles that brighten the visualizer and strip the UI'], ['rotation', 'ROTATION', 'Presets cycle on drops / phrases; optional varied transitions / look changes']] as const).map(([id, label, title]) => (
                      <button key={id} title={title} className={`btn btn-mini${(auto.style ?? 'storyboard') === id ? ' btn-selected' : ''}`} onClick={() => setAuto({ ...auto, style: id })}>{label}</button>
                    ))}
                  </div>
                  <div className="ce-chips">
                    <span className="ce-muted">presets</span>
                    {auto.presets.map((id, i) => (
                      <button key={id} className="btn btn-mini btn-selected" title="Remove" onClick={() => setAuto({ ...auto, presets: auto.presets.filter((x) => x !== id) })}>
                        {i + 1} {presetName(id)} ×
                      </button>
                    ))}
                  </div>
                  <PresetBrowser
                    selected={auto.presets}
                    ordered
                    height={160}
                    onPick={(id) => setAuto({ ...auto, presets: auto.presets.includes(id) ? auto.presets.filter((x) => x !== id) : [...auto.presets, id] })}
                  />
                  <div className="ce-fields">
                    <label>drop impact
                      <select value={auto.dropImpact} onChange={(e) => setAuto({ ...auto, dropImpact: e.target.value as VizImpact })}>
                        {IMPACTS.map((i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </label>
                    <label>phrase impact
                      <select value={auto.phraseImpact} onChange={(e) => setAuto({ ...auto, phraseImpact: e.target.value as VizImpact })}>
                        {IMPACTS.map((i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </label>
                    <label>min gap s<input type="number" min={4} step={1} value={auto.minGapSec} onChange={(e) => setAuto({ ...auto, minGapSec: Number(e.target.value) })} /></label>
                    <label className="ce-check"><input type="checkbox" checked={auto.phrasePulses} onChange={(e) => setAuto({ ...auto, phrasePulses: e.target.checked })} />phrase pulses</label>
                    {auto.style === 'rotation' && <>
                      <label className="ce-check"><input type="checkbox" checked={!!auto.transitions} onChange={(e) => setAuto({ ...auto, transitions: e.target.checked })} />vary transitions</label>
                      <label className="ce-check"><input type="checkbox" checked={!!auto.lookChanges} onChange={(e) => setAuto({ ...auto, lookChanges: e.target.checked })} />look changes</label>
                    </>}
                  </div>
                  <button className="btn" disabled={!metric} onClick={() => { if (metric) { setCues(autoVizCues(metric, range, auto, secPerBar)); setSelectedCue(null); } }}>GENERATE STORYBOARD</button>
                </details>

                <section className="ce-group">
                  <h4>Scenes <span className="ce-muted">{sortedCues.length} · click to edit preset + look together · default crossfade
                    <input className="ce-inline-num" type="number" step={0.5} min={0} value={spec.viz.crossfadeSec} onChange={(e) => update({ viz: { ...spec.viz, crossfadeSec: Number(e.target.value) } })} /> s</span></h4>
                  <div className="ce-scenes">
                    {sortedCues.map((cue, i) => {
                      const pulse = i > 0 && sortedCues[i - 1].presetId === cue.presetId && !cue.look && !cue.transition;
                      const end = sortedCues.slice(i + 1).find((c) => c.presetId !== cue.presetId || c.look)?.atSec ?? clipDur;
                      return (
                        <div key={`${i}-${cue.atSec}`}
                          className={`ce-scene${selectedCue === i ? ' ce-scene-selected' : ''}${sceneAtPlayhead === i ? ' ce-scene-now' : ''}${pulse ? ' ce-scene-pulse' : ''}`}
                          onClick={() => openScene(i)}>
                          <div className="ce-thumb" style={(sceneThumbs.get(sceneThumbKey(i)) ?? thumbs.get(cue.presetId)) ? { backgroundImage: `url(${sceneThumbs.get(sceneThumbKey(i)) ?? thumbs.get(cue.presetId)})` } : undefined} />
                          <div className="ce-scene-main">
                            <div className="ce-scene-line">
                              <span className="ce-cue-time">{fmt(cue.atSec, true)}</span>
                              <span className="ce-cue-preset">{pulse ? <span className="ce-muted">pulse · {cue.impact ?? 'none'}</span> : presetName(cue.presetId)}</span>
                              {!pulse && <span className="ce-muted">{Math.max(0, end - cue.atSec).toFixed(0)}s</span>}
                            </div>
                            <div className="ce-scene-line">
                              {transitionBadge(cue.transition) && <span className="ce-badge ce-badge-tr">{transitionBadge(cue.transition)}</span>}
                              {cue.impact && cue.impact !== 'none' && !pulse && <span className="ce-muted">{cue.impact}</span>}
                              {lookSummary(i).map((t) => <span key={t} className="ce-badge ce-badge-look">{t}</span>)}
                            </div>
                          </div>
                          {i > 0 && <button className="btn btn-mini" title="Remove scene" onClick={(e) => { e.stopPropagation(); setCues(sortedCues.filter((_, k) => k !== i)); setSelectedCue(null); }}>×</button>}
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn btn-mini" onClick={() => {
                    const at = snap(previewT - range.startSec);
                    const prev = [...sortedCues].reverse().find((c) => c.atSec <= at);
                    const next = [...sortedCues, { atSec: at, presetId: prev?.presetId ?? 'voyage', impact: 'flash' as const }].sort((a, b) => a.atSec - b.atSec);
                    setCues(next);
                    setSelectedCue(next.findIndex((c) => c.atSec === at));
                    setTab('scene');
                  }}>+ SCENE AT PLAYHEAD <span className="ce-muted">(snaps to phrase)</span></button>
                </section>
              </div>
            )}

            {tab === 'scene' && (
              <div className="ce-pane">
                {!sceneCue && <span className="ce-muted">Pick a scene in STORYBOARD or on the timeline.</span>}
                {sceneCue && sceneIdx !== null && (() => {
                  const cue = sceneCue;
                  const preset = isPresetLoaded(cue.presetId) ? exportPresetById(cue.presetId) : null;
                  const params = cue.params ?? {};
                  const setParam = (pid: string, v: number | null) => {
                    const next = { ...params };
                    if (v === null) delete next[pid]; else next[pid] = v;
                    patchCue(sceneIdx, { params: next });
                  };
                  const changed = Object.keys(cue.look ?? {}).length;
                  const prevLook = sceneIdx > 0 ? sortedCues[sceneIdx - 1].look : undefined;
                  return (
                    <>
                      <div className="ce-scene-head">
                        <button className="btn btn-mini" disabled={sceneIdx === 0} onClick={() => openScene(sceneIdx - 1)}>◀</button>
                        <b>SCENE {sceneIdx + 1}/{sortedCues.length}</b>
                        <button className="btn btn-mini" disabled={sceneIdx >= sortedCues.length - 1} onClick={() => openScene(sceneIdx + 1)}>▶</button>
                        <label className="ce-muted">at <input className="ce-inline-num" type="number" step={0.1} min={0} disabled={sceneIdx === 0} value={Number(cue.atSec.toFixed(2))}
                          onChange={(e) => patchCue(sceneIdx, { atSec: Math.max(0.1, Number(e.target.value)) })} /> s</label>
                        <select className="ce-cue-impact" value={cue.impact ?? 'none'} onChange={(e) => patchCue(sceneIdx, { impact: e.target.value as VizImpact })} title="Impact on the cue">
                          {IMPACTS.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <button className="btn btn-mini" title="Preview this scene" onClick={() => previewAfterCue(cue)}>◉ PREVIEW</button>
                        <span className="ce-grow" />
                        {sceneIdx > 0 && <button className="btn btn-mini" title="Remove scene" onClick={() => { setCues(sortedCues.filter((_, k) => k !== sceneIdx)); setSelectedCue(null); setTab('storyboard'); }}>DELETE</button>}
                      </div>

                      <div className="ce-group">
                        <div className="ce-scene-viz">
                          <div className="ce-thumb ce-thumb-lg" style={sceneThumbs.get(sceneThumbKey(sceneIdx)) ? { backgroundImage: `url(${sceneThumbs.get(sceneThumbKey(sceneIdx))})` } : undefined} />
                          <div className="ce-scene-main">
                            <h4>Visualizer</h4>
                            <div className="ce-seg">
                              <button className="btn btn-mini" title="Previous preset" onClick={() => stepPreset(sceneIdx, -1)}>◀</button>
                              <b className="ce-scene-preset">{presetName(cue.presetId)}</b>
                              <button className="btn btn-mini" title="Next preset" onClick={() => stepPreset(sceneIdx, 1)}>▶</button>
                              <button className={`btn btn-mini${browseOpen ? ' btn-selected' : ''}`} onClick={() => setBrowseOpen(!browseOpen)}>BROWSE</button>
                              {preset && (preset.params ?? []).length > 0 && <button className={`btn btn-mini${paramsOpen ? ' btn-selected' : ''}`} onClick={() => setParamsOpen(!paramsOpen)}>PARAMS{Object.keys(params).length ? ` ${Object.keys(params).length}` : ''}</button>}
                            </div>
                            <span className="ce-muted">◀ ▶ step through the storyboard presets · BROWSE for all {presetCatalogue().length}</span>
                          </div>
                        </div>
                        {browseOpen && <PresetBrowser selected={[cue.presetId]} height={150} onPick={(id) => { patchCue(sceneIdx, { presetId: id, params: id === cue.presetId ? cue.params : undefined }); previewAfterCue(cue); }} />}
                        {paramsOpen && preset && (preset.params ?? []).length > 0 && (
                          <div className="ce-sliders">
                            {(preset.params ?? []).map((pp) => {
                              const v = params[pp.id] ?? pp.default;
                              return (
                                <label key={pp.id}><span>{pp.label}</span>
                                  <input type="range" min={pp.min} max={pp.max} step={pp.step} value={v} onChange={(e) => setParam(pp.id, Number(e.target.value))} />
                                  <span className="ce-val" title="double-click to reset" onDoubleClick={() => setParam(pp.id, null)}>{v.toFixed(pp.step < 0.1 ? 2 : 1)}</span>
                                </label>
                              );
                            })}
                            <button className="btn btn-mini" onClick={() => patchCue(sceneIdx, { params: undefined })}>RESET PARAMETERS</button>
                          </div>
                        )}
                      </div>

                      <details className="ce-group ce-details" open={!!cue.transition}>
                        <summary><h4>Arrives with <span className="ce-muted">{transitionBadge(cue.transition) || 'crossfade'}</span></h4></summary>
                        {renderTransition(cue, sceneIdx)}
                      </details>

                      <div className="ce-group">
                        <h4>Look <span className="ce-muted">{changed === 0 ? 'same as before this scene' : `${changed} change${changed > 1 ? 's' : ''} from here on (magenta)`}</span></h4>
                        <div className="ce-seg">
                          {changed > 0 && <button className="btn btn-mini" title="This scene inherits the look" onClick={() => patchCue(sceneIdx, { look: undefined })}>CLEAR CHANGES</button>}
                          {prevLook && <button className="btn btn-mini" title="Repeat the previous scene's look changes" onClick={() => { patchCue(sceneIdx, { look: { ...prevLook } }); previewAfterCue(cue); }}>COPY PREVIOUS SCENE</button>}
                        </div>
                      </div>
                      <LookControls look={sceneLook} onChange={setSceneLook} overrides={cue.look ?? {}} onClear={clearSceneLook} />
                    </>
                  );
                })()}
              </div>
            )}

            {tab === 'look' && (
              <div className="ce-pane">
                <span className="ce-muted">The clip's starting look; scenes change it from their cue on.</span>
                <LookControls look={look} onChange={updateLook} onCaption={rememberHandle}>
                  <label className="ce-wide">file name<input type="text" placeholder={loaded.scene.title} value={look.title} onChange={(e) => updateLook({ title: e.target.value })} /></label>
                </LookControls>
              </div>
            )}

            {tab === 'output' && (
              <div className="ce-pane">
                <section className="ce-group">
                  <h4>Range <span className="ce-muted">{fmt(clipDur)} of {fmt(full.endSec - full.startSec)}</span></h4>
                  <div className="ce-fields">
                    <label>in<input type="number" step={0.5} value={(range.startSec - full.startSec).toFixed(1)} onChange={(e) => update({ range: { startSec: full.startSec + Number(e.target.value), endSec: range.endSec } })} /></label>
                    <label>out<input type="number" step={0.5} value={(range.endSec - full.startSec).toFixed(1)} onChange={(e) => update({ range: { startSec: range.startSec, endSec: full.startSec + Number(e.target.value) } })} /></label>
                    <label>fade in s<input type="number" step={0.1} min={0} value={spec.fadeInSec} onChange={(e) => update({ fadeInSec: Number(e.target.value) })} /></label>
                    <label>fade out s<input type="number" step={0.1} min={0} value={spec.fadeOutSec} onChange={(e) => update({ fadeOutSec: Number(e.target.value) })} /></label>
                  </div>
                  <button className="btn btn-mini" onClick={() => update({ range: null })}>WHOLE MIX</button>
                </section>
                <section className="ce-group">
                  <h4>Video</h4>
                  <div className="ce-seg">
                    <span className="ce-muted">fps</span>
                    {[30, 60].map((f) => <button key={f} className={`btn btn-mini${spec.fps === f ? ' btn-selected' : ''}`} onClick={() => update({ fps: f })}>{f}</button>)}
                    <span className="ce-muted">{spec.width}×{spec.height} · H.264 + AAC</span>
                  </div>
                  {progress && exporting && (
                    <div data-testid="export-progress">
                      <div className="ce-muted">{progress.stage} {pct}% {progress.detail ?? ''}</div>
                      <div className="ce-progress"><div style={{ width: `${pct}%` }} /></div>
                    </div>
                  )}
                  {result?.url && (
                    <div data-testid="export-result" className="ce-result">
                      <span>{result.frames} frames · {result.seconds.toFixed(1)} s</span>
                      <a href={result.url} target="_blank" rel="noreferrer">{result.path}</a>
                    </div>
                  )}
                </section>
              </div>
            )}
          </aside>
        )}
        <div className="ce-picker">
          <MixPicker
            openPair={null}
            openRefKey={pickerRefKey}
            tracks={allTracks}
            transitions={transitionRows}
            cameos={cameoRows}
            routines={routineRows}
            routineTakes={unpromotedTakes}
            candidates={unconfirmedCandidates}
            takes={takeRows}
            deckTracks={deckTracks}
            busy={false}
            onOpen={onPick}
            onRenameTransition={noopEdit}
            onToggleFavoriteTransition={noopEdit}
            onDeleteTransition={noopEdit}
            trackById={trackById}
          />
        </div>
      </div>

      {/* ── Transport + timeline ── */}
      {loaded && range && full && spec && (
        <footer className="ce-transport">
          <div className="ce-transport-row">
            <button className="btn btn-mini ce-play" disabled={!rendered || (busy && renderDone)} onClick={() => (playing ? stopAudio() : play())}>{playing ? '❚❚' : '▶'}</button>
            <span className="ce-clock">{fmt(previewT - range.startSec, true)} <span className="ce-muted">/ {fmt(clipDur, true)}</span></span>
            <button className="btn btn-mini" onClick={() => update({ range: { startSec: Math.min(previewT, range.endSec - 2), endSec: range.endSec } })} title="Clip starts at the playhead">IN ⇤</button>
            <button className="btn btn-mini" onClick={() => update({ range: { startSec: range.startSec, endSec: Math.max(previewT, range.startSec + 2) } })} title="Clip ends at the playhead">⇥ OUT</button>
            {rendered && !renderDone && <span className="ce-muted">rendering {pct}% · preview ready to {fmt(Math.max(0, readyUntil - range.startSec))}</span>}
            <span className="ce-grow" />
            <span className="ce-legend"><i className="ce-dot-drop" />drop <i className="ce-dot-cue" />cue <i className="ce-dot-pulse" />pulse</span>
          </div>
          <ClipTimeline
            routine={loaded.routine}
            full={full}
            range={range}
            t={previewT}
            metric={rendered ? metric : null}
            readyUntil={renderDone ? null : readyUntil}
            cues={sortedCues}
            crossfadeSec={spec.viz.crossfadeSec}
            selectedCue={selectedCue}
            onSeek={(t) => { if (playing) stopAudio(); setPreviewT(t); }}
            onRange={(r) => update({ range: r })}
            onCueMove={(i, at) => patchCue(i, { atSec: at })}
            onCueSelect={(i) => { if (i !== null) openScene(i); else setSelectedCue(null); }}
          />
        </footer>
      )}
    </div>
  );
}
