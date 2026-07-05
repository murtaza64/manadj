import type { ReactNode } from 'react';
import { useAtCuePoint } from '../../hooks/useAtCuePoint';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';

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
  const { engine } = useDeck();
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

  const flashing =
    !previewing && !playing && cuePoint !== null && !atCuePoint;

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
          previewing
            ? 'player-button-cue-held'
            : !playing && cuePoint !== null
            ? atCuePoint
              ? 'player-button-cue-at-cue'
              : 'player-button-cue-away-from-cue'
            : ''
        }`}
        // Phase-lock the 1s cue flash to the document timeline: the
        // animation starts when the class lands (any moment), so two decks
        // would flash out of phase — a negative delay of (now mod period)
        // re-anchors every instance to the same global epoch. Set via ref
        // (commit phase): render must stay pure.
        ref={(el) => {
          if (!el) return;
          el.style.animationDelay = flashing
            ? `-${(performance.now() % 1000).toFixed(0)}ms`
            : '';
        }}
        title={cueTitle}
      >
        CUE
        {cueKbd}
      </button>

      <button
        onClick={() => engine.togglePlay()}
        disabled={!canPlay}
        className={`player-button ${
          playing || pendingPlay ? 'player-button-playing' : 'player-button-paused'
        }`}
        title={pendingPlay ? 'Will play when loaded' : playing ? 'Pause' : 'Play'}
      >
        ⏯{playKbd}
      </button>
    </>
  );
}
