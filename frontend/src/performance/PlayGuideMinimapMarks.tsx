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
import './PlayGuideOverlay.css';

export function PlayGuideMinimapMarks() {
  const { deck } = useDeck();
  const duration = useDeckSnapshot((s) => s.duration);
  const frames = usePlayGuides();
  // This Deck's minimap carries the direction it is the OUTGOING side of
  // (at most one frame per outgoing Deck).
  const frame = frames.find((f) => f.outgoing === deck);
  if (!frame || duration <= 0) return null;

  const guides = frame.guides.filter((g) => g.aTime >= 0 && g.aTime <= duration);
  // Exactly one emphasized guide: the earliest non-missed (guides are not
  // guaranteed sorted by aTime).
  let nextUuid: string | null = null;
  let nextATime = Infinity;
  for (const g of guides) {
    if (!g.missed && g.aTime < nextATime) {
      nextATime = g.aTime;
      nextUuid = g.uuid;
    }
  }

  return (
    <div className="perf-minimap-guides" aria-hidden>
      {guides.map((g) => (
        <div
          key={g.uuid}
          className={`perf-minimap-guide incoming-${frame.incoming.toLowerCase()}${
            g.missed ? ' missed' : g.uuid === nextUuid ? ' next' : ''
          }`}
          style={{ left: `${(g.aTime / duration) * 100}%` }}
          title={g.name}
        />
      ))}
    </div>
  );
}
