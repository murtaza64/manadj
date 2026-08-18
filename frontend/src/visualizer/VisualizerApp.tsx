import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SILENT_BANDS } from './bands';
import type { BandLevels } from './bands';
import {
  PING_INTERVAL_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
} from './channel';
import type { VisualizerMessage, VisualizerPing } from './channel';
import { PRESETS, presetById } from './presets';
import { getPresetId, setPresetId, subscribePreset } from './visualizerStore';
import './VisualizerApp.css';

/** Band feed older than this renders as silence (main window gone/paused). */
const STALE_MS = 1000;
const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);
/** Chrome (preset switcher etc.) hides after this much mouse stillness. */
const CHROME_HIDE_MS = 2500;

/**
 * The visualizer window (realtime-visualization 01): a standalone root
 * rendered by App.tsx's pathname branch — NO DeckProvider, no Mixer, never
 * an AudioContext. Band levels arrive over the BroadcastChannel from the
 * main window's VisualizerBridge; this window pings to keep the feed alive,
 * renders the active preset on its own rAF, and owns the preset switcher +
 * fullscreen chrome (the path to a dedicated HDMI display: fullscreen this
 * window on the second screen).
 */
export function VisualizerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef<{ bands: BandLevels; spectrum: number[]; receivedAt: number }>({
    bands: SILENT_BANDS,
    spectrum: SILENT_SPECTRUM,
    receivedAt: -Infinity,
  });
  const presetId = useSyncExternalStore(subscribePreset, getPresetId);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [stalled, setStalled] = useState(true);

  useEffect(() => {
    document.title = 'manaDJ visualizer';
    document.documentElement.classList.add('visualizer-root');
    return () => document.documentElement.classList.remove('visualizer-root');
  }, []);

  // Band feed: ping so the main-window bridge transmits; keep the latest
  // frame in a ref — band data must never be React state (frame rate).
  useEffect(() => {
    const channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type !== 'bands') return;
      feedRef.current = {
        bands: event.data.bands,
        spectrum: event.data.spectrum ?? SILENT_SPECTRUM,
        receivedAt: performance.now(),
      };
    };
    const ping = () => {
      const message: VisualizerPing = { type: 'ping' };
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

  // Render loop: one renderer instance per preset selection.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const renderer = presetById(presetId).create();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
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
      renderer.render(ctx, canvas.width, canvas.height, {
        bands: fresh ? feedRef.current.bands : SILENT_BANDS,
        spectrum: fresh ? feedRef.current.spectrum : SILENT_SPECTRUM,
        time: (now - startedAt) / 1000,
        dt,
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [presetId]);

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
