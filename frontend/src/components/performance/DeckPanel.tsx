/**
 * One Deck panel + its full-width waveform — deck-blind: everything reads
 * the nearest <DeckScope>, so the same component renders Deck A and Deck B.
 *
 * Ultra-flat layout (perf-layout 01): thin minimap header, then ONE dense
 * horizontal band in three zones ordered outer → inner (`mirrored` flips
 * the zone order, so both MIX zones meet at the crossfader strip):
 *   TRACK — persistent, curation class (yellow accent: edits write to the
 *           library): title/artist, tag pills, energy, tempo/grid cluster.
 *   PLAY  — three equal rows: jump|nudge, pads|CUE, pads|PLAY.
 *   MIX   — TRIM | [LOW MID HI] | FLT knobs, VOL + PITCH label-on-handle
 *           faders, KEY + effective-BPM(+pitch%) readouts beside MATCH.
 * Habit controls never mirror: transport order, slider polarity (right =
 * faster) and the foot's readout/button order are identical on both decks.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useDeck, useDeckReady, useDecks, useDeckSnapshot } from '../../hooks/useDeck';
import { useMixer } from '../../hooks/useMixer';
import { useScrubTransport } from '../../hooks/useScrubTransport';
import WebGLWaveform from '../WebGLWaveform';
import WaveformMinimap from '../WaveformMinimap';
import TagPill from '../TagPill';
import { TransportPair } from '../deckControls/TransportPair';
import { HotCuePads } from '../deckControls/HotCuePads';
import { BeatjumpRow } from '../deckControls/BeatjumpRow';
import { EnergyIcon, SpeedIcon } from '../icons';
import { BpmControl } from '../deckControls/BpmControl';
import { HFader, Knob } from './MixerStrip';
import { NUDGE_BEND_PERCENT, bpmMatch, composeRate } from '../../playback/tempo';
import { formatKeyDisplay } from '../../utils/keyUtils';
import { DECK_KEYS } from './performanceKeys';
import type { EqBand } from '../../playback/graph';
import type { Track } from '../../types';

/** How long the MATCH out-of-reach hint stays up. */
const MATCH_HINT_MS = 2000;

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

  const transport = useScrubTransport();

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

/** On-control hint for this deck's key (from the shared map — can't drift). */
function Kbd({ k }: { k: string }) {
  return <kbd className="perf-kbd">{k.toUpperCase()}</kbd>;
}

// ── TRACK zone (persistent — curation class) ─────────────────────────────

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

/** Read-only tag pills (category order, then tag order). Editing is
 * perf-layout issue 02 (TagEditor popover). */
function TagRow({ track }: { track: Track | null }) {
  const tags = [...(track?.tags ?? [])].sort(
    (a, b) =>
      (a.category?.display_order ?? 0) - (b.category?.display_order ?? 0) ||
      a.display_order - b.display_order ||
      a.id - b.id
  );
  return (
    <div className="perf-tagrow">
      {tags.map((tag) => (
        <TagPill key={tag.id} tag={tag} />
      ))}
      <button
        className="perf-tag-add"
        disabled
        title="Edit tags (perf-layout issue 02)"
      >
        +
      </button>
    </div>
  );
}

function TrackZone({ track }: { track: Track | null }) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const queryClient = useQueryClient();
  const edit = useTrackEdit(track);
  const tempoEnabled = ready && track !== null;

  const commitField = (field: 'title' | 'artist') => (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === track?.[field]) return;
    edit.commit({ [field]: trimmed });
  };

  // The shared control invalidates beatgrid+track itself; the PERF panel
  // additionally refreshes both track-table sources in the embedded library.
  const saveBpm = async (bpm: number) => {
    if (!track) return;
    await api.tracks.update(track.id, { bpm });
    void queryClient.invalidateQueries({ queryKey: ['tracks'] });
    void queryClient.invalidateQueries({ queryKey: ['playlist'] });
  };

  return (
    <div className="perf-zone perf-zone-track">
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
      <TagRow track={track} />
      <div className="perf-track-row" title="Energy">
        <span className="perf-row-icon">
          <EnergyIcon width={14} height={14} />
        </span>
        <div className="perf-energy-picker">
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
      </div>
      <div className="perf-track-row perf-track-tempo">
        {/* One tempo/grid cluster (ADR 0016 — one domain), labeled by the
            tempo icon (icon language: no BPM/GRID text labels). */}
        <span className="perf-row-icon" title="Tempo / beatgrid">
          <SpeedIcon width={14} height={14} />
        </span>
        <BpmControl
          track={track}
          dense
          disabled={!tempoEnabled}
          onSave={saveBpm}
          onCommitted={(bpm) => engine.setTrackBpm(bpm)}
          grid={{ getPlayhead: () => engine.getPlayhead(), disabled: !tempoEnabled }}
        />
      </div>
    </div>
  );
}

// ── PLAY zone: jump/nudge over pads/transport (three equal rows) ─────────
//   <jump>     <nudge>
//   <pads top> <cue>
//   <pads bot> <play>

