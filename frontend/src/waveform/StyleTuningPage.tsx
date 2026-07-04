// Dev-only Waveform style tuning page (?view=wfproto, DEV builds).
//
// Edits the persisted style slots (styleSlots.ts) live: every slider write
// repaints every surface in the app, and previews here render through the
// REAL production components (WebGLWaveform / WaveformMinimap), so what you
// tune is exactly what you get. Also the design prototype for the future
// style-settings product feature (out of scope for waveform-overhaul).

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import WebGLWaveform from '../components/WebGLWaveform';
import WaveformMinimap from '../components/WaveformMinimap';
import { STYLE_REGISTRY, getStyle } from './styles';
import type { RGB, StyleParams } from './styles';

const rgbToHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
import { resetSlots, setSlot, useStyleSlot } from './styleSlots';
import type { SlotName } from './styleSlots';
import './styleTuning.css';

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
}

/** Minimal buffer-based transport (same model as the deck engine). */
class TuningTransport {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  playing = false;

  setBuffer(buffer: AudioBuffer | null) {
    this.pause();
    this.buffer = buffer;
    this.offset = 0;
  }

  get loaded() {
    return this.buffer !== null;
  }

  getPlayhead(): number {
    if (!this.playing || !this.ctx) return this.offset;
    return this.offset + this.ctx.currentTime - this.startedAt;
  }

  isPlaying() {
    return this.playing;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(t, this.buffer?.duration ?? 0));
    if (wasPlaying) this.play();
  }

  play() {
    if (!this.buffer || this.playing) return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.src = this.ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.connect(this.ctx.destination);
    this.src.start(0, this.offset);
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  pause() {
    if (this.playing) this.offset = this.getPlayhead();
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

export default function StyleTuningPage() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [trackId, setTrackId] = useState<number | null>(null);
  const [editedSlot, setEditedSlot] = useState<SlotName>('full');
  const [audioState, setAudioState] = useState<'none' | 'loading' | 'ready'>('none');
  const slot = useStyleSlot(editedSlot);
  const transport = useMemo(() => new TuningTransport(), []);
  const clock = transport; // stable identity; has getPlayhead()

  useEffect(() => {
    api.tracks
      .list(1, 300)
      .then((res: { items?: TrackRow[] } | TrackRow[]) => {
        const rows = Array.isArray(res) ? res : (res.items ?? []);
        setTracks(rows);
        if (rows.length > 0) setTrackId((cur) => cur ?? rows[0].id);
      })
      .catch(() => setTracks([]));
  }, []);

  // Audio for playback preview.
  useEffect(() => {
    transport.setBuffer(null);
    if (trackId === null) {
      setAudioState('none');
      return;
    }
    let stale = false;
    setAudioState('loading');
    (async () => {
      const data = await (await fetch(api.tracks.audioUrl(trackId))).arrayBuffer();
      const buffer = await transport.decode(data);
      if (stale) return;
      transport.setBuffer(buffer);
      setAudioState('ready');
    })().catch(() => !stale && setAudioState('none'));
    return () => {
      stale = true;
      transport.pause();
    };
  }, [trackId, transport]);

  // Space = play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) return;
      e.preventDefault();
      transport.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [transport]);

  const patch = (params: Partial<StyleParams>) => setSlot(editedSlot, { params });
  const p = slot.params;

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
  ) => (
    <label className="tune-slider" key={label}>
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

  const scrubTransport = {
    isPlaying: () => transport.isPlaying(),
    pause: () => transport.pause(),
    play: () => transport.play(),
    seek: (t: number) => transport.seek(t),
  };

  return (
    <div className="tune-page">
      <h1>
        waveform style tuning<span className="tune-tag">dev</span>
      </h1>
      <div className="tune-toolbar">
        <select
          value={trackId ?? ''}
          onChange={(e) => setTrackId(Number(e.target.value))}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.artist ? `${t.artist} — ` : ''}{t.title ?? `#${t.id}`}
            </option>
          ))}
        </select>
        <button
          className="tune-play"
          disabled={audioState !== 'ready'}
          onClick={() => transport.toggle()}
        >
          {audioState === 'loading' ? 'decoding…' : audioState === 'none' ? 'no audio' : 'play/pause'}
        </button>
        <button className="tune-reset" onClick={() => resetSlots()}>
          reset all to defaults
        </button>
      </div>

      <div className="tune-preview-label">full waveform (slot: full)</div>
      <div className="tune-main-preview">
        <WebGLWaveform
          trackId={trackId}
          clock={clock}
          cuePoint={null}
          transport={scrubTransport}
        />
      </div>
      <div className="tune-preview-label">minimap (slot: minimap)</div>
      <div className="tune-minimap-preview">
        <WaveformMinimap
          trackId={trackId}
          clock={clock}
          cuePoint={null}
          onSeek={(t) => transport.seek(t)}
        />
      </div>

      <div className="tune-controls">
        <div className="tune-slot-row">
          <span>editing slot:</span>
          {(['full', 'minimap'] as const).map((name) => (
            <label key={name}>
              <input
                type="radio"
                checked={editedSlot === name}
                onChange={() => setEditedSlot(name)}
              />
              {name}
            </label>
          ))}
          <select
            value={slot.styleId}
            onChange={(e) => setSlot(editedSlot, { styleId: e.target.value })}
          >
            {STYLE_REGISTRY.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={p.smooth}
              onChange={(e) => patch({ smooth: e.target.checked })}
            />
            smooth color
          </label>
        </div>
        <div className="tune-sliders">
          {slider('display gamma', p.displayGamma, 0.25, 2.5, 0.05, (v) => patch({ displayGamma: v }))}
          {slider('master', p.master, 0.2, 1.5, 0.02, (v) => patch({ master: v }))}
          {slider('low gain', p.gains[0], 0, 3, 0.05, (v) => patch({ gains: [v, p.gains[1], p.gains[2]] }))}
          {slider('mid gain', p.gains[1], 0, 3, 0.05, (v) => patch({ gains: [p.gains[0], v, p.gains[2]] }))}
          {slider('high gain', p.gains[2], 0, 3, 0.05, (v) => patch({ gains: [p.gains[0], p.gains[1], v] }))}
          {slider('low/mid boundary (band)', p.b1, 1, 7, 1, (v) => patch({ b1: v, b2: Math.max(p.b2, v + 1) }))}
          {slider('mid/high boundary (band)', p.b2, 2, 8, 1, (v) => patch({ b2: v, b1: Math.min(p.b1, v - 1) }))}
          {(['low', 'mid', 'high'] as const).map((band, i) => {
            const current = p.colors ?? getStyle(slot.styleId).defaultColors;
            return (
              <label className="tune-slider" key={band}>
                <span>{band} color</span>
                <input
                  type="color"
                  value={rgbToHex(current[i])}
                  onChange={(e) => {
                    const next = [...current] as [RGB, RGB, RGB];
                    next[i] = hexToRgb(e.target.value);
                    patch({ colors: next });
                  }}
                />
              </label>
            );
          })}
          <label className="tune-slider">
            <span>&nbsp;</span>
            <button
              className="tune-reset"
              disabled={p.colors === null}
              onClick={() => patch({ colors: null })}
            >
              style default colors
            </button>
          </label>
        </div>
      </div>
      <p className="tune-hint">
        edits persist (localStorage) and repaint every surface live · space = play/pause ·
        band edges: 20/60/150/400/1k/2.5k/6k/12k/20k Hz
      </p>
    </div>
  );
}
