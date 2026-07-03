/**
 * One Deck panel + its full-width waveform — deck-blind: everything reads
 * the nearest <DeckScope>, so the same component renders Deck A and Deck B
 * (`mirrored` only flips the layout). Per the prototype verdict: minimap
 * with deck tag on top; hot pads over the beatjump row over CUE/PLAY; the
 * beatgrid/BPM block; MATCH + pitch fader + nudge on the flank; metadata
 * footer.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useDeck, useDeckReady, useDecks, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import { useNudgeBeatgrid, useSetBeatgridDownbeat } from '../../hooks/useBeatgridData';
import WebGLWaveform from '../WebGLWaveform';
import type { ScrubTransport } from '../WebGLWaveform';
import WaveformMinimap from '../WaveformMinimap';
import HotCue from '../HotCue';
import { doubleBeatjump, halveBeatjump } from '../../playback/beatjump';
import { NUDGE_BEND_PERCENT, bpmMatch, composeRate } from '../../playback/tempo';
import { formatKeyDisplay } from '../../utils/keyUtils';
import { DECK_KEYS } from './performanceKeys';
import type { Track } from '../../types';

/** How long the MATCH out-of-reach hint stays up. */
const MATCH_HINT_MS = 2000;
const GRID_NUDGE_MS = 10;

/**
 * The deck's Track, kept fresh: the scope's loadedTrack is a snapshot from
 * load time, but the panel edits BPM/title/artist/energy in place — so the
 * panel reads through the query cache (seeded with the loaded snapshot) and
 * edits invalidate ['track', id].
 */
function useDeckTrack(): Track | null {
  const { loadedTrack } = useDeck();
  const { data } = useQuery<Track>({
    queryKey: ['track', loadedTrack?.id],
    queryFn: () => api.tracks.getById(loadedTrack!.id),
    enabled: loadedTrack !== null,
    placeholderData: loadedTrack ?? undefined,
    staleTime: 60_000,
  });
  return loadedTrack === null ? null : (data ?? loadedTrack);
}

