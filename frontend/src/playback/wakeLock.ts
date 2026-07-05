/**
 * Screen wake lock (screen-wake 01): the display must not dim mid-set.
 * Holds a screen wake lock while any Deck is playing — the deck-running
 * `playing` flag, which previews never touch — and releases it when
 * everything pauses. Browsers auto-release wake locks when the tab hides,
 * so a visibilitychange re-acquires while a Deck still plays.
 *
 * Thin glue by design (followPlaybackBridge idiom): no API = silent
 * no-op; acquire/release failures log and never throw — dimming is a
 * nuisance, not a fault. The Desktop shell is Chromium, so the same API
 * covers it.
 */
import type { DeckEngine } from './DeckEngine';
import type { ChannelId } from './mixer';

const DECKS: readonly ChannelId[] = ['A', 'B'];

/** Subscribe to both engines; returns a dispose that also releases. */
export function initWakeLockBridge(engines: Record<ChannelId, DeckEngine>): () => void {
  const wakeLock = navigator.wakeLock;
  if (!wakeLock) return () => undefined;

  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  let disposed = false;

  const acquire = async () => {
    if (sentinel !== null || disposed) return;
    try {
      const lock = await wakeLock.request('screen');
      if (disposed || !wanted) {
        void lock.release();
        return;
      }
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
    } catch (err) {
      // e.g. page hidden, power-save policy — retried on the next edge.
      console.warn('[wake-lock] acquire failed', err);
    }
  };

  const release = () => {
    const lock = sentinel;
    sentinel = null;
    void lock?.release().catch(() => undefined);
  };

  const update = () => {
    const anyPlaying = DECKS.some((deck) => engines[deck].getSnapshot().playing);
    if (anyPlaying === wanted) return;
    wanted = anyPlaying;
    if (wanted) void acquire();
    else release();
  };

  // The browser drops the lock on tab-hide; take it back on return.
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
  };

  const unsubscribes = DECKS.map((deck) => engines[deck].subscribe(update));
  document.addEventListener('visibilitychange', onVisibility);
  update();

  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    release();
  };
}
