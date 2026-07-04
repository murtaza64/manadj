// PROTOTYPE — wipe me. Waveform-overhaul style prototype page
// (.scratch/waveform-overhaul/PRD.md). Four render-style variants over the
// same 8-band Waveform data, switchable via ?variant=, all aesthetics live-
// tunable. Reached via ?view=wfproto (dev builds only).

import { useEffect, useRef, useState } from 'react';
import { decodeWfb } from './decodeWfb';
import type { DecodedWfb } from './decodeWfb';
import { ProtoWaveformGL, STYLES, DEFAULT_PARAMS } from './ProtoWaveformGL';
import type { ProtoParams } from './ProtoWaveformGL';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import './prototype.css';

interface ManifestEntry {
  id: number;
  title: string;
  artist: string;
  duration: number;
  codec: string;
  file: string;
  genSeconds: number;
  audioFile?: string;
}

/** Minimal buffer-based transport (same model as the app's deck engine). */
class ProtoTransport {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0; // ctx.currentTime at play start
  private offset = 0; // track seconds at play start
  playing = false;

  setBuffer(buffer: AudioBuffer | null) {
    this.stop();
    this.buffer = buffer;
    this.offset = 0;
  }

  get loaded() {
    return this.buffer !== null;
  }

  position(): number {
    if (!this.playing || !this.ctx) return this.offset;
    return this.offset + this.ctx.currentTime - this.startedAt;
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    this.stop();
    this.offset = Math.max(0, Math.min(t, this.buffer?.duration ?? 0));
    if (wasPlaying) this.play();
  }

