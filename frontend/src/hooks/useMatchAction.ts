import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeck, useDecks } from './useDeck';
import { bpmMatch, effectiveBpm, nearestPlayingTempoReference } from '../playback/tempo';
import type { BpmMatchResult } from '../playback/tempo';
import type { Track } from '../types';

/**
 * One-shot BPM match for the scoped Deck against the nearest other playing
 * Deck — the single
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
    const freshBpm = (track: Track | null): number | null =>
      track
        ? (queryClient.getQueryData<Track>(['track', track.id])?.bpm ?? track.bpm ?? null)
        : null;

    const ownBpm = freshBpm(loadedTrack);
    if (!ownBpm) return null;

    const reference = nearestPlayingTempoReference(
      deck,
      effectiveBpm(ownBpm, engine.getSnapshot().pitchPercent),
      {
        A: {
          playing: decks.A.engine.getSnapshot().playing,
          bpm: freshBpm(decks.A.loadedTrack),
          pitchPercent: decks.A.engine.getSnapshot().pitchPercent,
        },
        B: {
          playing: decks.B.engine.getSnapshot().playing,
          bpm: freshBpm(decks.B.loadedTrack),
          pitchPercent: decks.B.engine.getSnapshot().pitchPercent,
        },
        C: {
          playing: decks.C.engine.getSnapshot().playing,
          bpm: freshBpm(decks.C.loadedTrack),
          pitchPercent: decks.C.engine.getSnapshot().pitchPercent,
        },
        D: {
          playing: decks.D.engine.getSnapshot().playing,
          bpm: freshBpm(decks.D.loadedTrack),
          pitchPercent: decks.D.engine.getSnapshot().pitchPercent,
        },
      }
    );
    if (!reference) return null;
    const result = bpmMatch(ownBpm, reference.effectiveBpm);
    if (result.kind === 'match') engine.setPitch(result.pitchPercent);
    return result;
  }, [deck, decks, engine, loadedTrack, queryClient]);
}
