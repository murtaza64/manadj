/**
 * Transition-editor deck card: track identity, base BPM (editable,
 * persisted) with tempo-matched effective BPM and pitch %, key, mute,
 * beatgrid tweaking, and the hot cue / beat jump gesture row (slide on
 * deck B, transport jump on deck A).
 *
 * Control classes (deck-controls PRD): BPM + grid rows are shared
 * CURATION components; the gesture row keeps the shared visual language
 * and carries the ALIGNMENT ACCENT wherever a control realigns the pair
 * (Alignment nudge on both cards; slides + lock on B). Deck A's gesture
 * row is plain — its gestures are transport (playback class).
 */
import HotCue from '../components/HotCue';
import { BpmControl } from '../components/deckControls/BpmControl';
import { SpeedIcon } from '../components/icons';
import { JumpBackIcon, JumpForwardIcon } from '../components/icons/JumpIcons';
import { LockIcon } from '../components/icons/LockIcon';
import { MuteIcon } from '../components/icons/MuteIcon';
import { useDecks } from '../hooks/useDeck';
import { useHotCueSlots } from '../hooks/useHotCueActions';
import { doubleBeatjump, halveBeatjump } from '../playback/beatjump';
import { formatKeyDisplay } from '../utils/keyUtils';
import { MixPlayer } from './MixPlayer';
import type { Track } from '../types';

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