  private play() {
    if (!this.buffer) return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.src = this.ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.connect(this.ctx.destination);
    this.src.start(0, this.offset);
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  stop() {
    if (this.playing) this.offset = this.position();
    this.src?.stop();
    this.src?.disconnect();
    this.src = null;
    this.playing = false;
  }

  async decode(data: ArrayBuffer) {
    this.ctx ??= new AudioContext();
    return this.ctx.decodeAudioData(data);
  }
}

function initialVariant(): string {
  const v = new URLSearchParams(window.location.search).get('variant');
  // Default to B: current front-runner (see NOTES.md).
  return STYLES.some((s) => s.id === v) ? (v as string) : 'B';
}

export default function WaveformStylePrototype() {
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [trackIdx, setTrackIdx] = useState(0);
  const [styleId, setStyleId] = useState(initialVariant);
  const [params, setParams] = useState<ProtoParams>({ ...DEFAULT_PARAMS });
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState('');

  const mainCanvas = useRef<HTMLCanvasElement>(null);
  const overviewCanvas = useRef<HTMLCanvasElement>(null);
  const windowIndicator = useRef<HTMLDivElement>(null);
  const timeReadout = useRef<HTMLSpanElement>(null);
  const gl = useRef<{ main: ProtoWaveformGL; overview: ProtoWaveformGL } | null>(null);
  const decoded = useRef<DecodedWfb | null>(null);
  const loadStats = useRef('');
  const fps = useRef(0);
  const transport = useRef(new ProtoTransport());
  const follow = useRef(true);
  const [followUi, setFollowUi] = useState(true);
  const [audioState, setAudioState] = useState<'none' | 'loading' | 'ready'>('none');

  // Renderers + rAF loop (once).
  useEffect(() => {
    try {
      gl.current = {
        main: new ProtoWaveformGL(mainCanvas.current!),
        overview: new ProtoWaveformGL(overviewCanvas.current!),
      };
    } catch (e) {
      setError(String(e));
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      fps.current = fps.current * 0.95 + (1000 / Math.max(now - last, 0.01)) * 0.05;
      last = now;
      const g = gl.current!;
      if (decoded.current) {
        const tr = transport.current;
        const pos = tr.loaded ? tr.position() : -1;
        g.main.playhead = pos;
        g.overview.playhead = pos;
        if (tr.playing && follow.current) {
          // Playhead pinned at 25%, like the app's decks.
          g.main.startTime = pos - g.main.visibleSeconds * 0.25;
        }
        // Overview stays full-track.
        g.overview.startTime = 0;
        g.overview.visibleSeconds = decoded.current.header.duration;
        g.main.render();
        g.overview.render();
        const ind = windowIndicator.current;
        if (ind) {
          const dur = decoded.current.header.duration;
          ind.style.left = `${(g.main.startTime / dur) * 100}%`;
          ind.style.width = `${(g.main.visibleSeconds / dur) * 100}%`;
        }
        if (timeReadout.current && pos >= 0) {
          timeReadout.current.textContent =
            `${tr.playing ? '▶' : '⏸'} ${pos.toFixed(1)}s`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const statsTimer = window.setInterval(
      () => setStats(`${loadStats.current}  ${fps.current.toFixed(0)} fps`),
      500,
    );
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(statsTimer);
      gl.current?.main.destroy();
      gl.current?.overview.destroy();
    };
  }, []);

  // Manifest.
  useEffect(() => {
    fetch('/proto-waveforms/manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
        return r.json();
      })
      .then(setManifest)
      .catch(() => setError('No manifest — run: uv run scripts/proto_waveform_blob.py --auto'));
  }, []);

  // Load + decode the selected track's blob.
  useEffect(() => {
    const entry = manifest[trackIdx];
    if (!entry || !gl.current) return;
    let stale = false;
    (async () => {
      const t0 = performance.now();
      const buf = await (await fetch(`/proto-waveforms/${entry.file}`)).arrayBuffer();
      const tFetch = performance.now();
      const d = decodeWfb(buf);
      const tDecode = performance.now();
      if (stale) return;
      decoded.current = d;
      gl.current!.main.setData(d);
      gl.current!.overview.setData(d);
      const tUpload = performance.now();
      loadStats.current =
        `${(buf.byteLength / 1024).toFixed(0)} KB blob  ` +
        `gen ${entry.genSeconds.toFixed(2)}s (${(entry.duration / entry.genSeconds).toFixed(0)}x RT)  ` +
        `fetch ${(tFetch - t0).toFixed(0)}ms  decode+pyramid ${(tDecode - tFetch).toFixed(1)}ms  ` +
        `upload ${(tUpload - tDecode).toFixed(1)}ms`;
    })().catch((e) => setError(String(e)));
    return () => {
      stale = true;
    };
  }, [manifest, trackIdx]);

  // Load audio for playback (if the script copied it — rerun with --audio otherwise).
  useEffect(() => {
    const entry = manifest[trackIdx];
    transport.current.setBuffer(null);
    if (!entry?.audioFile) {
      setAudioState('none');
      return;
    }
    let stale = false;
    setAudioState('loading');
    (async () => {
      const data = await (await fetch(`/proto-waveforms/${entry.audioFile}`)).arrayBuffer();
      const buffer = await transport.current.decode(data);
      if (stale) return;
      transport.current.setBuffer(buffer);
      setAudioState('ready');
    })().catch(() => !stale && setAudioState('none'));
    return () => {
      stale = true;
      transport.current.stop();
    };
  }, [manifest, trackIdx]);

  // Space = play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) return;
      e.preventDefault();
      transport.current.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Push style/params into both renderers; mirror variant into the URL.
  useEffect(() => {
    if (!gl.current) return;
    gl.current.main.styleId = styleId;
    gl.current.overview.styleId = styleId;
    gl.current.main.params = params;
    gl.current.overview.params = params;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', styleId);
    window.history.replaceState(null, '', url);
  }, [styleId, params]);

  // Interactions: wheel zoom + drag pan on main, click/drag seek on overview.
  useEffect(() => {
    const main = mainCanvas.current;
    const overview = overviewCanvas.current;
    if (!main || !overview) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = main.getBoundingClientRect();
      const xFrac = (e.clientX - rect.left) / rect.width;
      gl.current?.main.zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, xFrac);
    };

    let dragX: number | null = null;
    const onDown = (e: PointerEvent) => {
      dragX = e.clientX;
      main.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragX === null || !gl.current) return;
      const g = gl.current.main;
      g.panSeconds(((dragX - e.clientX) / main.clientWidth) * g.visibleSeconds);
      dragX = e.clientX;
    };
    const onUp = () => {
      dragX = null;
    };

    const seek = (e: PointerEvent) => {
      if (!gl.current || !decoded.current) return;
      const rect = overview.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * decoded.current.header.duration;
      const g = gl.current.main;
      if (transport.current.loaded) {
        transport.current.seek(t); // playhead follows; view follows playhead when playing
        if (!transport.current.playing) g.startTime = t - g.visibleSeconds * 0.25;
      } else {
        g.startTime = t - g.visibleSeconds / 2;
      }
      g.panSeconds(0); // clamp
    };
    let seeking = false;
    const ovDown = (e: PointerEvent) => {
      seeking = true;
      overview.setPointerCapture(e.pointerId);
      seek(e);
    };
    const ovMove = (e: PointerEvent) => seeking && seek(e);
    const ovUp = () => {
      seeking = false;
    };

    main.addEventListener('wheel', onWheel, { passive: false });
    main.addEventListener('pointerdown', onDown);
    main.addEventListener('pointermove', onMove);
    main.addEventListener('pointerup', onUp);
    overview.addEventListener('pointerdown', ovDown);
    overview.addEventListener('pointermove', ovMove);
    overview.addEventListener('pointerup', ovUp);
    return () => {
      main.removeEventListener('wheel', onWheel);
      main.removeEventListener('pointerdown', onDown);
      main.removeEventListener('pointermove', onMove);
      main.removeEventListener('pointerup', onUp);
      overview.removeEventListener('pointerdown', ovDown);
      overview.removeEventListener('pointermove', ovMove);
      overview.removeEventListener('pointerup', ovUp);
    };
  }, []);

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
  ) => (
    <label className="proto-slider">
      <span>
        {label}: <span className="val">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );

  if (error) return <div className="proto-page proto-error">{error}</div>;
  const entry = manifest[trackIdx];

  return (
    <div className="proto-page">
      <h1>
        waveform style prototype<span className="proto-tag">PROTOTYPE — wipe me</span>
      </h1>
      <div className="proto-toolbar">
        <select value={trackIdx} onChange={(e) => setTrackIdx(Number(e.target.value))}>
          {manifest.map((m, i) => (
            <option key={m.id} value={i}>
              {m.artist ? `${m.artist} — ` : ''}{m.title} ({m.codec}, {Math.round(m.duration)}s)
            </option>
          ))}
        </select>
        <button
          className="proto-play"
          disabled={audioState !== 'ready'}
          onClick={() => transport.current.toggle()}
        >
          {audioState === 'loading' ? 'decoding…' : audioState === 'none' ? 'no audio' : 'play/pause'}
        </button>
        <span ref={timeReadout} className="proto-time" />
        <label className="proto-follow">
          <input
            type="checkbox"
            checked={followUi}
            onChange={(e) => {
              follow.current = e.target.checked;
              setFollowUi(e.target.checked);
            }}
          />
          follow
        </label>
        {entry && <span className="proto-stats">{stats}</span>}
      </div>
      <canvas ref={mainCanvas} className="proto-main-canvas" />
      <div className="proto-overview-wrap">
        <canvas ref={overviewCanvas} className="proto-overview-canvas" />
        <div ref={windowIndicator} className="proto-window-indicator" />
      </div>
      <div className="proto-controls">
        {slider('display gamma', params.displayGamma, 0.25, 2.5, 0.05, (v) =>
          setParams((p) => ({ ...p, displayGamma: v })),
        )}
        {slider('master', params.master, 0.2, 3, 0.05, (v) =>
          setParams((p) => ({ ...p, master: v })),
        )}
        {slider('low gain', params.gains[0], 0, 3, 0.05, (v) =>
          setParams((p) => ({ ...p, gains: [v, p.gains[1], p.gains[2]] })),
        )}
        {slider('mid gain', params.gains[1], 0, 3, 0.05, (v) =>
          setParams((p) => ({ ...p, gains: [p.gains[0], v, p.gains[2]] })),
        )}
        {slider('high gain', params.gains[2], 0, 3, 0.05, (v) =>
          setParams((p) => ({ ...p, gains: [p.gains[0], p.gains[1], v] })),
        )}
        {slider('low/mid boundary (band)', params.b1, 1, 7, 1, (v) =>
          setParams((p) => ({ ...p, b1: v, b2: Math.max(p.b2, v + 1) })),
        )}
        {slider('mid/high boundary (band)', params.b2, 2, 8, 1, (v) =>
          setParams((p) => ({ ...p, b2: v, b1: Math.min(p.b1, v - 1) })),
        )}
        <label className="proto-follow">
          <input
            type="checkbox"
            checked={params.smoothColor}
            onChange={(e) => setParams((p) => ({ ...p, smoothColor: e.target.checked }))}
          />
          smooth color
        </label>
      </div>
      <p className="proto-hint">
        space = play/pause · wheel = zoom · drag = pan · overview click = seek · ←/→ = switch
        style · band edges: 20/60/150/400/1k/2.5k/6k/12k/20k Hz
      </p>
      <PrototypeSwitcher
        variants={STYLES.map((s) => ({ id: s.id, name: s.name }))}
        current={styleId}
        onChange={setStyleId}
      />
    </div>
  );
}
