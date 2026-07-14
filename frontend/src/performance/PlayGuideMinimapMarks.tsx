/**
 * Play guide minimap marks (play-guides PRD): the reach view — is the
 * press moment thirty seconds or three minutes out? One mark per guide on
 * the PLAYING Deck's minimap, at aTime over the full track extent. Static
 * x (aTime moves only when the paused Deck re-cues or Transitions change),
 * so plain React rendering suffices — no rAF (usePlayGuides republishes
 * when a guide's missed flag flips, which moves the emphasis). Deck-blind:
 * renders inside a DeckScope and shows only when its Deck is the outgoing
 * side.
 *
 * Zoned marks (minimap-clarity verdict): full-height bar + ▶ play arrow
 * at mid-height — the guides' identity zone (hotcue flags own the top,
 * the main-cue triangle owns the bottom). The NEXT guide (earliest
 * non-missed) is emphasized: wider bar, larger arrow, full opacity.
 */
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { usePlayGuides } from './usePlayGuides';
import { minimapGuidesForDeck } from './playGuideMinimapModel';
import './PlayGuideOverlay.css';

export function PlayGuideMinimapMarks() {
  const { deck } = useDeck();
  const duration = useDeckSnapshot((s) => s.duration);
  const frames = usePlayGuides();
  // One outgoing Deck may guide several paused Decks. Merge every frame
  // rather than keeping only the first pair (the old A/B assumption).
  const guides = minimapGuidesForDeck(frames, deck, duration);
  if (guides.length === 0) return null;

  return (
    <div className="perf-minimap-guides" aria-hidden>
      {guides.map(({ key, incoming, guide, next }) => {
        return (
        <div
          key={key}
          className={`perf-minimap-guide incoming-${incoming.toLowerCase()}${
            guide.missed ? ' missed' : next ? ' next' : ''
          }`}
          style={{ left: `${(guide.aTime / duration) * 100}%` }}
          title={`${deck}→${incoming}: ${guide.name}`}
        />
        );
      })}
    </div>
  );
}
