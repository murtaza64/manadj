import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { INITIAL_TREND, SILENT_BANDS } from './bands';
import type { BandLevels, EnergyTrend } from './bands';
import {
  PING_INTERVAL_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
} from './channel';
import type {
  BeatInfo,
  DeckStateInfo,
  VisualizerFrame,
  VisualizerMessage,
  VisualizerPing,
} from './channel';
import { presetById } from './presets';
import {
  aliveCandidateListings,
  ensureCandidate,
  getCachedCandidate,
  isCandidateId,
} from './presets/gen';
import type { PresetRenderer, VisualizerPreset } from './presets/types';
import { BACKEND_URL } from '../api/client';
import {
  countSoloReviews,
  INITIAL_CYCLE,
  nextCandidateId,
  sampleParamValues,
  stepCycle,
} from './soloReview';
import type { CycleMode, CycleState, SoloVerdict } from './soloReview';
import {
  getParamValues,
  getPresetId,
  getRenderQuality,
  RENDER_QUALITIES,
  setParamValue,
  setPresetId,
  setRenderQuality,
  subscribeParams,
  subscribePreset,
  subscribeQuality,
} from './visualizerStore';
import type { RenderQuality } from './visualizerStore';
import { VisualizerHud } from './VisualizerHud';
import './VisualizerApp.css';

/** Band feed older than this renders as silence (main window gone/paused). */
const STALE_MS = 1000;
/** Genepool candidates surfaced in the switcher while the marathon runs
 * (realtime-viz 06, human ask): alive manifest entries, best-rated first. */
const GEN_LISTINGS = aliveCandidateListings();
/** Resolve a preset id across both worlds: curated registry, or the gen
 * candidate cache (null while a gen module is still loading). */
function resolvePreset(id: string): VisualizerPreset | null {
  if (isCandidateId(id)) return getCachedCandidate(id);
  return presetById(id);
}
const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);
/** Chrome (preset switcher etc.) hides after this much mouse stillness. */
const CHROME_HIDE_MS = 2500;
/** Preset morph length: both renderers run and cross-blend additively —
 * the Milkdrop/butterchurn blending model (render both, blend), not
 * parametric morphing. */
const MORPH_S = 0.8;

/** Backing-store pixel budget (~1080p-class). Fullscreen on a 4K HDMI
 * display, an unbounded retina canvas is ~8-16 MP of additive full-canvas
 * compositing per frame — enough GPU/compositor load to starve the
 * MAIN window's audio output into underrun loops (the "chops on one
 * instant" HDMI stutter). The canvas renders within the budget and CSS
 * upscales; at projection distance the difference is invisible. */
const MAX_BACKING_PIXELS = 1920 * 1080;
/** GL presets shade per pixel cheaply; give them ~1440p. */
const MAX_BACKING_PIXELS_HIRES = 2560 * 1440;
/** Explicit quality tiers (opt-in upgrade past the audio-safe auto budget;
 * 'native' = full clientSize × devicePixelRatio, no cap). */
const QUALITY_BUDGETS: Record<Exclude<RenderQuality, 'auto'>, number> = {
  hd: 1920 * 1080,
  qhd: 2560 * 1440,
  uhd: 3840 * 2160,
  native: Infinity,
};
const QUALITY_LABELS: Record<RenderQuality, string> = {
  auto: 'auto',
  hd: '1080',
  qhd: '1440',
  uhd: '4K',
  native: 'max',
};

/** Solo review (rt-viz 06): rate the CURRENT candidate while DJing.
 * g like · b dislike · m neutral · t note · n next · c auto-cycle mode. */
const CYCLE_MODES: CycleMode[] = ['off', 'timer', 'drop'];
const CYCLE_LABELS: Record<CycleMode, string> = {
  off: 'cycle off',
  timer: 'cycle 45s',
  drop: 'cycle post-drop',
};
const CYCLE_KEY = 'manadj-visualizer-cycle';

async function postGaEvent(event: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/ga/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // review capture is best-effort; never disturb the render loop
  }
}

