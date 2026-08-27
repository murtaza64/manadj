/**
 * One Deck panel + its full-width waveform — deck-blind: everything reads
 * the nearest <DeckScope>, so the same component renders every Deck A–D.
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
 * faster) and the foot's readout/button order are identical on every Deck.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useDeck, useDeckReady, useDecks, useDeckSnapshot } from '../../hooks/useDeck';
import { useMatchAction } from '../../hooks/useMatchAction';
import { useAutomationGhost, useMixer, useMixerValue } from '../../hooks/useMixer';
import { useTakeoverHint } from '../../hooks/useTakeoverHint';
import { takeoverKey } from '../../midi/takeoverFeedback';
import { useScrubTransport } from '../../hooks/useScrubTransport';
import { useViewActive } from '../../contexts/viewActive';
import WebGLWaveform from '../WebGLWaveform';
import WaveformMinimap from '../WaveformMinimap';
import TagPill from '../TagPill';
import { TransportPair } from '../deckControls/TransportPair';
import { HotCuePads } from '../deckControls/HotCuePads';
import { BeatjumpRow } from '../deckControls/BeatjumpRow';
import { CueWalkButtons } from '../deckControls/CueWalkButtons';
import { LoopRow } from '../deckControls/LoopRow';
import { EnergyIcon, MusicIcon, PersonIcon, SpeedIcon, TagIcon } from '../icons';
import { BpmControl } from '../deckControls/BpmControl';
import { HFader, Knob } from './MixerStrip';
import { PlayGuideMinimapMarks } from '../../performance/PlayGuideMinimapMarks';
import { TagPopover } from './TagPopover';
import { NUDGE_BEND_PERCENT, composeRate, effectiveBpm, keyDrifted } from '../../playback/tempo';
import { DECK_COLORS, hexToRgbTriplet } from '../../theme/deckColors';
import { PLAY_MARKER_FRACTION, trackWindowSeconds } from '../../utils/waveformZoom';
import { channelFaderToGain, trimToGain } from '../../playback/mixerMath';
import { createStripHistory } from '../../performance/stripHistory';
import type { StripValues } from '../../performance/stripHistory';
import { eqValueToGain } from '../../playback/graph';
import type { Mixer } from '../../playback/mixer';
import { focusDeck, useControlFocus } from '../../performance/controlFocus';
import { formatKeyDisplay } from '../../utils/keyUtils';
import { getBpmColor, getKeyColor } from '../../utils/displayColors';
import { setKeyLockFlag } from '../../playback/keyLockStore';
import { DECK_KEYS } from './performanceKeys';
import { CHANNEL_IDS, STEM_NAMES } from '../../playback/mixer';
import type { StemName } from '../../playback/mixer';

/** Stem kill-switch labels (stems #210): compact, hardware-ish. */
const STEM_LABELS: Record<StemName, string> = {
  vocals: 'VOC',
  drums: 'DRM',
  bass: 'BAS',
  other: 'OTH',
};
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
  /** The one zoom all four Decks share (WALL-CLOCK seconds) — held by the view. */
  visibleSeconds: number;
  onVisibleSecondsChange: (seconds: number) => void;
}) {
  const { deck, engine, loadedTrack, beatjumpBeats } = useDeck();
  const controlFocus = useControlFocus();
  const focused = controlFocus.left === deck || controlFocus.right === deck;
  const ready = useDeckReady();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const loop = useDeckSnapshot((s) => s.loop);
  // Any audibly-advancing state pins the waveform loop at 60fps and wakes it
  // instantly at play (performance-hardening 01) — same set usePlayGuides
  // treats as "moving".
  const advancing = useDeckSnapshot(
    (s) => s.playing || s.pendingPlay || s.previewing || s.hotCuePreviewSlot !== null,
  );

  const transport = useScrubTransport();
  const mixer = useMixer();
  const viewActive = useViewActive();
  // The deck's channel state (replaced immutably on every mixer move):
  // wakes the idle waveform loop so a PAUSED deck retints instantly on
  // fader/EQ moves, and restarts the fill recorder loop below
  // (performance-hardening 01 × performance-mode 09).
  const channelState = useMixerValue((m) => m.getChannelState(deck));

  // Per-gesture wake (#155): every transport gesture — notably paused MIDI
  // jog seeks, which arrive sparser than 60fps — pulls an idle-parked
  // render loop forward to the next frame. Without this the loop re-parks
  // on its 250ms poll between jog ticks and paused scrubbing jitters.
  const subscribeWake = useCallback(
    (cb: () => void) => engine.addTransportEventListener(cb),
    [engine],
  );

  // Live mixer → waveform modulation (performance-mode 09, the sessions-19
  // semantics applied live): EQ dims/removes its band group; trim scales
  // (display-normalized to center, capped at 1). PRE-FADER by design — the
  // fader renders as the area fill below, never as waveform height. The
  // renderer resamples the modTex every frame, so this closure self-updates;
  // channel states are replaced immutably, so the curve math is
  // identity-cached and the per-sample cost is a reference check.
  const modCacheRef = useRef<{
    state: ReturnType<Mixer['getChannelState']> | null;
    auto: ReturnType<Mixer['getAutomation']>;
    value: StripValues;
  }>({ state: null, auto: null, value: { gain: 1, low: 1, mid: 1, high: 1, fader: 1 } });
  const liveStrip = useCallback(() => {
    const cache = modCacheRef.current;
    const ch = mixer.getChannelState(deck);
    // EFFECTIVE strip: a machine tenure (Conductor / session replay) drives
    // the automation overlay, not the human state (ADR 0022) — the waveform
    // must show what's audible, whoever's hands are on the strip.
    const auto = mixer.getAutomation(deck);
    if (ch !== cache.state || auto !== cache.auto) {
      cache.state = ch;
      cache.auto = auto;
      const eq = auto?.eq ?? ch.eq;
      const trim = auto?.trim ?? ch.trim;
      cache.value = {
        // Real trim curve, center-normalized, UNCAPPED above neutral: a
        // boost fattens the body (the shader clamps heights at the rail,
        // like a meter pinning). The mod texture encodes up to 2× — a
        // +12 dB trim reads as 2× (saturated), which is the honest ceiling.
        gain: trimToGain(trim) / trimToGain(0.5),
        low: eqValueToGain(eq.low),
        mid: eqValueToGain(eq.mid),
        high: eqValueToGain(eq.high),
        // Raw fader position — the fill's input, never the waveform's.
        fader: auto?.fader ?? ch.fader,
      };
    }
    return cache.value;
  }, [mixer, deck]);

  // Past-preserving modulation: behind the playhead the waveform shows the
  // strip as it WAS when that audio played (a per-frame recorder feeds a
  // step series in track time); the frontier and beyond show the live
  // strip. New track → fresh history.
  const historyRef = useRef(createStripHistory());
  useEffect(() => {
    historyRef.current.clear();
  }, [loadedTrack?.id]);
  const modulation = useCallback(
    (t: number) => historyRef.current.at(t, liveStrip()),
    [liveStrip]
  );

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

  // Fader area fill (performance-mode 09): the timeline's audibility-fill
  // idiom live, with the SAME history as the modulation — behind the
  // playhead the fill shows the fader as it was when that audio played;
  // ahead, the live fader. Drawn per column on a 2D canvas in the recorder
  // loop (a single DOM bar can't vary along the window). Mirrors the GL
  // renderer's view mapping: start = playhead − span × marker fraction.
  const fillCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fillViewRef = useRef({ span: 0, hasTrack: false });
  fillViewRef.current = {
    span: trackWindowSeconds(visibleSeconds, rate),
    hasTrack: loadedTrack !== null,
  };
  // Idle-gated like the GL loops (performance-hardening 01): rAF only while
  // the deck advances or the drawn inputs changed; 250ms poll when paused
  // and unchanged; nothing at all while the view is hidden. Restarting on
  // channelState keeps paused fader moves instant (history recording is
  // paused-safe: record() writes nothing while not playing).
  useEffect(() => {
    if (!viewActive) return;
    let raf = 0;
    let idleTimer = 0;
    let lastDrawKey = '';
    const fillCss = `rgba(${hexToRgbTriplet(DECK_COLORS[deck])}, 0.12)`;
    const schedule = (active: boolean) => {
      if (active) raf = requestAnimationFrame(loop);
      else idleTimer = window.setTimeout(loop, 250);
    };
    const loop = () => {
      const snap = engine.getSnapshot();
      const playhead = engine.getPlayhead();
      const live = liveStrip();
      const advancing = snap.playing || snap.previewing;
      historyRef.current.record(playhead, advancing, live);

      const canvas = fillCanvasRef.current;
      let didDraw = false;
      if (canvas) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const { span, hasTrack } = fillViewRef.current;
        const drawKey =
          `${playhead}:${span}:${hasTrack}:${w}x${h}:` +
          `${live.gain}:${live.low}:${live.mid}:${live.high}:${live.fader}`;
        didDraw = drawKey !== lastDrawKey;
        if (didDraw) {
          lastDrawKey = drawKey;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          const ctx = canvas.getContext('2d');
          if (ctx && w > 0 && h > 0) {
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = fillCss;
            if (!hasTrack || span <= 0) {
              const bar = channelFaderToGain(live.fader) * h;
              ctx.fillRect(0, h - bar, w, bar);
            } else {
              const start = playhead - span * PLAY_MARKER_FRACTION;
              const step = 2; // px per column — a translucent wash, not a plot
              for (let x = 0; x < w; x += step) {
                const t = start + ((x + step / 2) / w) * span;
                if (t < 0 || t > snap.duration) continue;
                const v = historyRef.current.at(t, live);
                const bar = channelFaderToGain(v.fader) * h;
                if (bar > 0) ctx.fillRect(x, h - bar, step, bar);
              }
            }
          }
        }
      }
      schedule(advancing || didDraw);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
  }, [engine, deck, liveStrip, viewActive, channelState]);

  // Machine tenure (Conductor / session replay): the control-focus
  // indicators are meaningless on the waveforms while a machine holds the
  // strips — drop the frame, the bright side bars, and the unfocused dim
  // (deck CONTROLS keep theirs). The automation ghost doubles as the
  // tenure signal (non-null = overlay engaged).
  const automationGhost = useAutomationGhost(deck);
  const machineHeld = automationGhost !== null;
  const showFocus = focused && !machineHeld;

  return (
    <div
      className={`perf-wave-row deck-${deck.toLowerCase()}${showFocus ? ' focused' : ''}${machineHeld ? ' machine' : ''}`}
    >
      <WebGLWaveform
        trackId={loadedTrack?.id ?? null}
        clock={engine}
        cuePoint={cuePoint}
        loop={loop}
        transport={transport}
        dimmed={loadedTrack !== null && !ready}
        beatjumpBeats={beatjumpBeats}
        playing={advancing}
        wakeKey={channelState}
        subscribeWake={subscribeWake}
        visibleSeconds={trackWindowSeconds(visibleSeconds, rate)}
        onVisibleSecondsChange={(seconds) => onVisibleSecondsChange(seconds / rate)}
        modulation={modulation}
        modulationSplit
      />
      {/* Translucent overlay (the GL canvas is opaque — nothing shows
          "behind" it); no filters over canvas layers (compositor leak). */}
      <canvas ref={fillCanvasRef} className="perf-wave-fader-fill" />
      {showFocus ? <div className="perf-wave-focus-frame" /> : null}
    </div>
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
          onCommitted={(bpm) => track && engine.setTrackBpm(track.id, bpm)}
          grid={{ getPlayhead: () => engine.getPlayhead(), disabled: !tempoEnabled }}
        />
      </div>
    </div>
  );
}

