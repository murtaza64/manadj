/**
 * Audition arm (sets 37): one-press play for a deferred-open pair.
 *
 * Opening a transition from a set row loads the editor SESSION only — no
 * audibility claim, no shared-deck loads — so a conducting set keeps
 * sounding under the mounted editor. The first play press claims
 * audibility (the holder stands down; claim-before-load, always) and this
 * module finishes the gesture: issue whatever deck loads are still
 * missing and start the audition the moment both decks hold the opened
 * pair ready. Precedent: SetDetailPane's `pendingCues` (cue-on-ready
 * plumbing, sets 13).
 *
 * The returned cancel function is the whole cancellation story — the
 * caller wires it to every other transport gesture, to displacement, and
 * to pair supersession. Cancelling never revokes loads already issued
 * (DeckEngine loads are not transactional); it only unhooks the pending
 * play.
 */

/** The slice of DeckEngine the arm needs (kept narrow for tests). */
export interface ArmedEngine {
  getSnapshot(): { trackId: number | null; loadState: string };
  subscribe(listener: () => void): () => void;
}

export interface ArmAuditionRequest {
  engines: { A: ArmedEngine; B: ArmedEngine };
  /** The opened pair's track ids — what each deck must hold. */
  targets: { A: number; B: number };
  /** Issue the shared-deck Load for a deck that doesn't hold its target.
   * Called synchronously from armAudition, at most once per deck. */
  load: (deck: 'A' | 'B') => void;
  /** Both decks hold their targets ready → start the audition. Fires
   * exactly once; synchronously when nothing needed loading (the free
   * case: editing the sounding adjacency). */
  onReady: () => void;
}

const DECKS = ['A', 'B'] as const;

/**
 * Arm a pending play. Returns the cancel function, or null when the play
 * fired synchronously (both decks already held the pair ready).
 */
export function armAudition(req: ArmAuditionRequest): (() => void) | null {
  const holds = (deck: 'A' | 'B') => {
    const s = req.engines[deck].getSnapshot();
    return s.trackId === req.targets[deck] && s.loadState === 'ready';
  };
  // Issue the missing loads. A matching track already held or in flight
  // (fetching/decoding) is NOT re-requested — a re-press must not restart
  // it (pendingCues rule); anything else (foreign track, empty, error)
  // gets a fresh Load.
  for (const deck of DECKS) {
    const s = req.engines[deck].getSnapshot();
    const settledOrInFlight =
      s.trackId === req.targets[deck] &&
      (s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding');
    if (!settledOrInFlight) req.load(deck);
  }
  if (holds('A') && holds('B')) {
    req.onReady();
    return null;
  }
  let done = false;
  const unsubs: (() => void)[] = [];
  const check = () => {
    if (done || !holds('A') || !holds('B')) return;
    done = true;
    for (const u of unsubs) u();
    req.onReady();
  };
  unsubs.push(req.engines.A.subscribe(check), req.engines.B.subscribe(check));
  return () => {
    if (done) return;
    done = true;
    for (const u of unsubs) u();
  };
}