/** Canvas backing size for the current client size, within the budget. */
function backingSize(
  canvas: HTMLCanvasElement,
  budget = MAX_BACKING_PIXELS
): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  let width = Math.max(1, canvas.clientWidth * dpr);
  let height = Math.max(1, canvas.clientHeight * dpr);
  const scale = Math.sqrt(budget / (width * height));
  if (scale < 1) {
    width *= scale;
    height *= scale;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** A live renderer with its own layer canvas: presets own their layer's
 * persistence (phosphor washes, feedback buffers), the compositor never
 * clears layers — only the visible canvas. */
interface Layer {
  preset: VisualizerPreset;
  renderer: PresetRenderer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeLayer(preset: VisualizerPreset, width: number, height: number): Layer | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { preset, renderer: preset.create(), canvas, ctx };
}

/** smoothstep — eases the morph in and out. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * The visualizer window (realtime-visualization 01/02): a standalone root
 * rendered by App.tsx's pathname branch — NO DeckProvider, no Mixer, never
 * an AudioContext. Band/wave/beat data arrives over the BroadcastChannel
 * from the main window's VisualizerBridge; this window pings to keep the
 * feed alive (declaring what the active preset needs), renders the active
 * preset on its own rAF — cross-morphing on preset switches — and owns the
 * preset switcher + fullscreen chrome (the path to a dedicated HDMI
 * display: fullscreen this window on the second screen).
 */
export function VisualizerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef<{
    bands: BandLevels;
    spectrum: number[];
    wave: { left: Float32Array; right: Float32Array } | null;
    beat: BeatInfo | null;
    impulse: BandLevels;
    trend: EnergyTrend;
    centroid: number;
    spread: number;
    flatness: number;
    decks: DeckStateInfo[];
    receivedAt: number;
    bandsSlow: BandLevels;
    regime: NonNullable<VisualizerFrame['regime']> | null;
    dominantChannel: 'A' | 'B' | 'C' | 'D' | null;
  }>({
    bandsSlow: SILENT_BANDS,
    regime: null,
    dominantChannel: null,
    bands: SILENT_BANDS,
    spectrum: SILENT_SPECTRUM,
    wave: null,
    beat: null,
    impulse: SILENT_BANDS,
    trend: INITIAL_TREND,
    centroid: 0.5,
    spread: 0.5,
    flatness: 0.5,
    decks: [],
    receivedAt: -Infinity,
  });
  const presetId = useSyncExternalStore(subscribePreset, getPresetId);
  const layersRef = useRef<{ current: Layer | null; outgoing: Layer | null; morphT: number }>({
    current: null,
    outgoing: null,
    morphT: 1,
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [hudVisible, setHudVisible] = useState(
    () => localStorage.getItem('manadj-visualizer-hud') === 'true'
  );
  const toggleHud = () =>
    setHudVisible((v) => {
      localStorage.setItem('manadj-visualizer-hud', String(!v));
      return !v;
    });
  const [genTick, setGenTick] = useState(0);
  const [genFilter, setGenFilter] = useState('');
  const quality = useSyncExternalStore(subscribeQuality, getRenderQuality);
  // ---- Solo review state (rt-viz 06): counts + toast + auto-cycle.
  const soloCountsRef = useRef<Record<string, number>>({});
  const cycleRef = useRef<CycleState>({ ...INITIAL_CYCLE, lastAdvanceAt: performance.now() });
  const [cycleMode, setCycleMode] = useState<CycleMode>(() => {
    const stored = localStorage.getItem(CYCLE_KEY);
    return CYCLE_MODES.includes(stored as CycleMode) ? (stored as CycleMode) : 'off';
  });
  const cycleModeRef = useRef(cycleMode);
  cycleModeRef.current = cycleMode;
  const [toast, setToast] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };
  // Quality change → recompute backing sizes (the render loop's resize
  // handler reads the store directly).
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [quality]);
  const activePreset = resolvePreset(presetId) ?? presetById(presetId);
  const paramValues = useSyncExternalStore(subscribeParams, () => getParamValues(activePreset));
  const [stalled, setStalled] = useState(true);

  useEffect(() => {
    document.title = 'manaDJ visualizer';
    document.documentElement.classList.add('visualizer-root');
    return () => document.documentElement.classList.remove('visualizer-root');
  }, []);

  // Preset switch → begin a morph: the old layer keeps rendering while the
  // new one fades in additively.
  useEffect(() => {
    const layers = layersRef.current;
    if (layers.current?.preset.id === presetId) return;
    const resolved = resolvePreset(presetId);
    if (!resolved) {
      // Gen candidate module not loaded yet: fetch it, then re-run.
      void ensureCandidate(presetId).then((preset) => {
        if (preset) setGenTick((t) => t + 1);
      });
      return;
    }
    const canvas = canvasRef.current;
    const width = canvas?.width ?? 1;
    const height = canvas?.height ?? 1;
    const next = makeLayer(resolved, width, height);
    if (!next) return;
    if (layers.current) {
      layers.outgoing = layers.current;
      layers.morphT = 0;
    }
    layers.current = next;
    window.dispatchEvent(new Event('resize'));
  }, [presetId, genTick]);

  // Band feed: ping so the main-window bridge transmits (declaring wave
  // needs); keep the latest frame in a ref — feed data must never be React
  // state (frame rate).
  useEffect(() => {
    const channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type === 'set-preset') {
        // Remote switch from the main window's control modal (03).
        setPresetId(event.data.presetId);
        return;
      }
      if (event.data?.type === 'set-param') {
        // Remote tweak from the modal (05).
        setParamValue(event.data.presetId, event.data.paramId, event.data.value);
        return;
      }
      if (event.data?.type !== 'bands') return;
      feedRef.current = {
        bands: event.data.bands,
        spectrum: event.data.spectrum ?? SILENT_SPECTRUM,
        wave: event.data.wave ?? null,
        beat: event.data.beat ?? null,
        impulse: event.data.impulse ?? SILENT_BANDS,
        trend: event.data.trend ?? INITIAL_TREND,
        centroid: event.data.centroid ?? 0.5,
        spread: event.data.spread ?? 0.5,
        flatness: event.data.flatness ?? 0.5,
        bandsSlow: event.data.bandsSlow ?? event.data.bands,
        regime: event.data.regime ?? null,
        dominantChannel: event.data.dominantChannel ?? null,
        decks: event.data.decks ?? [],
        receivedAt: performance.now(),
      };
    };
    const ping = () => {
      const layers = layersRef.current;
      const message: VisualizerPing = {
        type: 'ping',
        wantsWave: !!(
          layers.current?.preset.wantsWave || layers.outgoing?.preset.wantsWave
        ),
        presetId: getPresetId(),
        params: getParamValues(presetById(getPresetId())),
      };
      channel.postMessage(message);
    };
    ping();
    const pingTimer = setInterval(ping, PING_INTERVAL_MS);
    // Low-rate staleness poll for the "no signal" hint (state is fine here).
    const staleTimer = setInterval(() => {
      setStalled(performance.now() - feedRef.current.receivedAt > STALE_MS);
    }, 500);
    return () => {
      clearInterval(pingTimer);
      clearInterval(staleTimer);
      channel.close();
    };
  }, []);

  // Render loop: mounted once; renders the layer stack and composites.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const layers = layersRef.current;
      const hiRes = !!(layers.current?.preset.hiRes || layers.outgoing?.preset.hiRes);
      const q = getRenderQuality();
      const budget =
        q === 'auto'
          ? hiRes
            ? MAX_BACKING_PIXELS_HIRES
            : MAX_BACKING_PIXELS
          : QUALITY_BUDGETS[q];
      const { width, height } = backingSize(canvas, budget);
      canvas.width = width;
      canvas.height = height;
      for (const layer of [layers.current, layers.outgoing]) {
        if (!layer) continue;
        layer.canvas.width = width;
        layer.canvas.height = height;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let rafId = 0;
    let startedAt = 0;
    let lastAt = 0;
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const dt = lastAt > 0 ? Math.min(0.1, (now - lastAt) / 1000) : 1 / 60;
      lastAt = now;
      const fresh = now - feedRef.current.receivedAt <= STALE_MS;
      const frame = {
        bands: fresh ? feedRef.current.bands : SILENT_BANDS,
        bandsSlow: fresh ? feedRef.current.bandsSlow : SILENT_BANDS,
        regime: fresh ? feedRef.current.regime : null,
        dominantChannel: fresh ? feedRef.current.dominantChannel : null,
        spectrum: fresh ? feedRef.current.spectrum : SILENT_SPECTRUM,
        wave: fresh ? feedRef.current.wave : null,
        beat: fresh ? feedRef.current.beat : null,
        impulse: fresh ? feedRef.current.impulse : SILENT_BANDS,
        trend: fresh ? feedRef.current.trend : INITIAL_TREND,
        centroid: fresh ? feedRef.current.centroid : 0.5,
        spread: fresh ? feedRef.current.spread : 0.5,
        flatness: fresh ? feedRef.current.flatness : 0.5,
        decks: fresh ? feedRef.current.decks : [],
        params: {},
        time: (now - startedAt) / 1000,
        dt,
      };

      const layers = layersRef.current;
      const width = canvas.width;
      const height = canvas.height;
      if (layers.current) {
        if (
          layers.current.canvas.width !== width ||
          layers.current.canvas.height !== height
        ) {
          layers.current.canvas.width = width;
          layers.current.canvas.height = height;
        }
        layers.current.renderer.render(layers.current.ctx, width, height, {
          ...frame,
          params: getParamValues(layers.current.preset),
        });
      }
      if (layers.outgoing) {
        layers.morphT += dt / MORPH_S;
        if (layers.morphT >= 1) {
          layers.outgoing = null;
        } else {
          layers.outgoing.renderer.render(layers.outgoing.ctx, width, height, {
            ...frame,
            params: getParamValues(layers.outgoing.preset),
          });
        }
      }

      // Composite: black stage, then layers blended additively — the
      // outgoing scene dissolves as the incoming one rises through it.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      const blend = ease(layers.morphT);
      ctx.globalCompositeOperation = layers.outgoing ? 'lighter' : 'source-over';
      if (layers.outgoing) {
        ctx.globalAlpha = 1 - blend;
        ctx.drawImage(layers.outgoing.canvas, 0, 0);
      }
      if (layers.current) {
        ctx.globalAlpha = layers.outgoing ? blend : 1;
        ctx.drawImage(layers.current.canvas, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Auto-hiding chrome: any pointer activity shows it, stillness hides it.
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const poke = () => {
      setChromeVisible(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
    };
    poke();
    window.addEventListener('mousemove', poke);
    window.addEventListener('mousedown', poke);
    window.addEventListener('keydown', poke);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener('mousemove', poke);
      window.removeEventListener('mousedown', poke);
      window.removeEventListener('keydown', poke);
    };
  }, []);

  // Close keys: Escape (exits fullscreen first if active) and Cmd/Ctrl+W.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else window.close();
      } else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) {
        toggleHud();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        window.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Solo review: seed counts from the event log (once per window).
  useEffect(() => {
    let disposed = false;
    void fetch(`${BACKEND_URL}/api/ga/state`)
      .then((r) => r.json())
      .then((s: { events?: { type?: string; target?: string }[] }) => {
        if (!disposed && s.events) soloCountsRef.current = countSoloReviews(s.events);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  // ---- Solo review actions + hotkeys (g/b/m/t/n/c). Store getters keep
  // these closure-safe; registered once.
  const advanceRef = useRef<() => void>(() => {});
  useEffect(() => {
    const advance = () => {
      const id = nextCandidateId(
        GEN_LISTINGS,
        soloCountsRef.current,
        getPresetId()
      );
      if (id) {
        setPresetId(id);
        cycleRef.current.lastAdvanceAt = performance.now();
        // Local exposure bump: skipping with `n` counts as having seen it,
        // so this session cycles through unseen presets without repeats.
        soloCountsRef.current[id] = (soloCountsRef.current[id] ?? 0) + 1;
        // Parameter-genotype exploration: each solo-flow load presents a
        // different tuning; the verdict snapshot records what was shown.
        void ensureCandidate(id).then((preset) => {
          if (!preset?.params || getPresetId() !== id) return;
          const sampled = sampleParamValues(
            preset.params.map((p) => ({
              id: p.id,
              min: p.min,
              max: p.max,
              step: p.step,
              default: p.default,
            }))
          );
          for (const [paramId, value] of Object.entries(sampled)) {
            setParamValue(id, paramId, value);
          }
        });
      }
    };
    advanceRef.current = advance;
    const verdict = (outcome: SoloVerdict) => {
      const id = getPresetId();
      if (!isCandidateId(id)) {
        showToast(`${id} is curated — verdicts target genepool candidates`);
        return;
      }
      const preset = resolvePreset(id);
      void postGaEvent({
        type: 'solo',
        target: id,
        outcome,
        paramsA: preset ? getParamValues(preset) : undefined,
      });
      soloCountsRef.current[id] = (soloCountsRef.current[id] ?? 0) + 1;
      // Verdicts do NOT auto-advance (human: keep watching until I move on).
      showToast(`${outcome === 'like' ? '👍' : outcome === 'dislike' ? '👎' : '·'} ${outcome} — ${id}`);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (k === 'g') verdict('like');
      else if (k === 'b') verdict('dislike');
      else if (k === 'm') verdict('neutral');
      else if (k === 'n') advance();
      else if (k === 't') {
        // Inline note input — window.prompt is a no-op in the Electron
        // renderer (the "t key doesn't work" bug).
        e.preventDefault();
        setNoteFor(getPresetId());
      } else if (k === 'c') {
        setCycleMode((prev) => {
          const next = CYCLE_MODES[(CYCLE_MODES.indexOf(prev) + 1) % CYCLE_MODES.length];
          localStorage.setItem(CYCLE_KEY, next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Any preset change → toast the new preset's name (chip, n, cycle).
  const prevPresetRef = useRef(presetId);
  useEffect(() => {
    if (prevPresetRef.current !== presetId) {
      prevPresetRef.current = presetId;
      showToast(`▶ ${presetId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  // ---- Auto-cycle: timer / N-beats-after-drop stepper (soloReview.ts).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const mode = cycleModeRef.current;
      if (mode === 'off') return;
      const feed = feedRef.current;
      const { state, advance } = stepCycle(
        cycleRef.current,
        mode,
        performance.now(),
        feed.trend.excitement,
        feed.beat?.bpm ?? null
      );
      cycleRef.current = state;
      if (advance) advanceRef.current();
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = () => {
    const bridge = window.manadjVisualizer;
    if (bridge) {
      void bridge.toggleFullscreen();
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  return (
    <div className={`visualizer${chromeVisible ? '' : ' chrome-hidden'}`}>
      <canvas ref={canvasRef} className="visualizer-canvas" />
      {hudVisible && <VisualizerHud getSnapshot={() => feedRef.current} />}
      {stalled && (
        <div className="visualizer-nosignal">
          waiting for manaDJ audio — keep the main window open
        </div>
      )}
      {toast && <div className="visualizer-toast">{toast}</div>}
      {noteFor && (
        <div className="visualizer-note">
          <span>note — {noteFor}</span>
          <input
            autoFocus
            type="text"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                const text = (e.target as HTMLInputElement).value.trim();
                if (text) {
                  void postGaEvent({ type: 'note', target: noteFor, text });
                  showToast(`noted — ${noteFor}`);
                }
                setNoteFor(null);
              } else if (e.key === 'Escape') setNoteFor(null);
            }}
          />
        </div>
      )}
      {chromeVisible && (
        <div className="visualizer-solo-legend">
          {presetId} · g like · b dislike · m meh · t note · n next · c {CYCLE_LABELS[cycleMode]}
        </div>
      )}
      <div className="visualizer-chrome">
        <div className="visualizer-chrome-left">
        {/* All presets are equal (2026-08-18): one score-sorted list; the
            curated set is present as its g00-* seeds. */}
        <div className="visualizer-genpanel">
          <input
            className="visualizer-gen-search"
            type="search"
            placeholder={`filter ${GEN_LISTINGS.length} presets…`}
            value={genFilter}
            onChange={(e) => setGenFilter(e.target.value)}
          />
          <div className="visualizer-genlist">
            {GEN_LISTINGS.filter(({ id }) =>
              id.toLowerCase().includes(genFilter.trim().toLowerCase())
            ).map(({ id, score }) => (
              <button
                key={id}
                className={`visualizer-preset-btn gen${id === presetId ? ' active' : ''}`}
                title={`score ${score >= 0 ? '+' : ''}${score}`}
                onClick={() => setPresetId(id)}
              >
                {id}{' '}
                <span className="visualizer-preset-rating">
                  {score >= 0 ? `+${score}` : score}
                </span>
              </button>
            ))}
          </div>
        </div>
        </div>
        <button
          className={`visualizer-preset-btn cycle${cycleMode !== 'off' ? ' active' : ''}`}
          title="Auto-cycle candidates (c): off → every 45s → 128 beats after each drop"
          onClick={() =>
            setCycleMode((prev) => {
              const next = CYCLE_MODES[(CYCLE_MODES.indexOf(prev) + 1) % CYCLE_MODES.length];
              localStorage.setItem(CYCLE_KEY, next);
              return next;
            })
          }
        >
          {CYCLE_LABELS[cycleMode]}
        </button>
        <div className="visualizer-quality" title="Render quality (backing-store budget; auto = audio-safe default)">
          {RENDER_QUALITIES.map((q: RenderQuality) => (
            <button
              key={q}
              className={`visualizer-preset-btn quality${q === quality ? ' active' : ''}`}
              onClick={() => setRenderQuality(q)}
            >
              {QUALITY_LABELS[q]}
            </button>
          ))}
        </div>
        <button
          className="visualizer-fullscreen-btn"
          title="Debug HUD (h)"
          onClick={toggleHud}
        >
          HUD
        </button>
        <button
          className="visualizer-fullscreen-btn"
          title="Toggle fullscreen"
          onClick={toggleFullscreen}
        >
          ⛶
        </button>
      </div>
      {(activePreset.params?.length ?? 0) > 0 && (
        <div className="visualizer-params">
          {activePreset.params!.map((param) => (
            <label key={param.id} className="visualizer-param">
              <span>{param.label}</span>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={paramValues[param.id] ?? param.default}
                onChange={(e) => setParamValue(activePreset.id, param.id, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default VisualizerApp;
