import { useEffect } from 'react';
import type { DeckEngine } from '../playback/DeckEngine';

const SCRUB_RATE = 0.6; // seconds of track per wall-clock second

/**
 * Continuous scrub while a direction is held: -1 (backward), 0 (off),
 * 1 (forward). Seeks the engine every animation frame. Shared by the
 * library keyboard hub and the Practice view.
 */
export function useScrubLoop(engine: DeckEngine, direction: number): void {
  useEffect(() => {
    if (direction === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      engine.seek(engine.getPlayhead() + direction * SCRUB_RATE * dt);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [direction, engine]);
}