/** Persist a track-metadata edit and refresh everything it can touch. */
function useTrackEdit(track: Track | null) {
  const queryClient = useQueryClient();
  const enabled = track !== null;
  const commit = (data: Parameters<typeof api.tracks.update>[1]) => {
    if (!track) return;
    void (async () => {
      await api.tracks.update(track.id, data);
      if (data.bpm !== undefined) {
        // The backend only *generates* a grid when none exists — a BPM
        // change must delete and re-get to force regeneration (the same
        // dance the library's TagEditor does).
        await api.beatgrids.delete(track.id);
        await api.beatgrids.get(track.id);
        void queryClient.invalidateQueries({ queryKey: ['beatgrid', track.id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['track', track.id] });
      // Both track-table sources in the embedded library.
      void queryClient.invalidateQueries({ queryKey: ['tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['playlist'] });
    })();
  };
  return { enabled, commit };
}

// ── Waveform ─────────────────────────────────────────────────────────────

export function DeckWaveform({
  visibleSeconds,
  onVisibleSecondsChange,
}: {
  /** The one zoom both decks share (seconds visible) — held by the view. */
  visibleSeconds: number;
  onVisibleSecondsChange: (seconds: number) => void;
}) {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);

  const transport: ScrubTransport = {
    isPlaying: () => engine.isAudioRunning(),
    pause: () => engine.pause(),
    play: () => engine.play(),
    seek: (t) => {
      if (ready) engine.seek(t);
    },
  };

  return (
    <WebGLWaveform
      trackId={loadedTrack?.id ?? null}
      clock={engine}
      cuePoint={cuePoint}
      transport={transport}
      dimmed={loadedTrack !== null && !ready}
      visibleSeconds={visibleSeconds}
      onVisibleSecondsChange={onVisibleSecondsChange}
    />
  );
}

// ── Deck column: pads / beatjump / transport ─────────────────────────────

/** On-control hint for this deck's key (from the shared map — can't drift). */
function Kbd({ k }: { k: string }) {
  return <kbd className="perf-kbd">{k.toUpperCase()}</kbd>;
}

function DeckPads({ trackId }: { trackId: number | null }) {
  const { deck } = useDeck();
  const keys = DECK_KEYS[deck];
  const actions = useHotCueActions(trackId);
  const previewingSlot = useDeckSnapshot((s) => s.hotCuePreviewSlot);

  return (
    <div className="perf-pads">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
        <span key={slot} className="perf-pad-wrap">
          <HotCue
            slotNumber={slot}
            hotCue={actions.bySlot.get(slot)}
            disabled={!actions.enabled}
            isPreviewing={previewingSlot === slot}
            onDown={actions.down}
            onUp={actions.up}
            onDelete={actions.remove}
          />
          {slot <= 4 && <Kbd k={keys.pads[slot - 1]} />}
        </span>
      ))}
    </div>
  );
}

/** Beatjump row: jump back, halve size, [size], double size, jump forward. */
function BeatjumpRow() {
  const { deck, engine, beatjumpBeats, setBeatjumpBeats } = useDeck();
  const keys = DECK_KEYS[deck];
  const ready = useDeckReady();

  return (
    <div className="perf-jumprow">
      <button
        className="player-button"
        disabled={!ready}
        onClick={() => engine.jumpBeats(-beatjumpBeats)}
        title={`Jump back ${beatjumpBeats} beats`}
      >
        ◄◄
        <Kbd k={keys.jumpBack} />
      </button>
      <button
        className="player-button"
        onClick={() => setBeatjumpBeats(halveBeatjump(beatjumpBeats))}
        title="Halve beatjump size"
      >
        −
      </button>
      <span className="perf-jumpsize" title="Beatjump size (beats)">
        {beatjumpBeats}
      </span>
      <button
        className="player-button"
        onClick={() => setBeatjumpBeats(doubleBeatjump(beatjumpBeats))}
        title="Double beatjump size"
      >
        +
      </button>
      <button
        className="player-button"
        disabled={!ready}
        onClick={() => engine.jumpBeats(beatjumpBeats)}
        title={`Jump forward ${beatjumpBeats} beats`}
      >
        ►►
        <Kbd k={keys.jumpForward} />
      </button>
    </div>
  );
}

function TransportBlock() {
  const { deck, engine } = useDeck();
  const keys = DECK_KEYS[deck];
  const ready = useDeckReady();
  const previewing = useDeckSnapshot((s) => s.previewing);
  const playing = useDeckSnapshot((s) => s.playing || s.pendingPlay);

  return (
    <div className="perf-transport-block">
      <button
        className={`player-button player-button-cue${previewing ? ' player-button-cue-held' : ''}`}
        disabled={!ready}
        onPointerDown={(e) => {
          if (!ready) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          engine.cueDown();
        }}
        onPointerUp={() => ready && engine.cueUp()}
      >
        CUE
        <Kbd k={keys.cue} />
      </button>
      <button
        className={`player-button ${playing ? 'player-button-playing' : 'player-button-paused'}`}
        disabled={!ready}
        onClick={() => engine.togglePlay()}
      >
        ⏯
        <Kbd k={keys.play} />
      </button>
    </div>
  );
}

// ── Beatgrid / BPM block ─────────────────────────────────────────────────

function BeatgridBlock({ track }: { track: Track | null }) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const edit = useTrackEdit(track);
  const enabled = ready && edit.enabled;

  const nudgeGrid = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();

  // Effective BPM — live with pitch AND bend (what your ears get right now).
  const rate = useDeckSnapshot((s) => composeRate(s.pitchPercent, s.bendPercent));
  const effective = track?.bpm ? track.bpm * rate : null;

  const commitBpm = (bpm: number) => {
    if (!enabled || !isFinite(bpm) || bpm <= 0) return;
    edit.commit({ bpm });
  };

  return (
    <div className="perf-beatgrid-block">
      <div className="perf-beatgrid-row">
        <span className="perf-beatgrid-label">BPM</span>
        <input
          // Uncontrolled, remounted when the track/BPM changes
          key={`${track?.id ?? 'none'}-${track?.bpm ?? 0}`}
          className="perf-bpm-input"
          defaultValue={track?.bpm ? track.bpm.toFixed(1) : ''}
          disabled={!enabled}
          onBlur={(e) => commitBpm(parseFloat(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation(); // keep typed digits away from keyboard hubs
          }}
        />
        <button
          className="player-button perf-mini"
          disabled={!enabled || !track?.bpm}
          onClick={() => track?.bpm && commitBpm(track.bpm / 2)}
          title="Halve BPM"
        >
          ½
        </button>
        <button
          className="player-button perf-mini"
          disabled={!enabled || !track?.bpm}
          onClick={() => track?.bpm && commitBpm(track.bpm * 2)}
          title="Double BPM"
        >
          ×2
        </button>
        <span className="perf-effbpm" title="Effective BPM (base × pitch × bend)">
          {effective !== null ? `» ${effective.toFixed(1)}` : ''}
        </span>
      </div>
      <div className="perf-beatgrid-row">
        <span className="perf-beatgrid-label">GRID</span>
        <button
          className="player-button perf-mini"
          disabled={!enabled}
          onClick={() =>
            track && nudgeGrid.mutate({ trackId: track.id, offsetMs: -GRID_NUDGE_MS })
          }
          title={`Nudge grid ${GRID_NUDGE_MS}ms earlier`}
        >
          ◄
        </button>
        <button
          className="player-button perf-mini perf-downbeat"
          disabled={!enabled}
          onClick={() =>
            track &&
            setDownbeat.mutate({ trackId: track.id, downbeatTime: engine.getPlayhead() })
          }
          title="Set downbeat at playhead"
        >
          D
        </button>
        <button
          className="player-button perf-mini"
          disabled={!enabled}
          onClick={() =>
            track && nudgeGrid.mutate({ trackId: track.id, offsetMs: GRID_NUDGE_MS })
          }
          title={`Nudge grid ${GRID_NUDGE_MS}ms later`}
        >
          ►
        </button>
      </div>
    </div>
  );
}

// ── Tempo cluster: MATCH / pitch fader / nudge ───────────────────────────

function TempoCluster({ track }: { track: Track | null }) {
  const { deck, engine } = useDeck();
  const keys = DECK_KEYS[deck];
  const decks = useDecks();
  const ready = useDeckReady();
  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  const bend = useDeckSnapshot((s) => s.bendPercent);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const queryClient = useQueryClient();
  const other = decks[deck === 'A' ? 'B' : 'A'];
  const otherBpm = other.loadedTrack?.bpm ?? null;

  const onMatch = () => {
    // The other deck's BPM may have been edited since its load — prefer the
    // fresh track from the query cache (kept warm by its own panel).
    const otherFresh = other.loadedTrack
      ? (queryClient.getQueryData<Track>(['track', other.loadedTrack.id])?.bpm ??
        otherBpm)
      : null;
    if (!track?.bpm || otherFresh === null) return;
    const otherEffective =
      otherFresh * (1 + other.engine.getSnapshot().pitchPercent / 100);
    const result = bpmMatch(track.bpm, otherEffective);
    if (result.kind === 'match') {
      engine.setPitch(result.pitchPercent);
    } else {
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), MATCH_HINT_MS);
    }
  };

  const bendStart = (sign: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    engine.setBend(sign * NUDGE_BEND_PERCENT);
  };
  const bendEnd = () => engine.setBend(0);

  return (
    <div className="perf-tempo-cluster">
      <button
        className={`player-button perf-mini perf-match${hint ? ' perf-match-hint' : ''}`}
        disabled={!ready || !track?.bpm || otherBpm === null}
        onClick={onMatch}
        title="Match the other deck's tempo (half/double-aware)"
      >
        {hint ? 'OUT OF REACH' : 'MATCH'}
      </button>
      <label className="perf-pitch">
        <input
          type="range"
          min={-80}
          max={80}
          value={Math.round(pitch * 10)}
          onChange={(e) => engine.setPitch(Number(e.target.value) / 10)}
          onDoubleClick={() => engine.setPitch(0)}
          disabled={!ready}
        />
        <span>
          PITCH {pitch >= 0 ? '+' : ''}
          {pitch.toFixed(1)}%
        </span>
      </label>
      <div className="perf-nudge">
        <button
          className={`player-button perf-mini${bend < 0 ? ' perf-nudge-held' : ''}`}
          disabled={!ready}
          title="Nudge slower (hold)"
          onPointerDown={bendStart(-1)}
          onPointerUp={bendEnd}
          onPointerCancel={bendEnd}
        >
          ◄
          <Kbd k={keys.nudgeBack} />
        </button>
        <button
          className={`player-button perf-mini${bend > 0 ? ' perf-nudge-held' : ''}`}
          disabled={!ready}
          title="Nudge faster (hold)"
          onPointerDown={bendStart(1)}
          onPointerUp={bendEnd}
          onPointerCancel={bendEnd}
        >
          ►
          <Kbd k={keys.nudgeForward} />
        </button>
      </div>
    </div>
  );
}

