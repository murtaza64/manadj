/**
 * PROTOTYPE — Performance view layout (throwaway), iteration 3.
 *
 * Question: what should the two-deck Performance view look like?
 * Iteration notes:
 *   - top 50vh performance surface, bottom 50vh real Library (browseOnly)
 *   - per-deck minimap at the top of each panel
 *   - square transport block (library-player style), 2x4 hot pads
 *   - beatgrid + BPM tweaking per deck (Deck A wired to real mutations:
 *     nudge, set-downbeat-at-playhead, BPM edit, x2/half — imported Engine
 *     beatgrids make these meaningful)
 *   - rotary knobs for trim/EQ/filter; columnar mixer (knobs -> vol fader),
 *     crossfader + master below
 *   - vertical pitch fader; track metadata in the panel footer (A left, B right)
 *
 * Deck A is the real shared Deck (library keyboard hub works). Deck B is an
 * inert visual stub. Mixer controls are unwired. DELETE when answered.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import { useNudgeBeatgrid, useSetBeatgridDownbeat } from '../../hooks/useBeatgridData';
import WebGLWaveform from '../WebGLWaveform';
import type { ScrubTransport } from '../WebGLWaveform';
import WaveformMinimap from '../WaveformMinimap';
import Library from '../Library';
import HotCue from '../HotCue';
import type { PlaybackClock } from '../../playback/clock';
import { formatKeyDisplay } from '../../utils/keyUtils';
import type { PaginatedTracks, Track } from '../../types';
import './performance-prototype.css';

/** Deck B stands still at a fixed playhead — layout only. */
const STUB_CLOCK: PlaybackClock = { getPlayhead: () => 63.2 };
const STUB_TRANSPORT: ScrubTransport = {
  isPlaying: () => false,
  pause: () => {},
  play: () => {},
  seek: () => {},
};

const KEYS = {
  A: { cue: 'F', play: 'D', jumpBack: 'A', jumpFwd: 'S', pads: ['Z', 'X', 'C', 'V'] },
  B: { cue: 'J', play: 'K', jumpBack: 'L', jumpFwd: ';', pads: ['M', ',', '.', '/'] },
};

const NOOP = () => {};

// ── Leaf controls ────────────────────────────────────────────────────────

function Kbd({ k }: { k: string }) {
  return <kbd className="pp-kbd">{k}</kbd>;
}

/** Rotary knob: drag vertically to turn. Unwired (local state). */
function Knob({ label }: { label: string }) {
  const [value, setValue] = useState(50); // 0..100
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const angle = -135 + (value / 100) * 270;

  return (
    <div className="pp-knob">
      <div
        className="pp-knob-dial"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startY: e.clientY, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const delta = drag.current.startY - e.clientY;
          setValue(Math.max(0, Math.min(100, drag.current.startValue + delta)));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setValue(50)}
      >
        <div className="pp-knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function VFader({ label }: { label: string }) {
  const [v, setV] = useState(80);
  return (
    <label className="pp-vfader">
      <input type="range" min={0} max={100} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <span>{label}</span>
    </label>
  );
}

function HFader({ label, wide = false }: { label: string; wide?: boolean }) {
  const [v, setV] = useState(50);
  return (
    <label className={`pp-hfader${wide ? ' wide' : ''}`}>
      <input type="range" min={0} max={100} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <span>{label}</span>
    </label>
  );
}

// ── Deck pieces ──────────────────────────────────────────────────────────

