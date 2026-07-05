/**
 * The Set detail pane (sets 01+02): replaces the track table on the
 * browse surface when a Set is selected. Ordered track rows (title/
 * artist, key, BPM) with drag-reorder and remove; adds arrive by dropping
 * tracks onto the Set's sidebar row or the pane itself. Scroll position
 * and selection live in the set store — the pane survives mode switches
 * unmoved.
 *
 * Between track rows sit adjacency rows (sets 02): pin chip, evidence
 * counts (N tr · M tk against the Transition library / Take history),
 * and the orthogonal Unresolved ("will hard-cut") and Unpracticed
 * badges. Auto-fill (per-adjacency and set-wide) proposes Transitions
 * only; the manual pin picker also lists the pair's Takes (ADR 0023).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SetRowWire } from '../api/client';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { DECK_COLORS } from '../theme/deckColors';
import type { HotCue, Track } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import {
  applyReorder,
  indicatorY,
  insertionIndexFromPointer,
  type RowRect,
} from '../selection/dropIndex';
import {
  isTrackDrag,
  readTrackDragPayload,
  readTrackDragSource,
  setTrackDragPayload,
} from '../selection/trackDrag';
import { useToast } from '../components/Toast';
import ContextMenu, { useContextMenuState, type MenuItem } from '../components/ContextMenu';
import { useTrackMenuItems } from '../components/useTrackMenuItems';
import type { ChannelId } from '../playback/mixer';
import {
  initTransitionStore,
  snapshotPairStore,
  subscribePairStore,
} from '../editor/pairStore';
import { requestPairEdit } from '../editor/openPair';
import { requestTakeReview } from '../capture/takeReview';
import {
  clearFreshTake,
  freshTakeChip,
  snapshotFreshTakes,
  subscribeFreshTakes,
  type FreshTake,
} from '../capture/freshTakes';
import { practiceCuePositions } from './practice';
import {
  adjacencyView,
  autoFillProposal,
  type AdjacencyPin,
  type TakeEvidence,
  type TransitionEvidence,
} from './adjacency';
import {
  conductorTogglePlay,
  pickupSetPlayback,
  seekSetPlayback,
  setFollowPlayback,
  startSetPlayback,
  stopSetPlayback,
  useConductorState,
} from './conductorStore';
import { OverviewLadder } from './OverviewLadder';
import { evaluatePickup, readPickupSnapshot } from './pickup';
import { fmtSec, type PlannedEntry, type PlanWarning } from './planner';
import { prefetchTrackBuffer } from './prefetch';
import { useSetPlan } from './useSetPlan';
import { useSetSettings } from './setSettings';
import {
  addTracksToSet,
  ensureSetEntriesLoaded,
  getSetScroll,
  insertTrackIntoSet,
  removeTrackFromSet,
  reorderSetEntries,
  setAdjacencyPin,
  setAdjacencyPins,
  setSetScroll,
  useSetEntries,
} from './setStore';
import SetSuggestions, { type SuggestTarget } from './SetSuggestions';
import { ArchivedTrackFlag, ArchivedTrackRowMark } from './archivedFlag';

interface SetDetailPaneProps {
  setId: number;
  /** The embedding view's load policy (editor-midi 03): Library passes
   * its `loadWithViewPolicy` down, so embedded views (editor assign-to-
   * pair, Performance lock) keep their semantics for menu Loads too. */
  onLoadToDeck: (deck: ChannelId, track: Track) => void;
}

