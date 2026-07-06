import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { DeckEngine } from '../playback/DeckEngine';
import type { Track } from '../types';

/**
 * Keep a Deck's beat-jump tempo live (cue-quantize-bpm 02) — the scalar
 * sibling of useDeckBeatgridSync.
 *
 * The engine snapshots `bpm` at Load and `jumpBeats` sizes jumps from it.
 * Per-surface `setTrackBpm` wiring (BpmControl onCommitted) missed whole
 * edit classes — TagEditor Analyze, sync-view imports, an edit while the
 * track is loaded on the OTHER deck. One active `['track', id]` observer
 * per loaded Deck closes them all: any path that invalidates the track row
 * refetches here and pushes the fresh tempo into the engine.
 */
export function useDeckBpmSync(engine: DeckEngine, trackId: number | null): void {
  const { data } = useQuery<Track>({
    queryKey: ['track', trackId],
    queryFn: () => api.tracks.getById(trackId!),
    enabled: trackId !== null,
    staleTime: 60_000, // matches useDeckTrack; invalidation still refetches
  });
  useEffect(() => {
    if (trackId === null || data === undefined) return;
    engine.setTrackBpm(trackId, data.bpm ?? null);
  }, [engine, trackId, data]);
}
