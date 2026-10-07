/**
 * Played Tracks (sessions 09, gh#106): the pure projection behind the
 * TrackList's played indicator. A Track is Played once it has been
 * Master-audible for more than `PLAYED_THRESHOLD_S` cumulative seconds in
 * the current Session — long enough to reject a stray tap or a two-bar
 * check, short enough to mark a normal transition play promptly.
 *
 * Audibility is the shared reducer's tenure-masked read
 * (capture/audibilityReducer.ts `maskedDeckAudible`): loaded-only,
 * CUE/preview stabs, PFL, kills, and machine-tenure playback all
 * contribute nothing, by construction — no second definition here.
 *
 * Shape: an incremental fold (`AudibleSecondsFold`), so the live store pays
 * O(1) per event, and a batch wrapper over it for persisted logs. Between
 * two consecutive events the state is constant, so each event closes the
 * interval [lastT, e.t] under the PREVIOUS state: every distinct Track
 * audible on any deck during that interval earns its length once (the same
 * Track doubled on two decks is one Track playing, not two).
 */
import {
  ALL_DECKS,
  applyEvent,
  initialAudibilityState,
  maskedDeckAudible,
} from '../capture/audibilityReducer';
import type { AudibilityState } from '../capture/audibilityReducer';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import type { CaptureEvent, DetectorParams } from '../capture/events';

/** Cumulative Master-audible seconds past which a Track counts as Played. */
export const PLAYED_THRESHOLD_S = 20;

export class AudibleSecondsFold {
  private readonly s: AudibilityState;
  private lastT: number | null = null;
  /** Cumulative Master-audible seconds per Track id. */
  readonly seconds = new Map<number, number>();

  constructor(
    params: DetectorParams = DEFAULT_DETECTOR_PARAMS
  ) {
    this.s = initialAudibilityState(params);
  }

  /** Clear history without forgetting what is currently playing. */
  clear(t: number): void {
    this.seconds.clear();
    this.lastT = t;
  }

  /**
   * Fold one event. Returns the Track ids whose tally crossed `threshold`
   * on this very event (empty otherwise) — the store's "did membership
   * change" signal without a diff.
   */
  note(e: CaptureEvent, threshold: number = PLAYED_THRESHOLD_S): number[] {
    const crossed: number[] = [];
    if (this.lastT !== null) {
      const dt = e.t - this.lastT;
      if (dt > 0) {
        // Distinct audible Tracks over the closing interval.
        const audibleNow = new Set<number>();
        for (const ch of ALL_DECKS) {
          const d = this.s.decks[ch];
          if (d.trackId !== null && maskedDeckAudible(this.s, ch)) audibleNow.add(d.trackId);
        }
        for (const id of audibleNow) {
          const before = this.seconds.get(id) ?? 0;
          const after = before + dt;
          this.seconds.set(id, after);
          if (before <= threshold && after > threshold) crossed.push(id);
        }
      }
    }
    this.lastT = e.t;
    applyEvent(this.s, e);
    return crossed;
  }
}

/** Batch: cumulative Master-audible seconds per Track over one whole log. */
export function audibleSecondsByTrack(
  events: CaptureEvent[],
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS
): Map<number, number> {
  const fold = new AudibleSecondsFold(params);
  for (const e of events) fold.note(e);
  return fold.seconds;
}

/** The Played set: Tracks whose tally exceeds the threshold. */
export function playedTrackIds(
  seconds: ReadonlyMap<number, number>,
  threshold: number = PLAYED_THRESHOLD_S
): Set<number> {
  const out = new Set<number>();
  for (const [id, s] of seconds) if (s > threshold) out.add(id);
  return out;
}
