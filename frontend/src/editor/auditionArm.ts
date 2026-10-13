/**
 * Audition arm (sets 37; generalized for the Mix editor, #204): one-press
 * play for a deferred-open surface.
 *
 * Opening an artifact from a set row loads the editor SESSION only — no
 * audibility claim, no shared-deck loads — so a conducting set keeps
 * sounding under the mounted editor. The first play press claims
 * audibility (the holder stands down; claim-before-load, always) and this
 * module finishes the gesture: issue whatever deck loads are still
 * missing and start the audition the moment every driven deck holds its
 * target ready. Precedent: SetDetailPane's `pendingCues` (cue-on-ready
 * plumbing, sets 13).
 *
 * Originally A/B-typed (the pair editor's two decks). #204 generalizes it
 * to an arbitrary list of driven decks so the slot-based Mix editor shares
 * one arm rather than reimplementing the state machine inline (ADR 0037,
 * phase 1: consolidate the inline audition-arm into the shared module).
 *
 * The returned cancel function is the whole cancellation story — the
 * caller wires it to every other transport gesture, to displacement, and
 * to supersession. Cancelling never revokes loads already issued
 * (DeckEngine loads are not transactional); it only unhooks the pending
 * play.
 */

/** The slice of DeckEngine the arm needs (kept narrow for tests). */
export interface ArmedEngine {
  getSnapshot(): { trackId: number | null; loadState: string };
  subscribe(listener: () => void): () => void;
}

/** One deck that must hold a specific track ready before the audition
 * fires. The slot-based editor derives these from the player's current
 * targets (deck + the occupant's track id); the pair editor passes its
 * two decks A/B. */
export interface ArmTarget {
  engine: ArmedEngine;
  /** The track this deck must hold ready. */
  trackId: number;
  /** Issue the shared-deck Load for this deck. Called synchronously from
   * armAudition, at most once, when the deck doesn't already hold/have in
   * flight its target. */
  load: () => void;
}

export interface ArmAuditionRequest {
  /** The driven decks — every one must hold its target before play. An
   * empty list fires onReady synchronously (nothing to wait on). */
  targets: ArmTarget[];
  /** Every driven deck holds its target ready → start the audition. Fires
   * exactly once; synchronously when nothing needed loading (the free
   * case: auditioning the already-sounding material). */
  onReady: () => void;
}

/**
 * Arm a pending play. Returns the cancel function, or null when the play
 * fired synchronously (every driven deck already held its target ready).
 */
export function armAudition(req: ArmAuditionRequest): (() => void) | null {
  const holds = (t: ArmTarget) => {
    const s = t.engine.getSnapshot();
    return s.trackId === t.trackId && s.loadState === 'ready';
  };
  const allHold = () => req.targets.every(holds);
  // Issue the missing loads. A matching track already held or in flight
  // (fetching/decoding) is NOT re-requested — a re-press must not restart
  // it (pendingCues rule); anything else (foreign track, empty, error)
  // gets a fresh Load.
  for (const t of req.targets) {
    const s = t.engine.getSnapshot();
    const settledOrInFlight =
      s.trackId === t.trackId &&
      (s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding');
    if (!settledOrInFlight) t.load();
  }
  if (allHold()) {
    req.onReady();
    return null;
  }
  let done = false;
  const unsubs: (() => void)[] = [];
  const check = () => {
    if (done || !allHold()) return;
    done = true;
    for (const u of unsubs) u();
    req.onReady();
  };
  for (const t of req.targets) unsubs.push(t.engine.subscribe(check));
  return () => {
    if (done) return;
    done = true;
    for (const u of unsubs) u();
  };
}
