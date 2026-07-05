import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeck, useDecks } from './useDeck';
import { bpmMatch } from '../playback/tempo';
import type { BpmMatchResult } from '../playback/tempo';
import type { Track } from '../types';

/**
 * One-shot BPM match for the scoped deck against the other deck — the single
 * implementation behind the on-screen MATCH button and the hardware SYNC
 * button (midi-controller 04). Applies the pitch on success and returns the
 * result so callers can render feedback (the on-screen button shows an
 * out-of-reach hint; hardware has no feedback channel and ignores it).
 *
 * Either deck's BPM may have been edited since its load — prefer the fresh
 * track from the query cache (kept warm by its own panel).
 */
export function useMatchAction(): () => BpmMatchResult | null {
  const { deck, engine, loadedTrack } = useDeck();
  const decks = useDecks();
  const queryClient = useQueryClient();

  return useCallback(() => {
    const other = decks[deck === 'A' ? 'B' : 'A'];
    const freshBpm = (track: Track | null): number | null =>
      track
        ? (queryClient.getQueryData<Track>(['track', track.id])?.bpm ?? track.bpm ?? null)
        : null;

    const ownBpm = freshBpm(loadedTrack);
    const otherBpm = freshBpm(other.loadedTrack);
    if (!ownBpm || otherBpm === null) return null;

    const otherEffective = otherBpm * (1 + other.engine.getSnapshot().pitchPercent / 100);
    const result = bpmMatch(ownBpm, otherEffective);
    if (result.kind === 'match') engine.setPitch(result.pitchPercent);
    return result;
  }, [deck, decks, engine, loadedTrack, queryClient]);
}
