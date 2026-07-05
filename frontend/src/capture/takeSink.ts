/**
 * Take sink (transition-takes 02): persist settled Takes and announce
 * them. Fire-and-forget — a dead backend loses that Take (logged), the
 * capture keeps running; there is no retry queue (same posture as the
 * transition store, ADR 0011).
 *
 * Announcement (sets 13): the sink invalidates the `['takes']` query
 * itself, so every evidence surface (Transition history, the Set view's
 * adjacency counts) recomputes live — no per-view event listeners.
 */
import { api } from '../api/client';
import { queryClient } from '../api/queryClient';
import { recordFreshTake } from './freshTakes';
import type { DetectedTake } from './events';

export function persistTake(take: DetectedTake): void {
  const uuid = crypto.randomUUID();
  void api.takes
    .create({
      uuid,
      a_track_id: take.outgoingTrackId,
      b_track_id: take.incomingTrackId,
      window_start_s: take.windowStartS,
      window_end_s: take.windowEndS,
      confidence: take.confidence,
      detector_version: take.detectorVersion,
      params: take.params,
      events: take.events,
    })
    .then(() => {
      void queryClient.invalidateQueries({ queryKey: ['takes'] });
      // The matching adjacency's transient "new take — pin?" offer.
      recordFreshTake(take.outgoingTrackId, take.incomingTrackId, uuid);
    })
    .catch((err) => {
      console.error('take capture: persist failed — Take lost', err);
    });
}
