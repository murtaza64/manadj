import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useScrubLoop } from '../hooks/useScrubLoop';
import { BEATJUMP_BEATS } from '../playback/constants';
import type { EqBand } from '../playback/graph';
import WebGLWaveform from './WebGLWaveform';
import type { ScrubTransport } from './WebGLWaveform';
import WaveformMinimap from './WaveformMinimap';
import { useHotCues } from '../hooks/useHotCues';
import { formatKeyDisplay } from '../utils/keyUtils';
import type { HotCue, PaginatedTracks } from '../types';
import './PracticeView.css';

interface PracticeViewProps {
  onClose: () => void;
}

const EQ_BANDS: EqBand[] = ['high', 'mid', 'low'];
const HOT_CUE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
export function PracticeView({ onClose }: PracticeViewProps) {
  // The shared Deck (same one the Library renders). Whole-snapshot selector
  // is fine here — this tree is small.
  const { engine, loadedTrack, loadTrack } = useDeck();
  const snapshot = useDeckSnapshot((s) => s);

  const [search, setSearch] = useState('');

  const { data: results } = useQuery<PaginatedTracks>({
    queryKey: ['practice-track-search', search],
    queryFn: () => api.tracks.list(1, 20, { search: search || undefined }),
  });

  const { data: hotCues } = useHotCues(loadedTrack?.id ?? null);

  const cuesBySlot = useMemo(() => {
    const map = new Map<number, HotCue>();
    for (const cue of hotCues ?? []) map.set(cue.slot_number, cue);
    return map;
  }, [hotCues]);

  // Keyboard shortcuts — playback keys from the library hub (useKeyboardShortcuts):
  // space = play/pause, f = cue (hold), a/s = beatjump, h/l = scrub (hold), 1-8 = hot cues (hold).
  const [scrubDirection, setScrubDirection] = useState(0);
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return (
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      );
    };
    const hotCueTime = (slot: number) => cuesBySlot.get(slot)?.time_seconds ?? null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        engine.togglePlay();
      } else if (key === 'f') {
        e.preventDefault();
        if (!e.repeat) engine.cueDown();
      } else if (key === 'a') {
        e.preventDefault();
        engine.jumpBeats(-BEATJUMP_BEATS);
      } else if (key === 's') {
        e.preventDefault();
        engine.jumpBeats(BEATJUMP_BEATS);
      } else if ((key === 'h' || key === 'l') && !e.shiftKey) {
        e.preventDefault();
        setScrubDirection(key === 'h' ? -1 : 1);
      } else if (/^Digit[1-8]$/.test(e.code) && !e.shiftKey) {
        e.preventDefault();
        if (e.repeat) return;
        const slot = Number(e.code.slice(-1));
        engine.hotCueDown(slot, hotCueTime(slot));
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        engine.cueUp();
      } else if ((key === 'h' || key === 'l') && !e.shiftKey) {
        e.preventDefault();
        setScrubDirection(0);
      } else if (/^Digit[1-8]$/.test(e.code) && !e.shiftKey) {
        e.preventDefault();
        const slot = Number(e.code.slice(-1));
        engine.hotCueUp(slot, hotCueTime(slot));
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [engine, cuesBySlot]);

  // Continuous scrub while h/l is held (shared with the library hub).
  useScrubLoop(engine, scrubDirection);

  const ready = snapshot.loadState === 'ready';

  // Transport adapter for waveform drag-to-scrub. isPlaying uses
  // isAudioRunning so a drag during a held preview also pauses — the commit
  // math needs a stationary playhead.
  const scrubTransport: ScrubTransport = {
    isPlaying: () => engine.isAudioRunning(),
    pause: () => engine.pause(),
    play: () => engine.play(),
    seek: (t) => engine.seek(t),
  };

  return (
    <div className="practice-view">
      <div className="practice-header">
        <h1>Practice</h1>
        <button className="practice-close" onClick={onClose}>← Library</button>
      </div>

      <div className="practice-body">
        {/* Track picker */}
        <div className="practice-picker">
          <input
            type="text"
            placeholder="Search tracks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="practice-picker-results">
            {(results?.items ?? []).map((track) => (
              <div
                key={track.id}
                className={`practice-picker-row${loadedTrack?.id === track.id ? ' loaded' : ''}`}
                onClick={() => loadTrack(track)}
              >
                <span className="picker-title">{track.title || track.filename}</span>
                <span className="picker-artist">{track.artist || '—'}</span>
                <span className="picker-meta">
                  {track.bpm ? track.bpm.toFixed(1) : '—'} · {formatKeyDisplay(track.key)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Deck */}
        <div className="practice-deck">
          <div className="deck-trackinfo">
            {loadedTrack ? (
              <>
                <span className="deck-title">{loadedTrack.title || loadedTrack.filename}</span>
                <span className="deck-artist">{loadedTrack.artist || '—'}</span>
                <span className="deck-meta">
                  {loadedTrack.bpm ? `${loadedTrack.bpm.toFixed(1)} BPM` : 'no BPM'} ·{' '}
                  {formatKeyDisplay(loadedTrack.key)}
                </span>
                {snapshot.loadState === 'fetching' && <span className="deck-loadstate">fetching…</span>}
                {snapshot.loadState === 'decoding' && <span className="deck-loadstate">decoding…</span>}
                {snapshot.loadState === 'error' && (
                  <span className="deck-loadstate error">error: {snapshot.loadError}</span>
                )}
              </>
            ) : (
              <span className="deck-title empty">No track loaded</span>
            )}
          </div>

          <WebGLWaveform
            trackId={loadedTrack?.id ?? null}
            clock={engine}
            cuePoint={snapshot.cuePoint}
            transport={scrubTransport}
          />
          <WaveformMinimap
            trackId={loadedTrack?.id ?? null}
            clock={engine}
            cuePoint={snapshot.cuePoint}
            onSeek={(t) => engine.seek(t)}
          />
          {/* Transport */}
          <div className="deck-transport">
            <button
              className={`deck-btn cue${snapshot.previewing ? ' active' : ''}`}
              disabled={!ready}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                engine.cueDown();
              }}
              onPointerUp={() => engine.cueUp()}
              onPointerCancel={() => engine.cueUp()}
            >
              CUE
            </button>
            <button
              className={`deck-btn play${snapshot.playing ? ' active' : ''}`}
              disabled={!ready}
              onClick={() => engine.togglePlay()}
            >
              {snapshot.playing ? 'PAUSE' : 'PLAY'}
            </button>
            <button
              className="deck-btn jump"
              disabled={!ready}
              onClick={() => engine.jumpBeats(-BEATJUMP_BEATS)}
            >
              ◀ {BEATJUMP_BEATS}
            </button>
            <button
              className="deck-btn jump"
              disabled={!ready}
              onClick={() => engine.jumpBeats(BEATJUMP_BEATS)}
            >
              {BEATJUMP_BEATS} ▶
            </button>
          </div>

          {/* Hot cues (read-only: jump/preview) */}
          <div className="deck-hotcues">
            {HOT_CUE_SLOTS.map((slot) => {
              const cue = cuesBySlot.get(slot) ?? null;
              const previewingThis = snapshot.hotCuePreviewSlot === slot;
              return (
                <button
                  key={slot}
                  className={`hotcue-btn${previewingThis ? ' active' : ''}`}
                  disabled={!ready || !cue}
                  style={cue?.color ? { borderColor: cue.color, color: cue.color } : undefined}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    engine.hotCueDown(slot, cue?.time_seconds ?? null);
                  }}
                  onPointerUp={() => engine.hotCueUp(slot, cue?.time_seconds ?? null)}
                  onPointerCancel={() => engine.hotCueUp(slot, cue?.time_seconds ?? null)}
                >
                  {cue?.label || slot}
                </button>
              );
            })}
          </div>

          {/* Sound controls */}
          <div className="deck-sound">
            <div className="deck-eq">
              {EQ_BANDS.map((band) => (
                <label key={band} className="eq-band">
                  <input
                    className="eq-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(snapshot.eq[band] * 100)}
                    onChange={(e) => engine.setEqValue(band, Number(e.target.value) / 100)}
                    onDoubleClick={() => engine.setEqValue(band, 0.5)}
                  />
                  <span>{band.toUpperCase()}</span>
                </label>
              ))}
            </div>

            <div className="deck-filter">
              <input
                type="range"
                min={-100}
                max={100}
                value={Math.round(snapshot.filterPosition * 100)}
                onChange={(e) => engine.setFilterPosition(Number(e.target.value) / 100)}
                onDoubleClick={() => engine.setFilterPosition(0)}
              />
              <span>
                FILTER{' '}
                {Math.abs(snapshot.filterPosition) < 0.05
                  ? 'off'
                  : snapshot.filterPosition < 0
                    ? 'LP'
                    : 'HP'}
              </span>
            </div>

            <div className="deck-pitch">
              <input
                type="range"
                min={-80}
                max={80}
                value={Math.round(snapshot.pitchPercent * 10)}
                onChange={(e) => engine.setPitch(Number(e.target.value) / 10)}
                onDoubleClick={() => engine.setPitch(0)}
              />
              <span>
                PITCH {snapshot.pitchPercent >= 0 ? '+' : ''}
                {snapshot.pitchPercent.toFixed(1)}%
              </span>
              <button className="pitch-reset" onClick={() => engine.setPitch(0)}>0</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