/** Beatjump row: jump back, halve size, [size], double size, jump forward. */
function BeatjumpRow({
  deck,
  size,
  onSize,
}: {
  deck: 'A' | 'B';
  size: number;
  onSize: (n: number) => void;
}) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const live = deck === 'A';
  const enabled = live && ready;
  const keys = KEYS[deck];

  return (
    <div className="pp-jumprow">
      <button className="player-button" disabled={!enabled} onClick={() => enabled && engine.jumpBeats(-size)}>
        ◄◄<Kbd k={keys.jumpBack} />
      </button>
      <button
        className="player-button"
        disabled={!live}
        onClick={() => onSize(Math.max(1, size / 2))}
        title="Halve beatjump size"
      >
        −
      </button>
      <span className="pp-jumpsize" title="Beatjump size (beats)">{size}</span>
      <button
        className="player-button"
        disabled={!live}
        onClick={() => onSize(Math.min(128, size * 2))}
        title="Double beatjump size"
      >
        +
      </button>
      <button className="player-button" disabled={!enabled} onClick={() => enabled && engine.jumpBeats(size)}>
        ►►<Kbd k={keys.jumpFwd} />
      </button>
    </div>
  );
}

/** Square transport block, library-player style: CUE / PLAY rows. */
function TransportBlock({ deck }: { deck: 'A' | 'B' }) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const snapshot = useDeckSnapshot((s) => s);
  const live = deck === 'A';
  const enabled = live && ready;
  const keys = KEYS[deck];
  const playing = live && (snapshot.playing || snapshot.pendingPlay);

  return (
    <div className="pp-transport-block">
      <button
        className={`player-button player-button-cue${live && snapshot.previewing ? ' player-button-cue-held' : ''}`}
        disabled={!enabled}
        onPointerDown={(e) => {
          if (!enabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          engine.cueDown();
        }}
        onPointerUp={() => enabled && engine.cueUp()}
      >
        CUE<Kbd k={keys.cue} />
      </button>
      <button
        className={`player-button ${playing ? 'player-button-playing' : 'player-button-paused'}`}
        disabled={!enabled}
        onClick={() => enabled && engine.togglePlay()}
      >
        ⏯<Kbd k={keys.play} />
      </button>
    </div>
  );
}

function DeckPads({ deck, trackId }: { deck: 'A' | 'B'; trackId: number | null }) {
  const live = deck === 'A';
  const actions = useHotCueActions(live ? trackId : null);
  const previewingSlot = useDeckSnapshot((s) => s.hotCuePreviewSlot);

  return (
    <div className="pp-pads">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
        <span key={slot} className="pp-pad-wrap">
          <HotCue
            slotNumber={slot}
            hotCue={live ? actions.bySlot.get(slot) : undefined}
            disabled={live ? !actions.enabled : false}
            isPreviewing={live && previewingSlot === slot}
            onDown={live ? actions.down : NOOP}
            onUp={live ? actions.up : NOOP}
            onDelete={live ? actions.remove : NOOP}
          />
          {slot <= 4 && <Kbd k={KEYS[deck].pads[slot - 1]} />}
        </span>
      ))}
    </div>
  );
}

/**
 * Beatgrid + BPM tweaking. Deck A is wired for real: nudge/downbeat hit the
 * beatgrid endpoints (Engine-imported grids), BPM edits + x2/half update the
 * track. Deck B is display-only.
 */