export function DeckCard({
  deck,
  track,
  player,
  loadState,
  effectiveBpm,
  pitchPercent,
  onBpmSaved,
  onAlignmentNudge,
  gestures,
  lock,
}: {
  deck: 'A' | 'B';
  track: Track | null;
  player: MixPlayer;
  loadState: string;
  /** BPM after tempo match (differs from base only on the matched deck). */
  effectiveBpm: number | null;
  pitchPercent: number;
  onBpmSaved: (bpm: number) => void;
  /** Alignment nudge (glossary): realign the pair ±deltaSec. */
  onAlignmentNudge: (deltaSec: number) => void;
  /** Hot cue / beat jump row (issues 11–12). Two semantics, one idiom:
   * B = 'slide' (realign the pair; playhead stays put), A = 'jump' (plain
   * transport — A's track time ≡ mix time, so jumping A jumps the mix). */
  gestures?: {
    kind: 'slide' | 'jump';
    toCue: (cueSec: number) => void;
    beats: (n: number) => void;
    enabled: boolean;
  };
  /** Locked-window toggle (B card only — the lock scopes to B gestures). */
  lock?: { on: boolean; toggle: () => void };
}) {
  // Gesture size = the deck's beatjump size (ONE per-deck number across
  // modes — deck-controls 04/05; adjust it here or in the Performance
  // view, it's the same N).
  const deckScope = useDecks()[deck];
  const gestureBeats = deckScope.beatjumpBeats;
  const setGestureBeats = deckScope.setBeatjumpBeats;

  // Hot-cue curation (set-empty / delete) is the shared implementation;
  // the TRIGGER is this card's gesture (slide B / jump A) — tap, no hold.
  const cueActions = useHotCueSlots(track?.id ?? null, {
    enabled: track !== null,
    getPlayhead: () => player.getTrackTime(deck),
    trigger: (_slot, timeSeconds) => gestures?.toCue(timeSeconds),
  });

  if (!track) {
    return (
      <div className={`editor-deckcard ${deck.toLowerCase()}`}>
        <div className="editor-deckcard-head">
          <span className={`editor-decklabel ${deck.toLowerCase()}`}>{deck}</span>
          <span className="editor-tweaktitle">no track — select below and load</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`editor-deckcard ${deck.toLowerCase()}`}>
      <div className="editor-deckcard-head">
        <span className={`editor-decklabel ${deck.toLowerCase()}`}>{deck}</span>
        <span className="editor-tweaktitle" title={track.title || track.filename}>
          {track.title || track.filename}
        </span>
        <span className="editor-deckcard-artist">{track.artist || '—'}</span>
      </div>
      <div className="editor-deckcard-row">
        <span
          className="editor-bpm-base"
          title="Tempo / beatgrid (base BPM — edits persist; ADR 0016)"
        >
          <SpeedIcon width={14} height={14} />
        </span>
        <BpmControl
          track={track}
          dense
          onCommitted={(bpm) => {
            player.setBpm(deck, bpm);
            // Editor loads mirror onto the shared decks (issue 07): keep
            // the shared engine's beat-jump math honest too.
            if (deckScope.loadedTrack?.id === track.id) {
              deckScope.engine.setTrackBpm(bpm);
            }
            onBpmSaved(bpm);
          }}
          grid={{ getPlayhead: () => player.getTrackTime(deck) }}
        />
        <span className="editor-bpm-eff" title="Effective BPM during the mix (after tempo match)">
          » {effectiveBpm !== null ? effectiveBpm.toFixed(1) : '—'}
          {Math.abs(pitchPercent) > 0.05 && (
            <em>
              {' '}
              ({pitchPercent > 0 ? '+' : ''}
              {pitchPercent.toFixed(1)}%)
            </em>
          )}
        </span>
        <span className="editor-deckcard-key">{formatKeyDisplay(track.key)}</span>
        <button
          className={`editor-mutebtn${player.isMuted(deck) ? ' on' : ''}`}
          aria-pressed={player.isMuted(deck)}
          title={`Mute deck ${deck} (overrides the fader lane)`}
          onClick={() => player.setMuted(deck, !player.isMuted(deck))}
        >
          <MuteIcon muted={player.isMuted(deck)} />
        </button>
        <span className="editor-tweaktitle">{loadState !== 'ready' ? loadState : ''}</span>
      </div>
      <div className="editor-deckcard-row">
        {/* Alignment nudge (accented — realigns the pair): plain ◀/▶ +
            accent, per the PRD icon language (every other pair carries a
            specific icon, so this combination is unambiguous). The grid
            cluster lives with BPM above (one domain — ADR 0016). */}
        <span
          className="editor-pair editor-alignment"
          title={`Alignment nudge: move ${deck} ±10ms relative to the other track (edits the sketch, not the grid)`}
        >
          <span className="editor-pair-label">align</span>
          <button title={`Nudge ${deck} 10ms earlier`} onClick={() => onAlignmentNudge(-0.01)}>
            ◀
          </button>
          <button title={`Nudge ${deck} 10ms later`} onClick={() => onAlignmentNudge(0.01)}>
            ▶
          </button>
        </span>
      </div>
      {gestures && (
        <div
          className={`editor-deckcard-row editor-slides${
            gestures.kind === 'slide' ? ' editor-alignment' : ''
          }`}
        >
          <span
            className="editor-pair"
            title={
              gestures.kind === 'slide'
                ? 'Slides realign the pair: this deck re-cues, the playhead and the other deck stay put'
                : 'Transport: moves the playhead — both decks follow, alignment untouched'
            }
          >
            <span className="editor-pair-label">{gestures.kind}</span>
            <button
              disabled={!gestures.enabled}
              title={
                gestures.kind === 'slide'
                  ? `Slide ${deck} ${gestureBeats} of its beats earlier`
                  : `Jump the playhead ${gestureBeats} of ${deck}'s beats back`
              }
              onClick={() => gestures.beats(-gestureBeats)}
            >
              <JumpBackIcon />
            </button>
            <button title="Halve size" onClick={() => setGestureBeats(halveBeatjump(gestureBeats))}>
              1/2
            </button>
            <span className="editor-slidesize" title={`Size (${deck}'s beats — shared with the deck's beatjump)`}>
              {gestureBeats}
            </span>
            <button title="Double size" onClick={() => setGestureBeats(doubleBeatjump(gestureBeats))}>
              x2
            </button>
            <button
              disabled={!gestures.enabled}
              title={
                gestures.kind === 'slide'
                  ? `Slide ${deck} ${gestureBeats} of its beats later`
                  : `Jump the playhead ${gestureBeats} of ${deck}'s beats forward`
              }
              onClick={() => gestures.beats(gestureBeats)}
            >
              <JumpForwardIcon />
            </button>
          </span>
          {lock && (
            <button
              className={`editor-lockbtn${lock.on ? ' on' : ''}`}
              aria-pressed={lock.on}
              title="Locked window: slides carry the window WITH this track (same audio stays under it); unlocked, the window stays with the other track"
              onClick={lock.toggle}
            >
              <LockIcon locked={lock.on} />
            </button>
          )}
          {/* All 8 slots, shared pad surface + curation (set-empty at this
              deck's playhead, right-click deletes); pressing a SET pad is
              this card's gesture (slide/jump). Two-row 4×2 stack (1-4 over
              5-8, left-to-right) so the row fits the card width. */}
          <span className="editor-cuegrid">
            {SLOTS.map((slot) => (
              <HotCue
                key={slot}
                slotNumber={slot}
                hotCue={cueActions.bySlot.get(slot)}
                disabled={!cueActions.enabled}
                isPreviewing={false}
                onDown={cueActions.down}
                onUp={cueActions.up}
                onDelete={cueActions.remove}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
