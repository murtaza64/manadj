import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AnalysisPendingItem } from '../types';

/** Poll cadence while analyses are in flight — completions land in rows
 * within one of these. */
export const ANALYSIS_PENDING_ACTIVE_POLL_MS = 3000;
/** Idle cadence — the cheap heartbeat that notices a NEW background
 * analysis starting (an import landing while the app sits open). */
export const ANALYSIS_PENDING_IDLE_POLL_MS = 15000;

/** Adaptive interval (the Acquisition download-poll pattern). Exported for
 * tests. */
export function analysisPendingPollMs(
  items: AnalysisPendingItem[] | undefined
): number {
  return items && items.length > 0
    ? ANALYSIS_PENDING_ACTIVE_POLL_MS
    : ANALYSIS_PENDING_IDLE_POLL_MS;
}

const QUERY_KEY = ['analysis-pending'] as const;

/**
 * The one poller of GET /api/analyze/pending (analysis-curation 03) —
 * mount exactly once, above the view switch. Background analysis
 * completion writes only the DB (no push), so the library's rows and any
 * per-track caches go stale until something refetches; this hook diffs
 * successive pending sets and, for every Track whose analysis just
 * finished, invalidates its row/detail/grid/diagnostics caches.
 *
 * Deliberately additive to ADR 0029's deck-scoped arrival polling: that
 * path feeds loaded Decks (grid + cue re-park via setBeatTimes); this one
 * feeds everything else (library table, TagEditor's Analyze button).
 */
export function useAnalysisPendingSync(): void {
  const queryClient = useQueryClient();
  const { data } = useQuery<AnalysisPendingItem[]>({
    queryKey: QUERY_KEY,
    queryFn: api.analyze.pending,
    refetchInterval: (query) => analysisPendingPollMs(query.state.data),
  });

  // Tracks seen in flight and not yet observed leaving the set. Never
  // reset on data === undefined (a refetch error must not read as "all
  // done").
  const inFlight = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (data === undefined) return;
    const current = new Set(data.map((item) => item.track_id));
    const finished = [...inFlight.current].filter((id) => !current.has(id));
    inFlight.current = current;
    if (finished.length === 0) return;
    // One rows invalidation covers every finished track (['tracks'] is a
    // prefix over all library list queries); per-track keys refetch only
    // where observers exist (open TagEditor, loaded deck, grid editor).
    void queryClient.invalidateQueries({ queryKey: ['tracks'] });
    for (const id of finished) {
      void queryClient.invalidateQueries({ queryKey: ['track', id] });
      void queryClient.invalidateQueries({ queryKey: ['beatgrid', id] });
      void queryClient.invalidateQueries({ queryKey: ['grid-analysis', id] });
    }
  }, [data, queryClient]);
}

/**
 * Is this Track's analysis in flight right now (whoever enqueued it)?
 * Reads the sync hook's cache without adding an interval of its own —
 * the Analyze button's already-running state.
 */
export function useTrackAnalysisPending(trackId: number | null): boolean {
  const { data } = useQuery<AnalysisPendingItem[]>({
    queryKey: QUERY_KEY,
    queryFn: api.analyze.pending,
  });
  return (
    trackId !== null &&
    (data ?? []).some((item) => item.track_id === trackId)
  );
}