// ── PLAY zone: jump/loop/pads column beside nudge/transport ──────────────
//   <jump>     <nudge>
//   <loop>     <cue>
//   <pads top> <play>
//   <pads bot>

function PlayZone() {
  const { deck, engine } = useDeck();
  // Stem kill switches (stems #210): under the hotcue pads, INSIDE the
  // fixed-height pad band — the padcol squashes from 4 rows to 5 when the
  // Load plays from stems, so deck height never changes. Mixer state —
  // hardware toggles repaint, capture records (#212); worklet
  // declick-ramps every flip.
  const stemsLoaded = useDeckSnapshot((s) => s.stemsLoaded);
  const mixer = useMixer();
  const stems = useMixerValue((m) => m.getChannelState(deck).stems);
  // Hand hints by side: left-side Decks (A/C) show the left-hand ('A')
  // keys, right-side (B/D) the right-hand ('B') keys.
  const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
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
        <div className={`perf-padcol${stemsLoaded ? ' has-stems' : ''}`}>
          <BeatjumpRow
            backKbd={<Kbd k={keys.jumpBack} />}
            forwardKbd={<Kbd k={keys.jumpForward} />}
          />
          <LoopRow kbd={<Kbd k={keys.loop} />} />
          <div className="perf-pads">
            <HotCuePads
              padKbd={(slot) => (slot <= 4 ? <Kbd k={keys.pads[slot - 1]} /> : null)}
            />
          </div>
          {stemsLoaded ? (
            <div className="perf-stemrow">
              {STEM_NAMES.map((stem) => (
                <button
                  key={stem}
                  className={`player-button perf-stem perf-stem-${stem}${
                    stems[stem] ? ' on' : ''
                  }`}
                  onClick={(e) =>
                    e.shiftKey
                      ? mixer.soloStem(deck, stem)
                      : mixer.setStemEnabled(deck, stem, !stems[stem])
                  }
                  title={`${stems[stem] ? 'Kill' : 'Restore'} ${stem} — shift-click to solo`}
                >
                  {STEM_LABELS[stem]}
                </button>
              ))}
            </div>
          ) : null}
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
          <CueWalkButtons />
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
  // Automation ghosts (sets 15): the overlay's live values, rAF-polled
  // (the automation write path never notifies — ADR 0022). Null while no
  // overlay is engaged; display only.
  const auto = useAutomationGhost(deck);

  const pitch = useDeckSnapshot((s) => s.pitchPercent);
  const keyLock = useDeckSnapshot((s) => s.keyLock);

  // Soft-takeover hints (midi-controller 18): pulse the control a
  // mismatched hardware fader/knob is reaching for. Read per control —
  // eqKnob is a render helper, so band hints are read here, not inside it.
  const trimTakeover = useTakeoverHint(takeoverKey.trim(deck));
  const eqTakeover = {
    low: useTakeoverHint(takeoverKey.eq(deck, 'low')),
    mid: useTakeoverHint(takeoverKey.eq(deck, 'mid')),
    high: useTakeoverHint(takeoverKey.eq(deck, 'high')),
  };
  const filterTakeover = useTakeoverHint(takeoverKey.filter(deck));
  const faderTakeover = useTakeoverHint(takeoverKey.channelFader(deck));
  const pitchTakeover = useTakeoverHint(takeoverKey.pitch(deck));
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

  const subscribeMatchTargets = useCallback(
    (listener: () => void) => {
      const unsubs = CHANNEL_IDS.filter((candidate) => candidate !== deck).map((candidate) =>
        decks[candidate].engine.subscribe(listener)
      );
      return () => unsubs.forEach((unsubscribe) => unsubscribe());
    },
    [deck, decks]
  );
  const getHasPlayingReference = useCallback(
    () =>
      CHANNEL_IDS.some(
        (candidate) =>
          candidate !== deck &&
          decks[candidate].engine.getSnapshot().playing &&
          !!decks[candidate].engine.getSnapshot().bpm
      ),
    [deck, decks]
  );
  const hasPlayingReference = useSyncExternalStore(
    subscribeMatchTargets,
    getHasPlayingReference
  );

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
      ghost={auto ? auto.eq[band] : null}
      takeover={eqTakeover[band]}
    />
  );

  return (
    <div className="perf-zone perf-zone-mix">
      <div className="perf-knobrow">
        {/* TRIM/EQ/FLT and PFL spread evenly across the row; PFL at the
            right end on every Deck */}
        {/* TRIM runs smaller than the EQ knobs (set-and-forget gain, not a
            performance control); FLT wears a double outer ring — the one
            knob whose sweep is bipolar LPF↔HPF. */}
        <Knob
          label="TRIM"
          min={0}
          max={1}
          defaultValue={0.5}
          value={channel.trim}
          onChange={(v) => mixer.setTrim(deck, v)}
          takeover={trimTakeover}
          ghost={auto && auto.trim !== undefined ? auto.trim : null}
          className="perf-knob-small"
        />
        {eqKnob('low', 'LOW')}
        {eqKnob('mid', 'MID')}
        {eqKnob('high', 'HI')}
        <Knob
          label="FLT"
          min={-1}
          max={1}
          defaultValue={0}
          value={channel.filter}
          onChange={(v) => mixer.setFilter(deck, v)}
          ghost={auto ? auto.filter : null}
          takeover={filterTakeover}
          className="perf-knob-filter"
        />
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
        ghost={auto ? auto.fader : null}
        takeover={faderTakeover}
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
        takeover={pitchTakeover}
      />
      <div className="perf-mix-foot">
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
          aria-label="Key Lock"
          title={
            keyLock
              ? 'Key Lock on: pitch changes keep the Track\u2019s Key (click for vinyl-style varispeed)'
              : 'Key Lock off: speed and pitch coupled, like vinyl (click to hold the Key)'
          }
        >
          <svg className="perf-keylock-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5 7 V5 a3 3 0 0 1 6 0 v2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <rect x="3.4" y="7" width="9.2" height="6.6" rx="1.2" fill="currentColor" />
          </svg>
        </button>
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
            // Library color coding (sneak fix 2026-07-10): same
            // circle-of-fifths hue as the track rows' key column.
            style={{ color: getKeyColor(formatKeyDisplay(track?.key)) ?? undefined }}
          >
            {/* Always rendered so the readout width never jumps; invisible
                until the key has drifted. */}
            <span className="perf-key-tilde" aria-hidden={!drifted}>
              ~
            </span>
            {formatKeyDisplay(track?.key)}
          </span>
        </span>
        <span className="perf-mix-spacer" />
        <span className="perf-readout" title="Effective BPM (base × pitch × bend)">
          <span
            className="perf-readout-val"
            style={{ color: getBpmColor(effective) ?? undefined }}
          >
            {effective !== null ? effective.toFixed(1) : '-'}
          </span>
          <span className="perf-readout-sub">
            {pitch >= 0 ? '+' : ''}
            {pitch.toFixed(1)}%
          </span>
        </span>
        {/* MATCH as an equals glyph: = matches the other deck's tempo;
            ≠ flashes red while the target is out of pitch-fader reach. */}
        <button
          className={`player-button perf-mini perf-match${hint ? ' perf-match-hint' : ''}`}
          disabled={!ready || !track?.bpm || !hasPlayingReference}
          onClick={onMatch}
          aria-label="Match tempo"
          title="Match the nearest playing Deck's tempo (half/double-aware)"
        >
          {hint ? '\u2260' : '='}
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
  const controlFocus = useControlFocus();
  const focused = controlFocus.left === deck || controlFocus.right === deck;
  const ready = useDeckReady();
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const loop = useDeckSnapshot((s) => s.loop);
  // Same advancing set as the full waveform (performance-hardening 01).
  const advancing = useDeckSnapshot(
    (s) => s.playing || s.pendingPlay || s.previewing || s.hotCuePreviewSlot !== null,
  );
  const track = useDeckTrack();
  // Per-gesture wake (#155): paused seeks repaint the minimap playhead on
  // the next frame instead of the 250ms idle poll.
  const subscribeWake = useCallback(
    (cb: () => void) => engine.addTransportEventListener(cb),
    [engine],
  );

  return (
    <section
      className={`perf-deckpanel deck-${deck.toLowerCase()}${mirrored ? ' mirrored' : ''}${
        focused ? ' focused' : ''
      }`}
      onPointerDownCapture={() => focusDeck(deck)}
    >
      <div className="perf-deck-minimap">
        <span className={`perf-decktag deck-${deck.toLowerCase()}`}>{deck}</span>
        {lockHint && <span className="perf-lock-hint">PLAYING — LOAD BLOCKED</span>}
        <div className="perf-minimap-wrap">
          <WaveformMinimap
            trackId={track?.id ?? null}
            clock={engine}
            cuePoint={cuePoint}
            loop={loop}
            onSeek={(t) => ready && engine.seek(t)}
            dimmed={track !== null && !ready}
            playing={advancing}
            subscribeWake={subscribeWake}
          />
          {/* Play guides at track scale (play-guides PRD): how far out is
              the press moment. Shows only while this Deck is outgoing. */}
          <PlayGuideMinimapMarks />
        </div>
      </div>
      <div className="perf-deck-band">
        <TrackZone track={track} />
        <PlayZone />
        <MixZone track={track} />
      </div>
    </section>
  );
}
