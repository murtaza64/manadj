import { useEffect, useState } from 'react';
import { useDeck } from './useDeck';

/**
 * True while the scoped deck's playhead sits at its cue point. Polled
 * coarsely (the snapshot carries no playhead), but setState only on
 * boolean flips so steady playback re-renders nothing. The single at-cue
 * predicate shared by the on-screen CUE button (TransportPair) and the
 * MIDI feedback bridge, so screen and hardware cannot drift.
 */
export function useAtCuePoint(): boolean {
  const { engine } = useDeck();
  const [atCuePoint, setAtCuePoint] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const s = engine.getSnapshot();
      const next =
        s.cuePoint !== null && Math.abs(engine.getPlayhead() - s.cuePoint) < 0.1;
      setAtCuePoint((prev) => (prev === next ? prev : next));
    }, 100);
    return () => clearInterval(interval);
  }, [engine]);
  return atCuePoint;
}
