import type { ReactNode } from 'react';
import { useAtCuePoint } from '../../hooks/useAtCuePoint';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import { cueButtonState, playButtonState } from './transportButtonState';

/**
 * PLAY + hold-CUE for the scoped deck — the one transport implementation
 * shared by the library Player and the Performance DeckPanel (deck-controls
 * PRD, playback class). Returns a fragment: callers own the container.
 *
 * - CUE is a hold: pointer capture keeps the release even if the pointer
 *   leaves the button; at-cue/away-from-cue styling comes from a coarse
 *   playhead poll (setState only on flips — steady playback re-renders
 *   nothing).
 * - PLAY latches while loading: the engine stores the intent and starts
 *   when decoding finishes, so the button never disables during a load
 *   (keyboard parity).
 * - Screen state is deliberately static (four-deck 35): Controller lamps
 *   retain issue 31's CDJ flashing, but persistent motion in the UI is
 *   distracting. Fill/outline state carries the same actionable distinctions.
 */
export function TransportPair({
  cueKbd,
  playKbd,
  cueTitle = 'Cue',
}: {
  /** On-control keyboard hint slots (Performance view). */
  cueKbd?: ReactNode;
  playKbd?: ReactNode;
  cueTitle?: string;
}) {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const previewing = useDeckSnapshot((s) => s.previewing);
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const playing = useDeckSnapshot((s) => s.playing);
  const pendingPlay = useDeckSnapshot((s) => s.pendingPlay);
  // Play can be pressed while loading — the engine latches the intent.
  const canPlay = useDeckSnapshot(
    (s) =>
      s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding'
  );
  // At-cue styling: the shared coarse poll (hooks/useAtCuePoint).
  const atCuePoint = useAtCuePoint();

  const loaded = loadedTrack != null;
  const cueState = cueButtonState({
    previewing,
    playing,
    loaded,
    hasCuePoint: cuePoint !== null,
    atCuePoint,
  });
  const playState = playButtonState(playing, pendingPlay);

  return (
    <>
      <button
        onPointerDown={(e) => {
          if (!ready) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          engine.cueDown();
        }}
        onPointerUp={() => ready && engine.cueUp()}
        onPointerCancel={() => ready && engine.cueUp()}
        disabled={!ready}
        className={`player-button player-button-cue ${
          cueState === 'held'
            ? 'player-button-cue-held'
            : cueState === 'available'
            ? 'player-button-cue-at-cue'
            : ''
        }`}
        title={cueTitle}
      >
        CUE
        {cueKbd}
      </button>

      <button
        onClick={() => engine.togglePlay()}
        disabled={!canPlay}
        className={`player-button ${
          playState === 'playing' ? 'player-button-playing' : 'player-button-paused'
        }`}
        title={pendingPlay ? 'Will play when loaded' : playing ? 'Pause' : 'Play'}
      >
        ⏯{playKbd}
      </button>
    </>
  );
}
