/**
 * Play guide minimap marks (play-guides PRD): the reach view — is the
 * press moment thirty seconds or three minutes out? One tick per guide on
 * the PLAYING Deck's minimap, at aTime over the full track extent. Static
 * x (aTime moves only when the paused Deck re-cues or Transitions change),
 * so plain React rendering suffices — no rAF. Deck-blind: renders inside
 * a DeckScope and shows only when its Deck is the outgoing side.
 */
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { usePlayGuides } from './usePlayGuides';
import './PlayGuideOverlay.css';

export function PlayGuideMinimapMarks() {
  const { deck } = useDeck();
  const duration = useDeckSnapshot((s) => s.duration);
  const frames = usePlayGuides();
  // This Deck's minimap carries the direction it is the OUTGOING side of
  // (at most one frame per outgoing Deck).
  const frame = frames.find((f) => f.outgoing === deck);
  if (!frame || duration <= 0) return null;

  return (
    <div className="perf-minimap-guides" aria-hidden>
      {frame.guides
        .filter((g) => g.aTime >= 0 && g.aTime <= duration)
        .map((g) => (
          <div
            key={g.uuid}
            className={`perf-minimap-guide incoming-${frame.incoming.toLowerCase()}${
              g.missed ? ' missed' : ''
            }`}
            style={{ left: `${(g.aTime / duration) * 100}%` }}
            title={g.name}
          />
        ))}
    </div>
  );
}