export default function SetDetailPane({ setId, onLoadToDeck }: SetDetailPaneProps) {
  const showToast = useToast();
  const entries = useSetEntries(setId);
  useEffect(() => {
    void ensureSetEntriesLoaded(setId);
  }, [setId]);

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });
  const set = sets.find((s) => s.id === setId);

  // ── Adjacency evidence (sets 02) ─────────────────────────────────────
  // Transitions per ordered pair from the pair store (the Transition
  // library's own source of truth); Takes from the history list.
  const pairStore = useSyncExternalStore(subscribePairStore, snapshotPairStore);
  useEffect(() => {
    void initTransitionStore();
  }, []);
  const { data: takes = [] } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });
  // Fresh-Take offers (sets 13): the capture sink records the latest Take
  // per ordered pair; matching adjacencies grow a "new take — pin?" chip.
  const freshTakes = useSyncExternalStore(subscribeFreshTakes, snapshotFreshTakes);

  const pairEvidence = (a: number, b: number) => {
    const transitions: TransitionEvidence[] = (pairStore[`${a}:${b}`]?.items ?? []).map((it) => ({
      uuid: it.uuid,
      name: it.name,
      favorite: it.favorite ?? false,
    }));
    const pairTakes: TakeEvidence[] = takes
      .filter((t) => t.a_track_id === a && t.b_track_id === b)
      .map((t) => ({ uuid: t.uuid, detectedAt: t.detected_at }));
    return { transitions, takes: pairTakes };
  };

  // Adjacency click-through (sets 09): route by RESOLVED pin kind — a
  // Transition pin opens the editor with that Transition selected, a Take
  // pin opens the existing Take-review flow, unresolved (including
  // dangling pins) opens a blank sketch for the pair. The request rides a
  // window event; App flips the mode; the mounted editor consumes it —
  // this pane's state (set store) survives the switch untouched.
  const openAdjacencyEditor = (
    aTrackId: number,
    bTrackId: number,
    pin: AdjacencyPin | null
  ) => {
    const { transitions, takes: pairTakes } = pairEvidence(aTrackId, bTrackId);
    const view = adjacencyView(pin, transitions, pairTakes);
    if (view.status === 'take') {
      requestTakeReview(view.take!.uuid);
      return;
    }
    requestPairEdit({
      aTrackId,
      bTrackId,
      transitionUuid: view.status === 'transition' ? view.transition!.uuid : null,
    });
  };

  // Set-wide auto-fill: one click accepts every proposal on a pin-less
  // adjacency. Existing pins (even dangling ones) are never overwritten.
  const autoFillable = new Map<number, AdjacencyPin>();
  if (entries) {
    for (let i = 0; i < entries.length - 1; i++) {
      if (entries[i].pin !== null) continue;
      const { transitions } = pairEvidence(entries[i].trackId, entries[i + 1].trackId);
      const proposal = autoFillProposal(transitions);
      if (proposal) autoFillable.set(entries[i].trackId, { kind: 'transition', uuid: proposal.uuid });
    }
  }

  // Track metadata for the entry rows (batch-by-Promise.all pattern, as in
  // TakeHistoryView's labels query). Keyed under the ['tracks'] prefix so
  // every track mutation's invalidation (archive/unarchive/update) reaches
  // it — as ['set-tracks', …] the rows kept a stale archived_at until
  // remount (the drift class sets 12 patched).
  const trackIds = (entries ?? []).map((e) => e.trackId);
  const { data: trackMap } = useQuery({
    queryKey: ['tracks', 'set-rows', setId, trackIds.join(',')],
    enabled: trackIds.length > 0,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((id) => api.tracks.getById(id)));
      return new Map<number, Track>(tracks.map((t) => [t.id, t]));
    },
  });

  // ── Playback plan (sets 03): drives the ladder + played durations ────
  // The Set's Tempo policy (sets 06) shapes the plan: Riding ramps or
  // Fixed global rate scaling.
  const plan = useSetPlan(
    entries,
    trackMap,
    set ? { policy: set.tempo_policy, setTempoBpm: set.set_tempo_bpm } : undefined
  );

  // Real hot cues for the ladder clips (same cache keys as useHotCues).
  const hotCueQueries = useQueries({
    queries: trackIds.map((id) => ({
      queryKey: ['hotcues', id],
      queryFn: () => api.hotcues.get(id),
      staleTime: 0,
    })),
  });
  const hotCuesByTrack = new Map<number, HotCue[]>();
  trackIds.forEach((id, i) => {
    const cues = hotCueQueries[i]?.data;
    if (cues) hotCuesByTrack.set(id, cues);
  });

  // ── Conductor (sets 04): play the Set through the shared Decks/Mixer ─
  const mixer = useMixer();
  const decks = useDecks();
  const conductorState = useConductorState();
  const conductingThis = conductorState.setId === setId && conductorState.status !== 'idle';
  const trackMapRef = useRef(trackMap);
  useEffect(() => {
    trackMapRef.current = trackMap;
  });
  const conductorAudio = () => ({ mixer, engines: { A: decks.A.engine, B: decks.B.engine } });
  const loadTrackOnDeck = (deck: 'A' | 'B', trackId: number) => {
    // The deck provider's one Load path (ADR 0022); the pane's track
    // map usually already holds the row.
    const known = trackMapRef.current?.get(trackId);
    if (known) decks[deck].loadTrack(known);
    else void api.tracks.getById(trackId).then((t) => decks[deck].loadTrack(t));
  };
  // Prefetch one entry ahead (sets 14): warm the decode cache so the
  // handover's deck load is a near-instant cache hit.
  const prefetchTrack = (trackId: number) => {
    void prefetchTrackBuffer(mixer, trackId).catch((err) =>
      console.error(`set prefetch failed for track ${trackId}`, err)
    );
  };
  const playFromEntry = (index: number) => {
    if (!plan) return;
    startSetPlayback(setId, plan, conductorAudio(), loadTrackOnDeck, index, prefetchTrack);
  };
  // Ladder click (sets 05): seek — conducting already seeks in place
  // (preserving play/pause); idle starts playing from that instant.
  const seekToMixTime = (mixTime: number) => {
    if (!plan) return;
    seekSetPlayback(setId, plan, conductorAudio(), loadTrackOnDeck, mixTime, prefetchTrack);
  };

  // ── Pickup (sets 16): resume the set from the live deck state ────────
  // The button is lit exactly when the state maps cleanly onto the plan
  // (pure predicate); unlit shows the reason that teaches the fix. The
  // live state moves outside React (playheads, mixer), so poll while the
  // Conductor is idle — only the lit/reason summary enters React state.
  const { pickupRampSec, pickupToleranceSec } = useSetSettings();
  const [pickupState, setPickupState] = useState<{ lit: boolean; message: string } | null>(null);
  const canPickup =
    conductorState.status === 'idle' && plan !== undefined && plan.entries.length > 0;
  useEffect(() => {
    if (!canPickup || !plan) return;
    const evaluate = () => {
      const decision = evaluatePickup(
        plan,
        readPickupSnapshot(mixer, { A: decks.A.engine, B: decks.B.engine }),
        { toleranceSec: pickupToleranceSec }
      );
      const next = decision.lit
        ? { lit: true, message: 'Resume set playback from the current deck state' }
        : { lit: false, message: decision.message };
      setPickupState((prev) =>
        prev && prev.lit === next.lit && prev.message === next.message ? prev : next
      );
    };
    // First evaluation next tick (setState inside an effect body cascades);
    // the interval keeps it fresh against the moving playheads.
    const kick = setTimeout(evaluate, 0);
    const timer = setInterval(evaluate, 250);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [canPickup, plan, mixer, decks, pickupToleranceSec]);
  const pickUp = () => {
    if (!plan) return;
    // The store re-evaluates against ONE fresh snapshot (the polled
    // summary may be 250ms stale); an unlit verdict is simply a no-op.
    pickupSetPlayback(
      setId,
      plan,
      conductorAudio(),
      loadTrackOnDeck,
      { rampSec: pickupRampSec, toleranceSec: pickupToleranceSec },
      prefetchTrack
    );
  };

  // ── Practice (sets 13): mix an adjacency live on the shared decks ────
  // Cue-on-ready plumbing: a deck seek needs decoded audio, so a cue on a
  // not-yet-loaded track parks via a one-shot engine subscription. One
  // pending cue per deck; a re-press (or a different practice) cancels it.
  const pendingCues = useRef<Record<'A' | 'B', (() => void) | null>>({ A: null, B: null });
  useEffect(
    () => () => {
      pendingCues.current.A?.();
      pendingCues.current.B?.();
    },
    []
  );
  const cueDeckAt = (deck: 'A' | 'B', trackId: number, seconds: number) => {
    pendingCues.current[deck]?.(); // cancel a superseded pending cue
    pendingCues.current[deck] = null;
    const engine = decks[deck].engine;
    const snap = engine.getSnapshot();
    if (snap.trackId === trackId && snap.loadState === 'ready') {
      // The rehearsal reset: park (pause) and re-cue in place.
      engine.pause();
      engine.seek(seconds);
      return;
    }
    // Load unless the right track is already in flight (a re-press during
    // the fetch must not restart it — just re-park the cue on ready).
    if (snap.trackId !== trackId || snap.loadState === 'error' || snap.loadState === 'empty') {
      loadTrackOnDeck(deck, trackId);
    }
    const unsub = engine.subscribe(() => {
      const s = engine.getSnapshot();
      if (s.trackId === trackId && s.loadState === 'ready') {
        pendingCues.current[deck] = null;
        unsub();
        engine.seek(seconds);
      }
    });
    pendingCues.current[deck] = unsub;
  };

  // The second adjacency verb (issue 09 sketches it; this mixes it live):
  // outgoing→A, incoming→B, cued by the plan when the adjacency is pinned,
  // by the hot-cue/Main-cue fallbacks when unresolved. Stays in this view;
  // the shared surface keeps audibility, so capture stays armed — mixing
  // the pair by hand is exactly what produces the Take.
  const practiceAdjacency = (i: number) => {
    if (!entries) return;
    const outgoing = entries[i];
    const incoming = entries[i + 1];
    const outTrack = trackMap?.get(outgoing.trackId);
    const inTrack = incoming ? trackMap?.get(incoming.trackId) : undefined;
    if (!incoming || !outTrack || !inTrack) return;
    // Practicing takes the decks by hand — a running Conductor stands down.
    stopSetPlayback();
    const positions = practiceCuePositions({
      adjacency: plan?.adjacencies[i],
      outgoingEntry: plan?.entries[i],
      incomingEntry: plan?.entries[i + 1],
      outgoingDurationSec: outTrack.duration_secs ?? 0,
      outgoingHotCueSecs: (hotCuesByTrack.get(outgoing.trackId) ?? []).map(
        (c) => c.time_seconds
      ),
      incomingMainCueSec: inTrack.cue_point_time ?? 0,
    });
    cueDeckAt('A', outgoing.trackId, positions.outgoingSec);
    cueDeckAt('B', incoming.trackId, positions.incomingSec);
  };

  // ── Scroll persistence (set store — survives mode switches) ──────────
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = getSetScroll(setId);
    // Restore once the rows exist (first data arrival changes scrollHeight).
  }, [setId, entries !== undefined && trackMap !== undefined]);

  // ── List convergence (sets 05): under follow, the active row scrolls
  // into view at track-change boundaries; a manual scroll disengages
  // follow (programmatic scrolls are excluded via a timestamp window).
  const lastAutoListScrollAt = useRef(0);
  useEffect(() => {
    if (!conductingThis || !conductorState.follow) return;
    const index = conductorState.activeEntryIndex;
    const pane = paneRef.current;
    if (pane === null || index === null) return;
    const row = pane.querySelectorAll('[data-set-track-row]')[index];
    if (row) {
      lastAutoListScrollAt.current = performance.now();
      (row as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [conductingThis, conductorState.follow, conductorState.activeEntryIndex]);

  // ── Suggestions (sets 10): toolbar append + per-adjacency insert ─────
  const [suggest, setSuggest] = useState<{ x: number; y: number; target: SuggestTarget } | null>(
    null
  );
  const inSetIds = new Set(trackIds);
  const lastTrack =
    entries && entries.length > 0 ? trackMap?.get(entries[entries.length - 1].trackId) : undefined;

  // ── Track-row context menu (sets 17): the universal track menu plus
  // the surface's Remove from set. Targeting bakes in Library's rule —
  // targets = the selection if the clicked row is in it, else the
  // clicked row; with no selection model yet (issue 18) that is de
  // facto the clicked row, and 18 upgrades to multi for free.
  const { menu: rowMenu, openMenu: openRowMenu, closeMenu: closeRowMenu } =
    useContextMenuState<Track>();
  const rowMenuItems = useTrackMenuItems({
    tracks: rowMenu ? [rowMenu.context] : [],
    excludeSetId: setId,
    loadToDeck: onLoadToDeck,
    surfaceItems: rowMenu
      ? [
          {
            label: 'Remove from set',
            danger: true,
            onSelect: () => removeTrackFromSet(setId, rowMenu.context.id),
          },
        ]
      : [],
  });

  // ── Drag-reorder (dropIndex helpers, playlist-pane mechanics) ────────
  const [dropIndicator, setDropIndicator] = useState<{ index: number; y: number } | null>(null);

  const rowRects = (pane: HTMLDivElement): RowRect[] => {
    const paneRect = pane.getBoundingClientRect();
    return Array.from(pane.querySelectorAll('[data-set-track-row]')).map((row) => {
      const r = (row as HTMLElement).getBoundingClientRect();
      return { top: r.top - paneRect.top + pane.scrollTop, height: r.height };
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isTrackDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const pane = paneRef.current;
    if (!pane) return;
    const rects = rowRects(pane);
    const pointerY = e.clientY - pane.getBoundingClientRect().top + pane.scrollTop;
    const index = insertionIndexFromPointer(pointerY, rects);
    setDropIndicator({ index, y: indicatorY(index, rects) });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!paneRef.current?.contains(e.relatedTarget as Node)) {
      setDropIndicator(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!entries) return;
    const droppedIds = readTrackDragPayload(e.dataTransfer);
    if (droppedIds.length === 0) return;

    // In-pane drags reorder; drags from anywhere else append (a Track
    // appears at most once — present drops are skipped with a toast).
    if (readTrackDragSource(e.dataTransfer) === 'set-pane') {
      const orderIds = entries.map((en) => en.trackId);
      const newOrder = applyReorder(orderIds, droppedIds, indicator?.index ?? orderIds.length);
      if (newOrder.join(',') !== orderIds.join(',')) {
        reorderSetEntries(setId, newOrder);
      }
      return;
    }

    void addTracksToSet(setId, droppedIds).then((skipped) => {
      if (skipped > 0) {
        showToast(skipped === 1 ? '1 track already in set' : `${skipped} tracks already in set`);
      }
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Set header strip (mirrors the playlist header) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          borderBottom: '1px solid var(--surface0)',
          background: 'var(--crust)',
        }}
      >
        <span style={{ fontSize: '13px', color: 'var(--text)' }}>
          {set?.color && (
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                background: set.color,
                marginRight: '8px',
              }}
            />
          )}
          {set?.name ?? 'Set'}
          <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>
            {entries?.length ?? 0} tracks
            {plan && ` · ${fmtSec(plan.totalSec)}`}
          </span>
          {set?.has_archived_tracks && (
            <ArchivedTrackFlag
              archivedTitles={(entries ?? []).flatMap((e) => {
                const t = trackMap?.get(e.trackId);
                return t?.archived_at ? [t.title || `Track ${t.id}`] : [];
              })}
            />
          )}
        </span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Tempo policy chip (sets 06): Riding / Fixed · Set tempo */}
          {set && (
            <TempoPolicyChip
              set={set}
              defaultBpm={
                (entries && entries.length > 0
                  ? trackMap?.get(entries[0].trackId)?.bpm
                  : null) ?? null
              }
            />
          )}
          {/* Plan degeneracies (sets 06): runway clamps, window overlaps… */}
          {plan && plan.warnings.length > 0 && (
            <WarningChip
              severity={plan.warnings.some((w) => w.severity === 'error') ? 'error' : 'warning'}
              title={plan.warnings.map((w) => w.message).join('\n')}
              label={`⚠ ${plan.warnings.length}`}
            />
          )}
          {/* Conductor transport (sets 04) — play/pause/stop are Conductor
              controls, never takeover triggers. */}
          {plan && plan.entries.length > 0 && (
            <>
              <button
                onClick={() => (conductingThis ? conductorTogglePlay() : playFromEntry(0))}
                title={
                  conductingThis
                    ? conductorState.status === 'playing'
                      ? 'Pause set playback'
                      : 'Resume set playback'
                    : 'Play the set through the decks'
                }
                style={{
                  padding: '2px 10px',
                  background: conductingThis ? 'var(--mauve)' : 'var(--surface0)',
                  color: conductingThis ? 'var(--base)' : 'var(--text)',
                  border: '1px solid var(--surface1)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {conductingThis && conductorState.status === 'playing' ? '⏸ Playing' : '▶ Play set'}
              </button>
              {conductingThis && (
                <button
                  onClick={stopSetPlayback}
                  title="Stop the Conductor (decks pause)"
                  style={{
                    padding: '2px 10px',
                    background: 'var(--surface0)',
                    color: 'var(--red)',
                    border: '1px solid var(--surface1)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  ⏹
                </button>
              )}
              {/* Pickup (sets 16): the inverse of takeover. Lit exactly
                  when the live deck state maps cleanly onto the plan;
                  unlit teaches the fix via the tooltip. */}
              {canPickup && pickupState && (
                <button
                  onClick={pickUp}
                  disabled={!pickupState.lit}
                  title={pickupState.message}
                  style={{
                    padding: '2px 10px',
                    background: pickupState.lit ? 'var(--peach)' : 'var(--surface0)',
                    color: pickupState.lit ? 'var(--base)' : 'var(--subtext0)',
                    border: '1px solid var(--surface1)',
                    cursor: pickupState.lit ? 'pointer' : 'default',
                    fontSize: '12px',
                  }}
                >
                  ⤴ Pick up
                </button>
              )}
            </>
          )}
        <button
          onClick={() => setAdjacencyPins(setId, autoFillable)}
          disabled={autoFillable.size === 0}
          title={
            autoFillable.size === 0
              ? 'No unresolved adjacency has an unambiguous Transition'
              : 'Pin the proposed Transition on every unresolved adjacency'
          }
          style={{
            padding: '2px 10px',
            background: autoFillable.size > 0 ? 'var(--green)' : 'var(--surface0)',
            color: autoFillable.size > 0 ? 'var(--base)' : 'var(--subtext0)',
            border: '1px solid var(--surface1)',
            cursor: autoFillable.size > 0 ? 'pointer' : 'default',
            fontSize: '12px',
          }}
        >
          Auto-fill {autoFillable.size > 0 ? `(${autoFillable.size})` : ''}
        </button>
        {/* Suggest (sets 10): ranked candidates to append after the last track */}
        <button
          onClick={(e) =>
            lastTrack &&
            setSuggest({ x: e.clientX, y: e.clientY, target: { kind: 'append', last: lastTrack } })
          }
          disabled={!lastTrack}
          title={
            lastTrack
              ? 'Suggest tracks to append, ranked by follow tiering out of the last track'
              : 'Add a track first — suggestions rank out of the last track'
          }
          style={{
            marginLeft: '8px',
            padding: '2px 10px',
            background: lastTrack ? 'var(--blue)' : 'var(--surface0)',
            color: lastTrack ? 'var(--base)' : 'var(--subtext0)',
            border: '1px solid var(--surface1)',
            cursor: lastTrack ? 'pointer' : 'default',
            fontSize: '12px',
          }}
        >
          Suggest
        </button>
        </span>
      </div>

      {/* Overview ladder (sets 03; freed in 05): pan/zoom minimap with
          click-to-seek, playhead, and follow-playback paging. */}
      {plan && trackMap && plan.entries.length > 0 && (
        <OverviewLadder
          key={setId}
          setId={setId}
          plan={plan}
          tracks={trackMap}
          hotCuesByTrack={hotCuesByTrack}
          conducting={conductingThis}
          follow={conductorState.follow}
          onSeek={seekToMixTime}
        />
      )}

      <div
        ref={paneRef}
        onScroll={(e) => {
          setSetScroll(setId, e.currentTarget.scrollTop);
          // Manual list scroll disengages follow (sets 05); programmatic
          // convergence scrolls are excluded by the timestamp window.
          if (
            conductingThis &&
            conductorState.follow &&
            performance.now() - lastAutoListScrollAt.current > 700
          ) {
            setFollowPlayback(false);
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ position: 'relative', flex: 1, overflow: 'auto' }}
      >
        {dropIndicator && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: Math.max(0, dropIndicator.y - 1),
              height: '2px',
              background: 'var(--blue)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}

        {entries === undefined ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>
            Empty set — drag tracks onto the set&apos;s sidebar row to add them.
          </div>
        ) : (
          entries.map((entry, i) => {
            const track = trackMap?.get(entry.trackId);
            const next = entries[i + 1];
            const planned = plan?.entries[i];
            return (
              <div key={entry.trackId}>
                <SetTrackRow
                  index={i}
                  trackId={entry.trackId}
                  track={track}
                  planned={planned}
                  conducting={conductingThis && conductorState.activeEntryIndex === i}
                  onPlayFrom={plan ? () => playFromEntry(i) : undefined}
                  onRemove={() => removeTrackFromSet(setId, entry.trackId)}
                  onContextMenu={
                    track
                      ? (e) => {
                          e.preventDefault();
                          openRowMenu(e.clientX, e.clientY, track);
                        }
                      : undefined
                  }
                />
                {next && (
                  <AdjacencyRow
                    pin={entry.pin}
                    evidence={pairEvidence(entry.trackId, next.trackId)}
                    warnings={plan?.warnings.filter((w) => w.adjacencyIndex === i)}
                    onPin={(pin) => setAdjacencyPin(setId, entry.trackId, pin)}
                    onOpenEditor={() =>
                      openAdjacencyEditor(entry.trackId, next.trackId, entry.pin)
                    }
                    onPractice={
                      trackMap?.has(entry.trackId) && trackMap?.has(next.trackId)
                        ? () => practiceAdjacency(i)
                        : undefined
                    }
                    freshTake={freshTakeChip(
                      freshTakes,
                      entry.trackId,
                      next.trackId,
                      entry.pin?.uuid ?? null
                    )}
                    onPinFreshTake={(uuid) => {
                      setAdjacencyPin(setId, entry.trackId, { kind: 'take', uuid });
                      clearFreshTake(entry.trackId, next.trackId);
                    }}
                    onSuggestInsert={(() => {
                      const predecessor = trackMap?.get(entry.trackId);
                      const successor = trackMap?.get(next.trackId);
                      if (!predecessor || !successor) return undefined;
                      return (x: number, y: number) =>
                        setSuggest({
                          x,
                          y,
                          target: { kind: 'insert', predecessor, successor, insertIndex: i + 1 },
                        });
                    })()}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Suggestion popover (sets 10) — accepting adds the Track; pins
          arrive via the usual auto-fill offer on the new adjacencies. */}
      {suggest && (
        <SetSuggestions
          x={suggest.x}
          y={suggest.y}
          target={suggest.target}
          inSetIds={inSetIds}
          onAccept={(trackId) => {
            if (suggest.target.kind === 'append') {
              void addTracksToSet(setId, [trackId]);
            } else {
              insertTrackIntoSet(setId, trackId, suggest.target.insertIndex);
            }
          }}
          onClose={() => setSuggest(null)}
        />
      )}

      {/* Track-row context menu (sets 17) */}
      {rowMenu && (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenuItems} onClose={closeRowMenu} />
      )}
    </div>
  );
}

/** Pin-chip text per resolved status. */
function pinChip(view: ReturnType<typeof adjacencyView>): { text: string; color: string } {
  if (view.status === 'transition') {
    const star = view.transition!.favorite ? '★ ' : '';
    return { text: `◆ ${star}${view.transition!.name}`, color: 'var(--green)' };
  }
  if (view.status === 'take') {
    const date = new Date(view.take!.detectedAt).toLocaleDateString();
    return { text: `● take · ${date} (unpromoted)`, color: 'var(--mauve)' };
  }
  return { text: '✕ hard cut', color: 'var(--subtext0)' };
}

/** Plan-degeneracy chip (sets 06): errors red, warnings yellow; the full
 * message rides the title. */
function WarningChip({
  severity,
  title,
  label,
}: {
  severity: PlanWarning['severity'];
  title: string;
  label: string;
}) {
  return (
    <span
      title={title}
      style={{
        padding: '1px 6px',
        background: severity === 'error' ? 'var(--red)' : 'var(--yellow)',
        color: 'var(--base)',
        fontSize: '11px',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

/** Short chip label per plan-warning kind (full message in the title). */
const WARNING_LABELS: Record<PlanWarning['kind'], string> = {
  'insufficient-runway': 'tempo runway',
  'window-overlap': 'windows overlap',
  'window-past-end': 'window past end',
  'incoming-ends-inside-window': 'incoming ends early',
  'no-bpm': 'no BPM',
  'pitch-clamped': 'pitch clamped',
  'grace-fade': 'overlap: previous track fades early',
  'grace-floor': 'overlap pileup',
};

function AdjacencyRow({
  pin,
  evidence,
  warnings,
  onPin,
  onOpenEditor,
  onPractice,
  freshTake,
  onPinFreshTake,
  onSuggestInsert,
}: {
  pin: AdjacencyPin | null;
  evidence: { transitions: TransitionEvidence[]; takes: TakeEvidence[] };
  /** This adjacency's plan degeneracies (sets 06), if any. */
  warnings?: PlanWarning[];
  onPin: (pin: AdjacencyPin | null) => void;
  /** Click-through (sets 09): open this adjacency in the Transition
   * editor (pin-kind routing lives with the caller). */
  onOpenEditor: () => void;
  /** Practice (sets 13): cue the pair on the decks — re-press re-cues.
   * Absent while the pair's track metadata is still loading. */
  onPractice?: () => void;
  /** A just-captured Take for this ordered pair (sets 13) — the transient
   * "new take — pin?" offer; null when none (or it's already the pin). */
  freshTake: FreshTake | null;
  onPinFreshTake: (uuid: string) => void;
  /** Open insert suggestions for this adjacency (sets 10); absent while
   * the pair's track metadata is still loading. */
  onSuggestInsert?: (x: number, y: number) => void;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const view = adjacencyView(pin, evidence.transitions, evidence.takes);
  const proposal = pin === null ? autoFillProposal(evidence.transitions) : null;
  const chip = pinChip(view);

  // Manual pin picker: the pair's Transitions AND Takes (Takes are never
  // auto-filled — pinning one is always this explicit act, ADR 0023).
  const pickerItems: MenuItem[] = [
    ...evidence.transitions.map((t) => ({
      label: `${t.favorite ? '★ ' : ''}${t.name}${pin?.uuid === t.uuid ? ' ✓' : ''}`,
      onSelect: () => onPin({ kind: 'transition', uuid: t.uuid }),
    })),
    ...evidence.takes.map((t, i) => ({
      label: `Take · ${new Date(t.detectedAt).toLocaleString()}${pin?.uuid === t.uuid ? ' ✓' : ''}`,
      separatorBefore: i === 0 && evidence.transitions.length > 0,
      onSelect: () => onPin({ kind: 'take', uuid: t.uuid }),
    })),
    ...(evidence.transitions.length === 0 && evidence.takes.length === 0
      ? [{ label: 'No transitions or takes for this pair', disabled: true }]
      : []),
    ...(pin !== null
      ? [
          {
            label: 'Unpin (hard cut)',
            danger: true,
            separatorBefore: true,
            onSelect: () => onPin(null),
          },
        ]
      : []),
  ];

  return (
    <>
      <div
        onClick={onOpenEditor}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Open this handover in the Transition editor"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '2px 12px 2px 48px',
          background: hovered ? 'var(--surface0)' : 'var(--crust)',
          borderBottom: '1px solid var(--surface0)',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        {/* Pin chip — click opens the manual pin picker */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuPos({ x: e.clientX, y: e.clientY });
          }}
          title="Pin a transition or take for this handover"
          style={{
            padding: '1px 8px',
            background: 'var(--surface0)',
            border: '1px solid var(--surface1)',
            color: chip.color,
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {chip.text}
        </button>

        {/* One-click auto-fill accept (Transitions only, favorite first) */}
        {proposal && view.status === 'unresolved' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin({ kind: 'transition', uuid: proposal.uuid });
            }}
            title="Pin the proposed Transition"
            style={{
              padding: '1px 8px',
              background: 'transparent',
              border: '1px dashed var(--green)',
              color: 'var(--green)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            ↳ pin {proposal.favorite ? '★ ' : ''}{proposal.name}
          </button>
        )}

        {/* Practice (sets 13): the mix-it-live verb — outgoing cued on A
            with a runway, incoming on B; press again to re-cue. */}
        {onPractice && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPractice();
            }}
            title="Practice this handover: cue outgoing on deck A (with a runway), incoming on deck B — press again to re-cue"
            style={{
              padding: '1px 8px',
              background: 'transparent',
              border: '1px dashed var(--yellow)',
              color: 'var(--yellow)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            ⏵ practice
          </button>
        )}

        {/* Fresh-Take offer (sets 13): the latest just-captured Take for
            this pair — one click pins it (never auto-pinned). */}
        {freshTake && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPinFreshTake(freshTake.uuid);
            }}
            title="A Take was just captured for this handover — pin it"
            style={{
              padding: '1px 8px',
              background: 'var(--mauve)',
              border: '1px solid var(--mauve)',
              color: 'var(--base)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            ● new take — pin?
          </button>
        )}

        {/* Orthogonal badges: Unresolved (will hard-cut) · Unpracticed */}
        {view.status === 'unresolved' && (
          <span
            style={{
              padding: '1px 6px',
              background: 'var(--red)',
              color: 'var(--base)',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            UNRESOLVED — will hard-cut
          </span>
        )}
        {view.unpracticed && (
          <span
            style={{
              padding: '1px 6px',
              background: 'var(--yellow)',
              color: 'var(--base)',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            UNPRACTICED
          </span>
        )}

        {/* Plan degeneracies on this adjacency (sets 06): runway clamps,
            window overlaps… — errors red, warnings yellow. */}
        {warnings?.map((w, k) => (
          <WarningChip
            key={k}
            severity={w.severity}
            title={w.message}
            label={`⚠ ${WARNING_LABELS[w.kind]}`}
          />
        ))}

        {/* Evidence counts for the ordered pair */}
        <span style={{ marginLeft: 'auto', color: 'var(--subtext0)' }}>
          {view.counts.transitions} tr · {view.counts.takes} tk
        </span>

        {/* Insert suggestions (sets 10): ranked by the weaker edge */}
        {onSuggestInsert && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSuggestInsert(e.clientX, e.clientY);
            }}
            title="Suggest a track to insert here, ranked by the weaker of the two edges"
            style={{
              padding: '1px 8px',
              background: 'transparent',
              border: '1px dashed var(--blue)',
              color: 'var(--blue)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            + insert
          </button>
        )}
      </div>
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={pickerItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

function SetTrackRow({
  index,
  trackId,
  track,
  planned,
  conducting,
  onPlayFrom,
  onRemove,
  onContextMenu,
}: {
  index: number;
  trackId: number;
  track: Track | undefined;
  /** This entry's slice of the playback plan (sets 03). */
  planned: PlannedEntry | undefined;
  /** The Conductor's playhead is inside this entry (sets 04). */
  conducting: boolean;
  /** Row play button: start Set playback at this track's planned entry. */
  onPlayFrom: (() => void) | undefined;
  onRemove: () => void;
  /** Right-click: the universal track menu (sets 17); absent while the
   * row's track metadata is still loading. */
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      data-set-track-row
      draggable
      onDragStart={(e) => setTrackDragPayload(e.dataTransfer, [trackId], 'set-pane')}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--surface0)',
        borderLeft: planned
          ? `3px solid ${DECK_COLORS[planned.deck]}`
          : '3px solid transparent',
        background: conducting
          ? 'color-mix(in srgb, var(--mauve) 18%, transparent)'
          : hovered
            ? 'var(--surface0)'
            : 'transparent',
        cursor: 'grab',
      }}
    >
      <button
        onClick={onPlayFrom}
        disabled={!onPlayFrom}
        title="Play the set from this track's planned entry"
        style={{
          visibility: hovered && onPlayFrom ? 'visible' : 'hidden',
          padding: 0,
          width: '18px',
          background: 'transparent',
          border: 'none',
          color: 'var(--mauve)',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        ▶
      </button>
      <span style={{ width: '24px', textAlign: 'right', color: 'var(--subtext0)', fontSize: '12px' }}>
        {index + 1}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text)' }}>{track?.title ?? `Track ${trackId}`}</span>
        {track?.artist && (
          <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>{track.artist}</span>
        )}
        {track?.archived_at != null && <ArchivedTrackRowMark />}
      </span>
      {/* "plays m:ss of m:ss" — the plan's audible footprint (sets 03) */}
      <span style={{ width: '110px', color: 'var(--subtext0)', fontSize: '12px', textAlign: 'right' }}>
        {planned && track?.duration_secs
          ? `plays ${fmtSec(Math.max(planned.exitSec - planned.entrySec, 0))} of ${fmtSec(track.duration_secs)}`
          : ''}
      </span>
      <span style={{ width: '40px', color: 'var(--sapphire)', fontSize: '12px' }}>
        {formatKeyDisplay(track?.key ?? null)}
      </span>
      <span style={{ width: '64px', color: 'var(--subtext1)', fontSize: '12px', textAlign: 'right' }}>
        {track?.bpm ? `${track.bpm.toFixed(1)} BPM` : '—'}
      </span>
      <button
        onClick={onRemove}
        title="Remove from set"
        style={{
          visibility: hovered ? 'visible' : 'hidden',
          padding: '2px 8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--red)',
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Tempo policy chip (sets 06): shows the Set's policy (and Set tempo when
 * Fixed); clicking opens a small popover to switch policy or edit the
 * tempo. Persists per Set via PATCH; the plan recomputes on the refreshed
 * row. Switching to Fixed seeds the Set tempo from the first track's
 * native BPM (the PRD default), kept editable afterwards.
 */
function TempoPolicyChip({
  set,
  defaultBpm,
}: {
  set: SetRowWire;
  /** The first track's native BPM (Fixed's default Set tempo). */
  defaultBpm: number | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);

  const patch = (data: { tempo_policy?: 'riding' | 'fixed'; set_tempo_bpm?: number | null }) => {
    void api.sets
      .update(set.id, data)
      .then(() => queryClient.invalidateQueries({ queryKey: ['sets'] }))
      .catch((err) => console.error('set tempo update failed', err));
  };

  const fixed = set.tempo_policy === 'fixed';
  const effectiveBpm = set.set_tempo_bpm ?? defaultBpm;
  const commitBpm = () => {
    if (bpmDraft === null) return;
    const parsed = Number(bpmDraft);
    if (Number.isFinite(parsed) && parsed > 0) patch({ set_tempo_bpm: parsed });
    setBpmDraft(null);
  };

  return (
    <span style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Tempo policy: Riding eases each track back to its native tempo; Fixed pitches the whole set to one BPM"
        style={{
          padding: '2px 10px',
          background: 'var(--surface0)',
          color: fixed ? 'var(--peach)' : 'var(--sapphire)',
          border: '1px solid var(--surface1)',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        {fixed ? `Fixed · ${effectiveBpm ? `${effectiveBpm.toFixed(1)} BPM` : 'no BPM'}` : 'Riding'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px',
            background: 'var(--mantle)',
            border: '1px solid var(--surface1)',
            minWidth: '220px',
            fontSize: '12px',
          }}
        >
          <button
            onClick={() => {
              if (fixed) patch({ tempo_policy: 'riding' });
              setOpen(false);
            }}
            style={{
              padding: '3px 8px',
              textAlign: 'left',
              background: !fixed ? 'var(--sapphire)' : 'var(--surface0)',
              color: !fixed ? 'var(--base)' : 'var(--text)',
              border: '1px solid var(--surface1)',
              cursor: 'pointer',
            }}
          >
            Riding — tracks return to native tempo between handovers
          </button>
          <button
            onClick={() => {
              if (!fixed) {
                patch({ tempo_policy: 'fixed', set_tempo_bpm: set.set_tempo_bpm ?? defaultBpm });
              }
            }}
            style={{
              padding: '3px 8px',
              textAlign: 'left',
              background: fixed ? 'var(--peach)' : 'var(--surface0)',
              color: fixed ? 'var(--base)' : 'var(--text)',
              border: '1px solid var(--surface1)',
              cursor: 'pointer',
            }}
          >
            Fixed — the whole set holds one tempo
          </button>
          {fixed && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--subtext0)' }}>Set tempo</span>
              <input
                type="number"
                min={1}
                step={0.1}
                value={bpmDraft ?? (effectiveBpm != null ? String(effectiveBpm) : '')}
                onChange={(e) => setBpmDraft(e.target.value)}
                onBlur={commitBpm}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                style={{
                  width: '72px',
                  padding: '2px 4px',
                  background: 'var(--surface0)',
                  color: 'var(--text)',
                  border: '1px solid var(--surface1)',
                  fontSize: '12px',
                }}
              />
              <span style={{ color: 'var(--subtext0)' }}>BPM</span>
            </label>
          )}
          <button
            onClick={() => setOpen(false)}
            style={{
              padding: '2px 8px',
              background: 'transparent',
              color: 'var(--subtext0)',
              border: 'none',
              cursor: 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            close
          </button>
        </div>
      )}
    </span>
  );
}
