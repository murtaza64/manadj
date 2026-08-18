import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SILENT_BANDS } from './bands';
import type { BandLevels } from './bands';
import {
  PING_INTERVAL_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
} from './channel';
import type { BeatInfo, VisualizerMessage, VisualizerPing } from './channel';
import { PRESETS, presetById } from './presets';
import type { PresetRenderer, VisualizerPreset } from './presets/types';
import { getPresetId, setPresetId, subscribePreset } from './visualizerStore';
import './VisualizerApp.css';

/** Band feed older than this renders as silence (main window gone/paused). */
const STALE_MS = 1000;
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

/** Canvas backing size for the current client size, within the budget. */
function backingSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  let width = Math.max(1, canvas.clientWidth * dpr);
  let height = Math.max(1, canvas.clientHeight * dpr);
  const scale = Math.sqrt(MAX_BACKING_PIXELS / (width * height));
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
    receivedAt: number;
  }>({
    bands: SILENT_BANDS,
    spectrum: SILENT_SPECTRUM,
    wave: null,
    beat: null,
    receivedAt: -Infinity,
  });
  const presetId = useSyncExternalStore(subscribePreset, getPresetId);
  const layersRef = useRef<{ current: Layer | null; outgoing: Layer | null; morphT: number }>({
    current: null,
    outgoing: null,
    morphT: 1,
  });
  const [chromeVisible, setChromeVisible] = useState(true);
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
    const canvas = canvasRef.current;
    const width = canvas?.width ?? 1;
    const height = canvas?.height ?? 1;
    const next = makeLayer(presetById(presetId), width, height);
    if (!next) return;
    if (layers.current) {
      layers.outgoing = layers.current;
      layers.morphT = 0;
    }
    layers.current = next;
  }, [presetId]);

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
      if (event.data?.type !== 'bands') return;
      feedRef.current = {
        bands: event.data.bands,
        spectrum: event.data.spectrum ?? SILENT_SPECTRUM,
        wave: event.data.wave ?? null,
        beat: event.data.beat ?? null,
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
      const { width, height } = backingSize(canvas);
      canvas.width = width;
      canvas.height = height;
      const layers = layersRef.current;
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
        spectrum: fresh ? feedRef.current.spectrum : SILENT_SPECTRUM,
        wave: fresh ? feedRef.current.wave : null,
        beat: fresh ? feedRef.current.beat : null,
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
        layers.current.renderer.render(layers.current.ctx, width, height, frame);
      }
      if (layers.outgoing) {
        layers.morphT += dt / MORPH_S;
        if (layers.morphT >= 1) {
          layers.outgoing = null;
        } else {
          layers.outgoing.renderer.render(layers.outgoing.ctx, width, height, frame);
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

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  return (
    <div className={`visualizer${chromeVisible ? '' : ' chrome-hidden'}`}>
      <canvas ref={canvasRef} className="visualizer-canvas" />
      {stalled && (
        <div className="visualizer-nosignal">
          waiting for manaDJ audio — keep the main window open
        </div>
      )}
      <div className="visualizer-chrome">
        <div className="visualizer-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`visualizer-preset-btn${preset.id === presetId ? ' active' : ''}`}
              onClick={() => setPresetId(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button
          className="visualizer-fullscreen-btn"
          title="Toggle fullscreen"
          onClick={toggleFullscreen}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

export default VisualizerApp;
