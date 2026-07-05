/**
 * Take sink (transition-takes 02): persist settled Takes and announce
 * them. Fire-and-forget — a dead backend loses that Take (logged), the
 * capture keeps running; there is no retry queue (same posture as the
 * transition store, ADR 0011).
 */
import { api } from '../api/client';
import type { DetectedTake } from './events';

/** window CustomEvent fired after a Take row is persisted. */
export const TAKE_RECORDED_EVENT = 'manadj:take-recorded';

export function persistTake(take: DetectedTake): void {
  void api.takes
    .create({
      uuid: crypto.randomUUID(),
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
      window.dispatchEvent(new CustomEvent(TAKE_RECORDED_EVENT));
    })
    .catch((err) => {
      console.error('take capture: persist failed — Take lost', err);
    });
}
