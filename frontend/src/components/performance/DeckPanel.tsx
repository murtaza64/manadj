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
import { useMatchAction } from '../../hooks/useMatchAction';
import { useMixer, useMixerValue } from '../../hooks/useMixer';
import { useScrubTransport } from '../../hooks/useScrubTransport';
import WebGLWaveform from '../WebGLWaveform';
import WaveformMinimap from '../WaveformMinimap';
import TagPill from '../TagPill';
import { TransportPair } from '../deckControls/TransportPair';
import { HotCuePads } from '../deckControls/HotCuePads';
import { BeatjumpRow } from '../deckControls/BeatjumpRow';
import { EnergyIcon, MusicIcon, PersonIcon, SpeedIcon, TagIcon } from '../icons';
import { BpmControl } from '../deckControls/BpmControl';
import { HFader, Knob } from './MixerStrip';
import { TagPopover } from './TagPopover';
import { NUDGE_BEND_PERCENT, composeRate, effectiveBpm, keyDrifted } from '../../playback/tempo';
import { trackWindowSeconds } from '../../utils/waveformZoom';
import { formatKeyDisplay } from '../../utils/keyUtils';
import { setKeyLockFlag } from '../../playback/keyLockStore';
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
  /** The one zoom both decks share (WALL-CLOCK seconds) — held by the view. */
  visibleSeconds: number;
  onVisibleSecondsChange: (seconds: number) => void;
}) {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);

  const transport = useScrubTransport();

  // Effective-BPM zoom (performance-mode 06): the renderer consumes TRACK
  // seconds, so scale the shared wall-clock window by this deck's rate —
  // beat spacing on screen then follows effective BPM, and beatmatched
  // decks line up visually. The wheel callback divides the multiplicative
  // step back out, keeping the shared state rate-free.
  //
  // Pitch only: a nudge's momentary bend must not breathe the zoom scale —
  // you nudge for phase while WATCHING the beats, so the ruler has to hold
  // still (the effective-BPM readout keeps bend; that one is for ears).
  const rate = useDeckSnapshot((s) => composeRate(s.pitchPercent, 0));

  return (
    <WebGLWaveform
      trackId={loadedTrack?.id ?? null}
      clock={engine}
      cuePoint={cuePoint}
      transport={transport}
      dimmed={loadedTrack !== null && !ready}
      visibleSeconds={trackWindowSeconds(visibleSeconds, rate)}
      onVisibleSecondsChange={(seconds) => onVisibleSecondsChange(seconds / rate)}
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

/** Tag pills (category order, then tag order); the row opens the tag
 * popover (perf-layout 02) when editable. */
function TagRow({ track, onOpen }: { track: Track | null; onOpen?: () => void }) {
  const tags = [...(track?.tags ?? [])].sort(
    (a, b) =>
      (a.category?.display_order ?? 0) - (b.category?.display_order ?? 0) ||
      a.display_order - b.display_order ||
      a.id - b.id
  );
  return (
    <div
      className={`perf-tagrow${onOpen ? ' editable' : ''}`}
      title={onOpen ? 'Edit tags' : undefined}
      onClick={onOpen}
    >
      {/* Pills clip in their own shrinkable box so the + never overflows away */}
      <div className="perf-tagrow-pills">
        {tags.map((tag) => (
          <TagPill key={tag.id} tag={tag} />
        ))}
      </div>
      <button className="perf-tag-add" disabled={!onOpen} title="Edit tags">
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

  // Open state is PER TRACK ID: loading a different track implicitly
  // closes the popover (no effect needed — the ids stop matching).
  const [tagsOpenFor, setTagsOpenFor] = useState<number | null>(null);
  const tagsOpen = track !== null && tagsOpenFor === track.id;
  const tagRowRef = useRef<HTMLDivElement>(null);

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
      <div className="perf-track-row">
        <span className="perf-row-icon" title="Title">
          <MusicIcon width={13} height={13} />
        </span>
        <InlineEdit
          className="perf-inline-edit perf-title"
          value={track?.title ?? ''}
          placeholder="—"
          disabled={!edit.enabled}
          onCommit={commitField('title')}
        />
      </div>
      <div className="perf-track-row">
        <span className="perf-row-icon" title="Artist">
          <PersonIcon width={13} height={13} />
        </span>
        <InlineEdit
          className="perf-inline-edit"
          value={track?.artist ?? ''}
          placeholder="—"
          disabled={!edit.enabled}
          onCommit={commitField('artist')}
        />
      </div>
      <div className="perf-track-row" ref={tagRowRef}>
        <span className="perf-row-icon" title="Tags">
          <TagIcon width={13} height={13} />
        </span>
        <TagRow
          track={track}
          onOpen={
            edit.enabled
              ? () => setTagsOpenFor((open) => (open === track!.id ? null : track!.id))
              : undefined
          }
        />
        {tagsOpen && track && (
          <TagPopover
            key={track.id}
            track={track}
            anchorRef={tagRowRef}
            commit={(tagIds) => edit.commit({ tag_ids: tagIds })}
            onClose={() => setTagsOpenFor(null)}
          />
        )}
      </div>
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

  // Mixer state is not React state (ADR 0009): controls are controlled
  // components subscribed through useMixerValue, so hardware Controller
  // moves repaint them too (midi-controller 09).
  const mixer = useMixer();
  const channel = useMixerValue((m) => m.getChannelState(deck));

  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  const keyLock = useDeckSnapshot((s) => s.keyLock);
  const drifted = keyDrifted(keyLock, pitch);
  // Effective BPM follows the pitch fader only: a nudge's momentary bend is
  // a phase correction, not a tempo change — the readout must not wobble
  // mid-beatmatch (same reasoning as the zoom window, performance-mode 06).
  const effective = track?.bpm ? effectiveBpm(track.bpm, pitch) : null;

  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const other = decks[deck === 'A' ? 'B' : 'A'];
  const otherBpm = other.loadedTrack?.bpm ?? null;

  // Shared with the hardware SYNC button (useMatchAction applies the pitch);
  // only the out-of-reach hint is on-screen-specific.
  const matchAction = useMatchAction();
  const onMatch = () => {
    if (matchAction()?.kind === 'out-of-reach') {
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
      value={channel.eq[band]}
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
          value={channel.trim}
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
          value={channel.filter}
          onChange={(v) => mixer.setFilter(deck, v)}
        />
      </div>
      <HFader
        label="VOL"
        fill
        fillColor={`var(--deck-${deck.toLowerCase()})`}
        min={0}
        max={1}
        value={channel.fader}
        defaultValue={1}
        onChange={(v) => mixer.setFader(deck, v)}
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
        {/* Drift marker (key-lock 04): unlocked + |pitch| ≥ ~half a
            semitone means the sounding key is no longer the Track's Key —
            dim it and mark with ~ (no computed "actual key"; PRD). */}
        <span
          className="perf-readout"
          title={
            drifted
              ? 'Key drifted: Key Lock is off and pitch has shifted the sounding key'
              : 'Key'
          }
        >
          <span
            className={`perf-readout-val perf-readout-key${
              drifted ? ' perf-key-drift' : ''
            }`}
          >
            {/* Always rendered so the readout width never jumps; invisible
                until the key has drifted. */}
            <span className="perf-key-tilde" aria-hidden={!drifted}>
              ~
            </span>
            {formatKeyDisplay(track?.key)}
          </span>
        </span>
        {/* Key Lock (key-lock 03): Deck setting — works with no track
            loaded, sticky per Deck (engine holds live state, store
            persists). Lit while tempo changes leave the Key unchanged. */}
        <button
          className={`player-button perf-mini perf-keylock${keyLock ? ' on' : ''}`}
          onClick={() => {
            engine.setKeyLock(!keyLock);
            setKeyLockFlag(deck, !keyLock);
          }}
          aria-pressed={keyLock}
          title={
            keyLock
              ? 'Key Lock on: pitch changes keep the Track\u2019s Key (click for vinyl-style varispeed)'
              : 'Key Lock off: speed and pitch coupled, like vinyl (click to hold the Key)'
          }
        >
          LOCK
        </button>
        <span className="perf-readout" title="Effective BPM (base × pitch × bend)">
          <span className="perf-readout-val">
            {effective !== null ? effective.toFixed(1) : '-'}
          </span>
          <span className="perf-readout-sub">
            {pitch >= 0 ? '+' : ''}
            {pitch.toFixed(1)}%
          </span>
        </span>
        <span className="perf-mix-spacer" />
        {/* PFL (headphone-cue 02): mixer state, so it works with no track
            loaded and repaints from hardware toggles (note 0x0C). Headphone
            glyph like the hardware button; "PFL" stays in the tooltip. */}
        <button
          className={`player-button perf-mini perf-pfl${channel.pfl ? ' on' : ''}`}
          onClick={() => mixer.togglePfl(deck)}
          aria-label="PFL"
          title={
            channel.pfl
              ? 'Remove this channel from the headphones (PFL)'
              : 'Pre-listen this channel in the headphones (PFL)'
          }
        >
          <svg className="perf-pfl-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.5 12 V8 a5.5 5.5 0 0 1 11 0 V12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <rect x="1.2" y="9.4" width="3.1" height="4.8" rx="1" fill="currentColor" />
            <rect x="11.7" y="9.4" width="3.1" height="4.8" rx="1" fill="currentColor" />
          </svg>
        </button>
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
        <span className={`perf-decktag deck-${deck.toLowerCase()}`}>{deck}</span>
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