// ── Metadata footer ──────────────────────────────────────────────────────

function MetaFooter({ track }: { track: Track | null }) {
  const edit = useTrackEdit(track);

  const commitField = (field: 'title' | 'artist') => (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === track?.[field]) return;
    edit.commit({ [field]: trimmed });
  };

  return (
    <div className="perf-meta-footer">
      <div className="perf-energy-picker" title="Energy">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            className={`perf-energy energy-${level}${track?.energy === level ? ' set' : ''}`}
            disabled={!edit.enabled}
            onClick={() => edit.commit({ energy: level })}
          >
            {level}
          </button>
        ))}
      </div>
      <div className="perf-deckmeta">
        <InlineEdit
          className="perf-inline-edit perf-title"
          value={track?.title ?? ''}
          placeholder="—"
          disabled={!edit.enabled}
          onCommit={commitField('title')}
        />
        <InlineEdit
          className="perf-inline-edit"
          value={track?.artist ?? ''}
          placeholder="—"
          disabled={!edit.enabled}
          onCommit={commitField('artist')}
        />
      </div>
      <span className="perf-key">{formatKeyDisplay(track?.key)}</span>
    </div>
  );
}

/** Uncontrolled input, remounted when the upstream value changes. */
function InlineEdit({
  className,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  className: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      key={value}
      className={className}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

// ── Panel ────────────────────────────────────────────────────────────────

export function DeckPanel({
  mirrored = false,
  lockHint = false,
}: {
  mirrored?: boolean;
  /** Flash the load-lock refusal hint (view policy — a running deck). */
  lockHint?: boolean;
}) {
  const { deck, engine } = useDeck();
  const ready = useDeckReady();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const track = useDeckTrack();

  return (
    <section className={`perf-deckpanel${mirrored ? ' mirrored' : ''}`}>
      <div className="perf-deck-minimap">
        <span className="perf-decktag">{deck}</span>
        {lockHint && <span className="perf-lock-hint">PLAYING — LOAD BLOCKED</span>}
        <WaveformMinimap
          trackId={track?.id ?? null}
          clock={engine}
          cuePoint={cuePoint}
          onSeek={(t) => ready && engine.seek(t)}
          dimmed={track !== null && !ready}
        />
      </div>
      <div className="perf-deck-controls">
        <div className="perf-deck-column">
          <DeckPads trackId={track?.id ?? null} />
          <BeatjumpRow />
          <TransportBlock />
        </div>
        <BeatgridBlock track={track} />
        <TempoCluster track={track} />
      </div>
      <MetaFooter track={track} />
    </section>
  );
}
