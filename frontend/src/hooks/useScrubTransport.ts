import { useMemo } from 'react';
import type { ScrubTransport } from '../components/WebGLWaveform';
import { useDeck, deckReadyNow } from './useDeck';

/**
 * The waveform's transport port for the scoped deck — the one
 * implementation behind every view's waveform (deck-controls PRD: the
 * duplicated ScrubTransport literals merged). Seek is ready-guarded:
 * scrubbing a loading deck is a no-op.
 */
export function useScrubTransport(): ScrubTransport {
  const { engine, loadedTrack } = useDeck();
  const trackId = loadedTrack?.id ?? null;
  return useMemo(
    () => ({
      isPlaying: () => engine.isAudioRunning(),
      pause: () => engine.pause(),
      play: () => engine.play(),
      seek: (t) => {
        if (deckReadyNow(engine, trackId)) engine.seek(t);
      },
    }),
    [engine, trackId]
  );
}
