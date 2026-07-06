import { useEffect } from 'react';
import { useBeatgridData } from './useBeatgridData';
import type { DeckEngine } from '../playback/DeckEngine';

/**
 * Keep a Deck's Quantize grid live (cue-quantize-bpm 01).
 *
 * The engine snapshots beat times at Load; every grid mutation (BPM
 * re-tempo, nudge, downbeat mark — ADR 0016) invalidates the
 * `['beatgrid', id]` query, so an active observer per loaded Deck both
 * forces the refetch (whatever surface made the edit) and pushes the
 * re-spaced beats into the engine. Fetch failures push nothing — the
 * engine keeps its load-time grid rather than going gridless on a blip.
 */
export function useDeckBeatgridSync(engine: DeckEngine, trackId: number | null): void {
  const { data } = useBeatgridData(trackId);
  useEffect(() => {
    if (trackId === null || data === undefined) return;
    engine.setBeatTimes(trackId, data.data.beat_times);
  }, [engine, trackId, data]);
}