function PlayZone() {
  const { deck, engine } = useDeck();
  const keys = DECK_KEYS[deck];
  const ready = useDeckReady();
  const bend = useDeckSnapshot((s) => s.bendPercent);

  const bendStart = (sign: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    engine.setBend(sign * NUDGE_BEND_PERCENT);
  };
  const bendEnd = () => engine.setBend(0);

  return (
    <div className="perf-zone perf-zone-play">
      <div className="perf-play-inner">
        <div className="perf-padcol">
          <BeatjumpRow
            backKbd={<Kbd k={keys.jumpBack} />}
            forwardKbd={<Kbd k={keys.jumpForward} />}
          />
          <div className="perf-pads">
            <HotCuePads
              padKbd={(slot) => (slot <= 4 ? <Kbd k={keys.pads[slot - 1]} /> : null)}
            />
          </div>
        </div>
        <div className="perf-transport-col">
          <div className="perf-nudge">
            <button
              className={`player-button${bend < 0 ? ' perf-nudge-held' : ''}`}
              disabled={!ready}
              title="Nudge slower (hold)"
              onPointerDown={bendStart(-1)}
              onPointerUp={bendEnd}
              onPointerCancel={bendEnd}
            >
              ◀◀
              <Kbd k={keys.nudgeBack} />
            </button>
            <button
              className={`player-button${bend > 0 ? ' perf-nudge-held' : ''}`}
              disabled={!ready}
              title="Nudge faster (hold)"
              onPointerDown={bendStart(1)}
              onPointerUp={bendEnd}
              onPointerCancel={bendEnd}
            >
              ▶▶
              <Kbd k={keys.nudgeForward} />
            </button>
          </div>
          <TransportPair cueKbd={<Kbd k={keys.cue} />} playKbd={<Kbd k={keys.play} />} />
        </div>
      </div>
    </div>
  );
}

// ── MIX zone: knobs / pitch / vol / readouts + MATCH/nudge ───────────────

function MixZone({ track }: { track: Track | null }) {
  const { deck, engine } = useDeck();
  const decks = useDecks();
  const ready = useDeckReady();

  // Mixer state is not React state (ADR 0009): local UI positions seeded
  // from the Mixer's getters (which survive view switches).
  const mixer = useMixer();
  const initial = mixer.getChannelState(deck);
  const [fader, setFader] = useState(initial.fader);

  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  // Effective BPM — live with pitch AND bend (what your ears get right now).
  const rate = useDeckSnapshot((s) => composeRate(s.pitchPercent, s.bendPercent));
  const effective = track?.bpm ? track.bpm * rate : null;

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

  const eqKnob = (band: EqBand, label: string) => (
    <Knob
      label={label}
      min={0}
      max={1}
      defaultValue={0.5}
      initial={initial.eq[band]}
      onChange={(v) => mixer.setEq(deck, band, v)}
    />
  );

  return (
    <div className="perf-zone perf-zone-mix">
      <div className="perf-knobrow">
        <Knob
          label="TRIM"
          min={0}
          max={1}
          defaultValue={0.5}
          initial={initial.trim}
          onChange={(v) => mixer.setTrim(deck, v)}
        />
        {/* EQ bands grouped tight; placement (not a box) separates them
            from the TRIM/FLT utilities on the flanks */}
        <div className="perf-eqgroup">
          {eqKnob('low', 'LOW')}
          {eqKnob('mid', 'MID')}
          {eqKnob('high', 'HI')}
        </div>
        <Knob
          label="FLT"
          min={-1}
          max={1}
          defaultValue={0}
          initial={initial.filter}
          onChange={(v) => mixer.setFilter(deck, v)}
        />
      </div>
      <HFader
        label="VOL"
        min={0}
        max={1}
        value={fader}
        defaultValue={1}
        onChange={(v) => {
          setFader(v);
          mixer.setFader(deck, v);
        }}
        title="Channel volume (double-click = full)"
      />
      {/* Horizontal pitch: right = faster (grill decision — the vertical
          fader's hardware polarity died with the vertical fader). */}
      <HFader
        label="PITCH"
        accent
        detent
        min={-8}
        max={8}
        value={pitch}
        defaultValue={0}
        onChange={(v) => engine.setPitch(Math.round(v * 10) / 10)}
        disabled={!ready}
        title="Pitch (right = faster; double-click resets)"
      />
      <div className="perf-mix-foot">
        <span className="perf-readout" title="Key">
          <span className="perf-readout-label">KEY</span>
          <span className="perf-readout-val perf-readout-key">
            {formatKeyDisplay(track?.key)}
          </span>
        </span>
        <span className="perf-readout" title="Effective BPM (base × pitch × bend)">
          <span className="perf-readout-label">BPM</span>
          <span className="perf-readout-val">
            {effective !== null ? effective.toFixed(1) : '-'}
          </span>
          <span className="perf-readout-sub">
            {pitch >= 0 ? '+' : ''}
            {pitch.toFixed(1)}%
          </span>
        </span>
        <span className="perf-mix-spacer" />
        <button
          className={`player-button perf-mini perf-match${hint ? ' perf-match-hint' : ''}`}
          disabled={!ready || !track?.bpm || otherBpm === null}
          onClick={onMatch}
          title="Match the other deck's tempo (half/double-aware)"
        >
          {hint ? 'OUT OF REACH' : 'MATCH'}
        </button>
      </div>
    </div>
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
      <div className="perf-deck-band">
        <TrackZone track={track} />
        <PlayZone />
        <MixZone track={track} />
      </div>
    </section>
  );
}
