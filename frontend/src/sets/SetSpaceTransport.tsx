/**
 * SetSpaceTransport (sets 34): the space-transport adapter feed.
 *
 * dispatchSetSpace's idle verbs (pickup, play-from-start) need the
 * SELECTED Set's plan plus the shared deck/mixer wiring — React-side
 * state the module-level dispatch cannot assemble. While a Set is
 * selected in the browse surface, this headless App-level component
 * (ConductorPlanFeed's pattern — deliberately the same query keys, so
 * the caches are shared with the Set pane) keeps the plan assembled and
 * registers the executing adapter. Above the view switch: the selection
 * survives mode switches (setStore), and space must work in the
 * Performance view's embedded browse exactly like the library's.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';
import { pickupSetPlayback, startSetPlayback } from './conductorStore';
import { evaluatePickup, readPickupSnapshot } from './pickup';
import { prefetchTrackBuffer } from './prefetch';
import { useSetSettings } from './setSettings';
import { ensureSetEntriesLoaded, useSelectedSetId, useSetEntries } from './setStore';
import { registerSetSpaceAdapter } from './spaceTransport';
import { useSetPlan } from './useSetPlan';

export function SetSpaceTransport(): React.ReactElement | null {
  const setId = useSelectedSetId();
  if (setId === null) return null;
  return <Adapter key={setId} setId={setId} />;
}

function Adapter({ setId }: { setId: number }): null {
  const entries = useSetEntries(setId);
  useEffect(() => {
    void ensureSetEntriesLoaded(setId);
  }, [setId]);

  // Same query keys as SetDetailPane/ConductorPlanFeed (shared caches).
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });
  const set = sets.find((s) => s.id === setId);
  const trackIds = (entries ?? []).map((e) => e.trackId);
  const { data: trackMap } = useQuery({
    queryKey: ['tracks', 'set-rows', setId, trackIds.join(',')],
    enabled: trackIds.length > 0,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((id) => api.tracks.getById(id)));
      return new Map<number, Track>(tracks.map((t) => [t.id, t]));
    },
  });

  const plan = useSetPlan(
    entries,
    trackMap,
    set ? { policy: set.tempo_policy, setTempoBpm: set.set_tempo_bpm } : undefined
  );

  const mixer = useMixer();
  const decks = useDecks();
  const { pickupRampSec, pickupToleranceSec } = useSetSettings();

  // Registration is mount-scoped; the handlers read the live values
  // through a ref (the browse-surface registration idiom).
  const ctx = useRef({ plan, trackMap, mixer, decks, pickupRampSec, pickupToleranceSec });
  useEffect(() => {
    ctx.current = { plan, trackMap, mixer, decks, pickupRampSec, pickupToleranceSec };
  });

  useEffect(() => {
    const audio = () => ({
      mixer: ctx.current.mixer,
      engines: { A: ctx.current.decks.A.engine, B: ctx.current.decks.B.engine },
    });
    // The deck provider's one Load path (ADR 0022), SetDetailPane's idiom.
    const loadTrackOnDeck = (deck: ChannelId, trackId: number) => {
      const known = ctx.current.trackMap?.get(trackId);
      if (known) ctx.current.decks[deck].loadTrack(known);
      else void api.tracks.getById(trackId).then((t) => ctx.current.decks[deck].loadTrack(t));
    };
    const prefetch = (trackId: number) => {
      void prefetchTrackBuffer(ctx.current.mixer, trackId).catch((err) =>
        console.error(`set prefetch failed for track ${trackId}`, err)
      );
    };
    return registerSetSpaceAdapter({
      isPickupLit: () => {
        const { plan, pickupToleranceSec } = ctx.current;
        if (!plan || plan.entries.length === 0) return false;
        return evaluatePickup(plan, readPickupSnapshot(audio().mixer, audio().engines), {
          toleranceSec: pickupToleranceSec,
        }).lit;
      },
      pickup: () => {
        const { plan, pickupRampSec, pickupToleranceSec } = ctx.current;
        if (!plan || plan.entries.length === 0) return;
        // Re-evaluates against ONE fresh snapshot inside; an unlit
        // verdict is a no-op — never a surprise restart (the ladder's
        // pickup-outranks-restart rationale).
        pickupSetPlayback(
          setId,
          plan,
          audio(),
          loadTrackOnDeck,
          { rampSec: pickupRampSec, toleranceSec: pickupToleranceSec },
          prefetch
        );
      },
      playFromStart: () => {
        const { plan } = ctx.current;
        if (!plan || plan.entries.length === 0) return;
        startSetPlayback(setId, plan, audio(), loadTrackOnDeck, 0, prefetch);
      },
    });
  }, [setId]);

  return null;
}
