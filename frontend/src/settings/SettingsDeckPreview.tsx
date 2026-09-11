import { useDeferredValue, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import { useDecks } from '../hooks/useDeck';
import { useAutomationGhost, useMixer, useMixerValue } from '../hooks/useMixer';
import { CHANNEL_IDS, type ChannelId } from '../playback/mixer';
import { describeSweepFilter, sweepResponseDb } from '../playback/sweepFilter';
import { AutoBlurSelect } from '../components/AutoBlurSelect';
import WebGLWaveform from '../components/WebGLWaveform';
import WaveformMinimap from '../components/WaveformMinimap';

/** Settings audition uses a real deck, never a second player or AudioContext. */
export function SettingsDeckPreview({ filter = false }: { filter?: boolean }) {
  const decks = useDecks();
  const mixer = useMixer();
  const [deckId, setDeckId] = useState<ChannelId>('A');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const deck = decks[deckId],
    engine = deck.engine;
  const snapshot = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getSnapshot(),
  );
  const channel = useMixerValue((m) => m.getChannelState(deckId));
  const settings = useMixerValue((m) => m.getFilterSettings());
  const ghost = useAutomationGhost(deckId);
  const owned = ghost !== null || mixer.isAutomationEngaged();
  const { data, isPending, isError } = useQuery<{ items: Track[] }>({
    queryKey: ['settings-preview-tracks', deferredSearch],
    queryFn: () => api.tracks.list(1, 100, { search: deferredSearch }),
  });
  const tracks = data?.items ?? [];
  const chosen = tracks.find((t) => t.id === selectedId) ?? tracks[0];
  const ready =
    snapshot.loadState === 'ready' && snapshot.trackId === deck.loadedTrack?.id;
  const previewState = snapshot.loadError ? 'error' : owned ? 'automation' :
    (snapshot.loadState === 'fetching' || snapshot.loadState === 'decoding') ? 'loading' :
    ready ? (snapshot.playing ? 'playing' : 'ready') : 'empty';
  const position = ghost?.filter ?? channel.filter;
  const descriptor = describeSweepFilter(settings, position, 48000);
  const frequencies = Float32Array.from(
    { length: 180 },
    (_, i) => 20 * 1000 ** (i / 179),
  );
  const curve = sweepResponseDb(settings, position, frequencies, 48000);
  const points = curve
    .map(
      (db, i) =>
        `${30 + (i / 179) * 650},${8 + ((24 - Math.max(-60, Math.min(24, db))) / 84) * 140}`,
    )
    .join(' ');
  const transport = {
    isPlaying: () => engine.getSnapshot().playing,
    pause: () => {
      if (!mixer.isAutomationEngaged()) engine.pause();
    },
    play: () => {
      if (!mixer.isAutomationEngaged()) engine.play();
    },
    seek: (time: number) => {
      if (!mixer.isAutomationEngaged()) engine.seek(time);
    },
  };
  return (
    <section className="settings-preview" aria-label="Live deck preview">
      <div className="settings-section-heading">
        <div>
          <div className="settings-preview-title">
            <h3>Live preview</h3>
            <span className="settings-preview-status" data-state={previewState} role="status">
              {previewState === 'empty' ? 'NO TRACK' : previewState.toUpperCase()}
            </span>
          </div>
          <p>
            Uses the selected deck and its existing output levels. Loading
            replaces that deck's track.
          </p>
        </div>
        <label className="settings-inline-label">
          Deck{' '}
          <AutoBlurSelect
            aria-label="Preview deck"
            value={deckId}
            onChange={(e) => setDeckId(e.target.value as ChannelId)}
          >
            {CHANNEL_IDS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </AutoBlurSelect>
        </label>
      </div>
      <div className="settings-preview-load">
        <input
          aria-label="Search preview tracks"
          type="search"
          placeholder="Search tracks"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedId(null);
          }}
        />
        <AutoBlurSelect
          aria-label="Preview track"
          value={chosen?.id ?? ''}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {!tracks.length && (
            <option value="">
              {isPending
                ? 'Loading tracks...'
                : isError
                  ? 'Tracks unavailable'
                  : 'No matching tracks'}
            </option>
          )}
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.artist ? `${track.artist} / ` : ''}
              {track.title || `Track ${track.id}`}
            </option>
          ))}
        </AutoBlurSelect>
        <button
          className="btn btn-secondary"
          disabled={!chosen || owned}
          onClick={() => {
            if (chosen && !mixer.isAutomationEngaged()) deck.loadTrack(chosen);
          }}
        >
          Load on {deckId}
        </button>
      </div>
      <div className="settings-preview-transport">
        <strong style={{ color: `var(--deck-${deckId.toLowerCase()})` }}>
          Deck {deckId}
        </strong>
        <span className="settings-track-name">
          {deck.loadedTrack?.title || 'No track loaded'}
        </span>
        <button
          className="btn btn-success"
          disabled={!ready || owned}
          onClick={() => {
            if (!mixer.isAutomationEngaged()) engine.togglePlay();
          }}
        >
          {snapshot.playing ? 'Pause' : 'Play'}
        </button>
        <button
          className={`btn ${snapshot.loop ? 'btn-success' : 'btn-secondary'}`}
          disabled={!ready || owned || !snapshot.hasBeatgrid}
          aria-pressed={snapshot.loop !== null}
          onClick={() => {
            if (!mixer.isAutomationEngaged()) engine.toggleLoop();
          }}
        >
          Loop {snapshot.loopBeatsLabel ?? snapshot.pendingLoopBeats} beats
        </button>
      </div>
      {snapshot.loadState === 'fetching' ||
      snapshot.loadState === 'decoding' ? (
        <p role="status">Loading deck audio...</p>
      ) : null}
      {snapshot.loadError && (
        <p className="settings-error" role="alert">
          {snapshot.loadError}
        </p>
      )}
      {owned && (
        <p className="settings-hint">
          Automation owns playback. Filter preferences still apply live; deck
          controls are locked until playback is released.
        </p>
      )}
      {filter ? (
        <>
          <div className="settings-preview-sweep">
            <label htmlFor="settings-sweep">Deck filter</label>
            <output>
              {descriptor.wet === 0
                ? 'Dry center'
                : `${descriptor.type === 'lowpass' ? 'LP' : 'HP'} ${Math.round(descriptor.frequency)} Hz`}
            </output>
            <input
              id="settings-sweep"
              type="range"
              min="-1"
              max="1"
              step="0.001"
              value={position}
              disabled={owned}
              onChange={(e) => {
                if (!mixer.isAutomationEngaged())
                  mixer.setFilter(deckId, Number(e.target.value));
              }}
            />
            <span>Low pass</span>
            <button
              className="btn btn-mini"
              disabled={owned}
              onClick={() => {
                if (!mixer.isAutomationEngaged()) mixer.setFilter(deckId, 0);
              }}
            >
              Center
            </button>
            <span>High pass</span>
          </div>
          <svg
            className="settings-response"
            viewBox="0 0 700 172"
            role="img"
            aria-label="Filter frequency response"
          >
            {[24, 0, -24, -48].map((db) => (
              <g key={db}>
                <line
                  x1="30"
                  x2="680"
                  y1={8 + ((24 - db) / 84) * 140}
                  y2={8 + ((24 - db) / 84) * 140}
                />
                <text x="0" y={12 + ((24 - db) / 84) * 140}>
                  {db}
                </text>
              </g>
            ))}
            {[20, 100, 1000, 10000, 20000].map((f) => (
              <text
                key={f}
                x={30 + (Math.log(f / 20) / Math.log(1000)) * 650}
                y="169"
                textAnchor={f === 20000 ? 'end' : 'start'}
              >
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            ))}
            <polyline points={points} />
          </svg>
          <p className="settings-hint">
            Target response at 48 kHz, including resonance trim. Excludes drive
            and output limiting.
          </p>
        </>
      ) : (
        <>
          <div className="tune-preview-label">Full waveform</div>
          <div className="tune-main-preview">
            <WebGLWaveform
              trackId={deck.loadedTrack?.id ?? null}
              clock={engine}
              cuePoint={snapshot.cuePoint}
              transport={transport}
              playing={snapshot.playing}
              loop={snapshot.loop}
              dimmed={!ready || owned}
            />
          </div>
          <div className="tune-preview-label">Minimap</div>
          <div className="tune-minimap-preview">
            <WaveformMinimap
              trackId={deck.loadedTrack?.id ?? null}
              clock={engine}
              cuePoint={snapshot.cuePoint}
              onSeek={transport.seek}
            />
          </div>
        </>
      )}
    </section>
  );
}
