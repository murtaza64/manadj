import { useMemo } from 'react';
import type { ScrubTransport } from '../components/WebGLWaveform';
import { useDeck, useDeckReady } from './useDeck';

/**
 * The waveform's transport port for the scoped deck — the one
 * implementation behind every view's waveform (deck-controls PRD: the
 * duplicated ScrubTransport literals merged). Seek is ready-guarded:
 * scrubbing a loading deck is a no-op.
 */
export function useScrubTransport(): ScrubTransport {
  const { engine } = useDeck();
  const ready = useDeckReady();
  return useMemo(
    () => ({
      isPlaying: () => engine.isAudioRunning(),
      pause: () => engine.pause(),
      play: () => engine.play(),
      seek: (t) => {
        if (ready) engine.seek(t);
      },
    }),
    [engine, ready]
  );
}
