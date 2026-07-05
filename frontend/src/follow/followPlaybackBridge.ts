/**
 * Follow playback bridge (follow-mode 02): translates Deck snapshot
 * emissions into Follow state-machine events. Watches each engine's
 * `playing` flag — the deck-running state, which previews (cue audition,
 * hot-cue holds) never touch — and dispatches play/pause events carrying
 * the post-event deck-running map. Thin glue by design: all semantics
 * live in the reducer (model.ts).
 *
 * Gated on audibility (ADR 0022): "Follow rides playback" means
 * PERFORMANCE playback. The Transition editor now conducts these same
 * Decks; its auditions' play/pause churn must not spread or drop Follow.
 * Transitions while a non-shared surface holds audibility are swallowed
 * (the `playing` tracker stays current, so the map is honest when the
 * gate lifts). The arbiter's own entry pause still lands while 'shared'
 * holds — same visible behavior as before the editor shared the decks.
 */
import type { DeckEngine } from '../playback/DeckEngine';
import type { ChannelId } from '../playback/mixer';
import { audibleHolder } from '../playback/audibleSurface';
import { dispatchFollow } from './followStore';

const DECKS: readonly ChannelId[] = ['A', 'B'];

/** Subscribe to both engines; returns a dispose. */
export function initFollowPlaybackBridge(
  engines: Record<ChannelId, DeckEngine>
): () => void {
  const playing: Record<ChannelId, boolean> = {
    A: engines.A.getSnapshot().playing,
    B: engines.B.getSnapshot().playing,
  };
  const unsubscribes = DECKS.map((deck) =>
    engines[deck].subscribe(() => {
      const now = engines[deck].getSnapshot().playing;
      if (now === playing[deck]) return;
      playing[deck] = now;
      if (audibleHolder() !== 'shared') return; // editor audition, not a set
      dispatchFollow({ type: now ? 'play' : 'pause', deck, playing: { ...playing } });
    })
  );
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
