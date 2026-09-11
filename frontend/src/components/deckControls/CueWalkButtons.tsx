import { useDeck, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import './deckControls.css';

/** One paused-only memory-cue-style walk button (prev/next over track
 * start and Hot Cues; the walk also moves the Deck's Cue). Exported
 * singly so the library Player can flank the hot-cue panel with them. */
export function CueWalkButton({
  direction,
  className,
  kbd,
}: {
  direction: 'prev' | 'next';
  className?: string;
  kbd?: ReactNode;
}) {
  const { loadedTrack } = useDeck();
  const actions = useHotCueActions(loadedTrack?.id ?? null);
  const playing = useDeckSnapshot((state) => state.playing);
  const disabled = !actions.enabled || playing;

  return (
    <button
      className={`player-button${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={() => actions.walk?.(direction)}
      title={
        direction === 'prev'
          ? 'Previous Hot Cue or track start; also moves Cue'
          : 'Next Hot Cue; also moves Cue'
      }
    >
      {direction === 'prev' ? '|◀' : '▶|'}
      {kbd}
    </button>
  );
}

/** The side-by-side pair (Performance transport column). */
export function CueWalkButtons({ prevKbd, nextKbd }: { prevKbd?: ReactNode; nextKbd?: ReactNode }) {
  return (
    <div className="deck-cuewalk">
      <CueWalkButton direction="prev" kbd={prevKbd} />
      <CueWalkButton direction="next" kbd={nextKbd} />
    </div>
  );
}
import type { ReactNode } from 'react';