function BeatgridPanel({ deck, track }: { deck: 'A' | 'B'; track: Track | null }) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const live = deck === 'A';
  const enabled = live && ready && !!track;

  const queryClient = useQueryClient();
  const nudgeGrid = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();

  // Effective BPM = base BPM x varispeed (live for Deck A)
  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  const effectiveBpm = track?.bpm
    ? track.bpm * (live ? 1 + pitch / 100 : 1)
    : null;

  const commitBpm = (bpm: number) => {
    if (!enabled || !track || !isFinite(bpm) || bpm <= 0) return;
    void api.tracks.update(track.id, { bpm }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['beatgrid', track.id] });
    });
  };

  return (
    <div className="pp-beatgrid-panel">
      <div className="pp-beatgrid-row">
        <span className="pp-beatgrid-label">BPM</span>
        <input
          // Uncontrolled, remounted when the track/BPM changes
          key={`${track?.id ?? 'none'}-${track?.bpm ?? 0}`}
          className="pp-bpm-input"
          defaultValue={track?.bpm ? track.bpm.toFixed(1) : ''}
          disabled={!enabled}
          onBlur={(e) => commitBpm(parseFloat(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation(); // keep digits away from the hot-cue hub
          }}
        />
        <button className="player-button pp-mini" disabled={!enabled}
          onClick={() => track?.bpm && commitBpm(track.bpm / 2)} title="Halve BPM">½</button>
        <button className="player-button pp-mini" disabled={!enabled}
          onClick={() => track?.bpm && commitBpm(track.bpm * 2)} title="Double BPM">×2</button>
        <span className="pp-effbpm" title="Effective BPM (base x pitch)">
          {effectiveBpm !== null ? `» ${effectiveBpm.toFixed(1)}` : ''}
        </span>
      </div>
      <div className="pp-beatgrid-row">
        <span className="pp-beatgrid-label">GRID</span>
        <button className="player-button pp-mini" disabled={!enabled}
          onClick={() => track && nudgeGrid.mutate({ trackId: track.id, offsetMs: -10 })}
          title="Nudge grid 10ms earlier">◄</button>
        <button className="player-button pp-mini pp-downbeat" disabled={!enabled}
          onClick={() => track && setDownbeat.mutate({ trackId: track.id, downbeatTime: engine.getPlayhead() })}
          title="Set downbeat at playhead">D</button>
        <button className="player-button pp-mini" disabled={!enabled}
          onClick={() => track && nudgeGrid.mutate({ trackId: track.id, offsetMs: 10 })}
          title="Nudge grid 10ms later">►</button>
      </div>
    </div>
  );
}

/** Tempo cluster: MATCH on top, vertical pitch fader, momentary nudge below. */
function PitchCluster({ deck }: { deck: 'A' | 'B' }) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const live = deck === 'A';
  const enabled = live && ready;
  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  const value = live ? Math.round(pitch * 10) : 0;
  /** Pitch before a nudge began (restored on release). */
  const nudgeBase = useRef<number | null>(null);

  const bendStart = (delta: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    nudgeBase.current = engine.getSnapshot().pitchPercent;
    engine.setPitch(nudgeBase.current + delta);
  };
  const bendEnd = () => {
    if (nudgeBase.current !== null) engine.setPitch(nudgeBase.current);
    nudgeBase.current = null;
  };

  return (
    <div className="pp-pitch-cluster">
      <button className="player-button pp-mini pp-match" disabled title="Match other deck's tempo (unwired)">
        MATCH
      </button>
      <label className="pp-pitch">
        <input
          type="range"
          min={-80}
          max={80}
          value={value}
          onChange={(e) => live && engine.setPitch(Number(e.target.value) / 10)}
          onDoubleClick={() => live && engine.setPitch(0)}
        />
        <span>PITCH{live ? ` ${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}%` : ''}</span>
      </label>
      <div className="pp-nudge">
        <button
          className="player-button pp-mini"
          disabled={!enabled}
          title="Nudge slower (hold)"
          onPointerDown={bendStart(-2)}
          onPointerUp={bendEnd}
          onPointerCancel={bendEnd}
        >
          ◄
        </button>
        <button
          className="player-button pp-mini"
          disabled={!enabled}
          title="Nudge faster (hold)"
          onPointerDown={bendStart(2)}
          onPointerUp={bendEnd}
          onPointerCancel={bendEnd}
        >
          ►
        </button>
      </div>
    </div>
  );
}

/** Track metadata footer: title/artist inline edits, energy, key. */
function MetaFooter({ track, mirrored }: { track: Track | null; mirrored?: boolean }) {
  return (
    <div className={`pp-meta-footer${mirrored ? ' mirrored' : ''}`}>
      <span className={`pp-energy energy-${track?.energy ?? 0}`} title={`Energy ${track?.energy ?? '—'}`}>
        {track?.energy ?? '·'}
      </span>
      <div className="pp-deckmeta">
        <input className="pp-inline-edit pp-title" defaultValue={track?.title ?? '—'} />
        <input className="pp-inline-edit" defaultValue={track?.artist ?? '—'} />
      </div>
      <span className="pp-key">{formatKeyDisplay(track?.key)}</span>
    </div>
  );
}

