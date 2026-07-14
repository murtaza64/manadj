import { useDeck, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import './deckControls.css';

/** Paused-only memory-cue-style walk over track start and Hot Cues. */
export function CueWalkButtons() {
  const { loadedTrack } = useDeck();
  const actions = useHotCueActions(loadedTrack?.id ?? null);
  const playing = useDeckSnapshot((state) => state.playing);
  const disabled = !actions.enabled || playing;

  return (
    <div className="deck-cuewalk">
      <button
        className="player-button"
        disabled={disabled}
        onClick={() => actions.walk?.('prev')}
        title="Previous Hot Cue or track start; also moves Cue"
      >
        Cue ◀
      </button>
      <button
        className="player-button"
        disabled={disabled}
        onClick={() => actions.walk?.('next')}
        title="Next Hot Cue; also moves Cue"
      >
        Cue ▶
      </button>
    </div>
  );
}
