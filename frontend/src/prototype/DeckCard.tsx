/**
 * Transition-editor deck card: track identity, base BPM (editable,
 * persisted) with tempo-matched effective BPM and pitch %, key, mute,
 * beatgrid tweaking, and the hot cue / beat jump gesture row (slide on
 * deck B, transport jump on deck A).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useNudgeBeatgrid, useSetBeatgridDownbeat } from '../hooks/useBeatgridData';
import { useDeleteHotCue, useHotCues, useSetHotCue } from '../hooks/useHotCues';
import {
  PERFORMANCE_BEATJUMP_DEFAULT,
  doubleBeatjump,
  halveBeatjump,
} from '../playback/beatjump';
import { formatKeyDisplay } from '../utils/keyUtils';
import { MixProtoPlayer } from './MixProtoPlayer';
import type { Track } from '../types';

/**
 * Per-deck card (left/right of the transition center): track identity, base
 * BPM (editable, persisted) with tempo-matched effective BPM and pitch %,
 * key, and beatgrid tweaking.
 */
export function DeckCard({
  deck,
  track,
  player,
  loadState,
  effectiveBpm,
  pitchPercent,
  onBpmSaved,
  onNudgeTrack,
  gestures,
  lock,
}: {
  deck: 'A' | 'B';
  track: Track | null;
  player: MixProtoPlayer;
  loadState: string;
  /** BPM after tempo match (differs from base only on the matched deck). */
  effectiveBpm: number | null;
  pitchPercent: number;
  onBpmSaved: (bpm: number) => void;
  /** Fine alignment: move this track ±deltaSec relative to the other. */
  onNudgeTrack: (deltaSec: number) => void;
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
  const queryClient = useQueryClient();
  const nudge = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();
  const { data: hotCues = [] } = useHotCues(track?.id ?? null);
  const setHotCue = useSetHotCue();
  const deleteHotCue = useDeleteHotCue();
  /** Gesture size in this deck's own beats (Performance beatjump idiom). */
  const [gestureBeats, setGestureBeats] = useState(PERFORMANCE_BEATJUMP_DEFAULT);
  const [bpmDraft, setBpmDraft] = useState('');
  // Reset the draft when the track (or its saved BPM) changes.
  const [draftKey, setDraftKey] = useState('');
  const key = `${track?.id ?? 'none'}-${track?.bpm ?? 0}`;
  if (key !== draftKey) {
    setDraftKey(key);
    setBpmDraft(track?.bpm ? track.bpm.toFixed(2) : '');
  }

  if (!track) {
    return (
      <div className={`mixproto-deckcard ${deck.toLowerCase()}`}>
        <div className="mixproto-deckcard-head">
          <span className={`mixproto-decklabel ${deck.toLowerCase()}`}>{deck}</span>
          <span className="mixproto-tweaktitle">no track — select below and load</span>
        </div>
      </div>
    );
  }

  const commitBpm = async () => {
    const bpm = Number(bpmDraft);
    if (!bpm || bpm <= 0 || bpm === track.bpm) return;
    await api.tracks.update(track.id, { bpm });
    await api.beatgrids.delete(track.id);
    await api.beatgrids.get(track.id);
    queryClient.invalidateQueries({ queryKey: ['beatgrid', track.id] });
    player.setBpm(deck, bpm);
    onBpmSaved(bpm);
  };

  return (
    <div className={`mixproto-deckcard ${deck.toLowerCase()}`}>
      <div className="mixproto-deckcard-head">
        <span className={`mixproto-decklabel ${deck.toLowerCase()}`}>{deck}</span>
        <span className="mixproto-tweaktitle" title={track.title || track.filename}>
          {track.title || track.filename}
        </span>
        <span className="mixproto-deckcard-artist">{track.artist || '—'}</span>
      </div>
      <div className="mixproto-deckcard-row">
        <label title="Base BPM (the track's real tempo — edits persist)">
          BPM
          <input
            className="mixproto-bpm-base"
            type="number"
            step={0.01}
            min={1}
            value={bpmDraft}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={() => void commitBpm()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <span className="mixproto-bpm-eff" title="Effective BPM during the mix (after tempo match)">
          » {effectiveBpm !== null ? effectiveBpm.toFixed(1) : '—'}
          {Math.abs(pitchPercent) > 0.05 && (
            <em>
              {' '}
              ({pitchPercent > 0 ? '+' : ''}
              {pitchPercent.toFixed(1)}%)
            </em>
          )}
        </span>
        <span className="mixproto-deckcard-key">{formatKeyDisplay(track.key)}</span>
        <button
          className={`mixproto-mutebtn${player.isMuted(deck) ? ' on' : ''}`}
          aria-pressed={player.isMuted(deck)}
          title={`Mute deck ${deck} (overrides the fader lane)`}
          onClick={() => player.setMuted(deck, !player.isMuted(deck))}
        >
          mute
        </button>
        <span className="mixproto-tweaktitle">{loadState !== 'ready' ? loadState : ''}</span>
      </div>
      <div className="mixproto-deckcard-row">
        {/* Segmented pairs (issue 19): label + ◀ + ▶ share one border and
            read as a single control; the step lives in the tooltip. */}
        <span className="mixproto-pair" title={`Nudge ${deck} ±10ms relative to the other track`}>
          <span className="mixproto-pair-label">track</span>
          <button title={`Nudge ${deck} 10ms earlier`} onClick={() => onNudgeTrack(-0.01)}>
            ◀
          </button>
          <button title={`Nudge ${deck} 10ms later`} onClick={() => onNudgeTrack(0.01)}>
            ▶
          </button>
        </span>
        <span className="mixproto-pair" title="Nudge beatgrid ±10ms (persists to the track)">
          <span className="mixproto-pair-label">grid</span>
          <button
            title="Nudge beatgrid 10ms earlier"
            onClick={() => nudge.mutate({ trackId: track.id, offsetMs: -10 })}
          >
            ◀
          </button>
          <button
            title="Nudge beatgrid 10ms later"
            onClick={() => nudge.mutate({ trackId: track.id, offsetMs: 10 })}
          >
            ▶
          </button>
        </span>
        <button
          className="mixproto-action"
          title="Set downbeat at this deck's playhead"
          onClick={() =>
            setDownbeat.mutate({ trackId: track.id, downbeatTime: player.getTrackTime(deck) })
          }
        >
          downbeat @ playhead
        </button>
      </div>
      {gestures && (
        <div className="mixproto-deckcard-row mixproto-slides">
          <span
            className="mixproto-pair"
            title={
              gestures.kind === 'slide'
                ? 'Slides realign the pair: this deck re-cues, the playhead and the other deck stay put'
                : 'Transport: moves the playhead — both decks follow, alignment untouched'
            }
          >
            <span className="mixproto-pair-label">{gestures.kind}</span>
            <button
              disabled={!gestures.enabled}
              title={
                gestures.kind === 'slide'
                  ? `Slide ${deck} ${gestureBeats} of its beats earlier`
                  : `Jump the playhead ${gestureBeats} of ${deck}'s beats back`
              }
              onClick={() => gestures.beats(-gestureBeats)}
            >
              ◄◄
            </button>
            <button title="Halve size" onClick={() => setGestureBeats(halveBeatjump(gestureBeats))}>
              −
            </button>
            <span className="mixproto-slidesize" title={`Size (${deck}'s beats)`}>
              {gestureBeats}
            </span>
            <button title="Double size" onClick={() => setGestureBeats(doubleBeatjump(gestureBeats))}>
              +
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
              ►►
            </button>
          </span>
          {lock && (
            <button
              className={`mixproto-lockbtn${lock.on ? ' on' : ''}`}
              aria-pressed={lock.on}
              title="Locked window: slides carry the window WITH this track (same audio stays under it); unlocked, the window stays with the other track"
              onClick={lock.toggle}
            >
              lock
            </button>
          )}
          {/* All 8 slots, Performance pad semantics: set cues act (slide/
              jump), empty ones SET at this deck's playhead; right-click
              deletes. Always reads 1-8 left-to-right (B un-mirrored). */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => {
            const cue = hotCues.find((c) => c.slot_number === slot);
            if (!cue) {
              return (
                <button
                  key={slot}
                  className="mixproto-cueslide unset"
                  title={`Set cue ${slot} at ${deck}'s playhead`}
                  onClick={() =>
                    setHotCue.mutate({
                      trackId: track.id,
                      slotNumber: slot,
                      data: { time_seconds: player.getTrackTime(deck) },
                    })
                  }
                >
                  {slot}
                </button>
              );
            }
            const color = cue.color || '#39ff14';
            return (
              <button
                key={slot}
                className="mixproto-cueslide"
                style={{ borderColor: color, color }}
                title={
                  (gestures.kind === 'slide'
                    ? `Slide so cue ${slot} lands under the playhead`
                    : `Jump the playhead to cue ${slot}`) + ' — right-click to delete'
                }
                onClick={() => gestures.toCue(cue.time_seconds)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  deleteHotCue.mutate({ trackId: track.id, slotNumber: slot });
                }}
              >
                {slot}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