function DeckPanel({
  deck,
  track,
  clock,
  mirrored,
}: {
  deck: 'A' | 'B';
  track: Track | null;
  clock: PlaybackClock;
  mirrored?: boolean;
}) {
  const { engine } = useDeck();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const live = deck === 'A';
  const [jumpSize, setJumpSize] = useState(32);

  return (
    <section className={`pp-deckpanel${mirrored ? ' mirrored' : ''}`}>
      <div className="pp-deck-minimap">
        <span className="pp-decktag">{deck}</span>
        <WaveformMinimap
          trackId={track?.id ?? null}
          clock={clock}
          cuePoint={live ? cuePoint : null}
          onSeek={live ? (t) => engine.seek(t) : NOOP}
        />
      </div>
      <div className="pp-deck-controls">
        <div className="pp-deck-column">
          <DeckPads deck={deck} trackId={track?.id ?? null} />
          <BeatjumpRow deck={deck} size={jumpSize} onSize={setJumpSize} />
          <TransportBlock deck={deck} />
        </div>
        <BeatgridPanel deck={deck} track={track} />
        <PitchCluster deck={deck} />
      </div>
      <MetaFooter track={track} mirrored={mirrored} />
    </section>
  );
}

// ── Mixer ────────────────────────────────────────────────────────────────

function MixerChannel({ deck }: { deck: 'A' | 'B' }) {
  return (
    <div className={`pp-channel${deck === 'B' ? ' mirrored' : ''}`}>
      <VFader label="VOL" />
      <div className="pp-knob-col">
        <span className="pp-channel-name">{deck}</span>
        <Knob label="TRIM" />
        <Knob label="HI" />
        <Knob label="MID" />
        <Knob label="LOW" />
        <Knob label="FLT" />
      </div>
    </div>
  );
}

function Mixer() {
  return (
    <section className="pp-mixer">
      <div className="pp-mixer-channels">
        <MixerChannel deck="A" />
        <MixerChannel deck="B" />
      </div>
      <HFader label="X-FADER" wide />
      <HFader label="MASTER" />
    </section>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

export function PerformanceViewPrototype({ onClose }: { onClose?: () => void }) {
  const { engine, loadedTrack } = useDeck();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const ready = useDeckReady();

  const { data: results } = useQuery<PaginatedTracks>({
    queryKey: ['practice-track-search', ''],
    queryFn: () => api.tracks.list(1, 20, {}),
  });
  const tracks = useMemo(() => results?.items ?? [], [results]);
  // Deck B: any browsable track that isn't on Deck A (visual stub only)
  const trackB = tracks.find((t) => t.id !== loadedTrack?.id && t.bpm) ?? null;

  const transportA: ScrubTransport = {
    isPlaying: () => engine.isAudioRunning(),
    pause: () => engine.pause(),
    play: () => engine.play(),
    seek: (t) => ready && engine.seek(t),
  };

  return (
    <div className="pp-root">
      {onClose && (
        <button className="player-button pp-back" onClick={onClose}>
          ← Library
        </button>
      )}
      {/* Performance surface — top half of the viewport */}
      <div className="pp-perf">
        <div className="pp-waves">
          <WebGLWaveform
            trackId={loadedTrack?.id ?? null}
            clock={engine}
            cuePoint={cuePoint}
            transport={transportA}
            dimmed={loadedTrack !== null && !ready}
          />
          <WebGLWaveform
            trackId={trackB?.id ?? null}
            clock={STUB_CLOCK}
            cuePoint={null}
            transport={STUB_TRANSPORT}
          />
        </div>
        <div className="pp-middle">
          <DeckPanel deck="A" track={loadedTrack} clock={engine} />
          <Mixer />
          <DeckPanel deck="B" track={trackB} clock={STUB_CLOCK} mirrored />
        </div>
      </div>

      {/* Browse surface — the real Library, bottom half */}
      <div className="pp-library">
        <Library browseOnly onOpenPlaylistSync={NOOP} onOpenPractice={NOOP} />
      </div>
    </div>
  );
}
