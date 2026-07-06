/**
 * The Set detail pane (sets 01+02): replaces the track table on the
 * browse surface when a Set is selected. Ordered track rows on a shared
 * column grid (sets 31, rowColumns.ts: ▶ · # · in · key · BPM · energy ·
 * title/artist · play · ✕) with drag-reorder and remove; adds arrive by
 * dropping tracks onto the Set's sidebar row or the pane itself. Scroll
 * position and selection live in the set store — the pane survives mode
 * switches unmoved.
 *
 * Between track rows sit adjacency rows (sets 02): pin chip, evidence
 * counts (N tr · M tk against the Transition library / Take history),
 * and the orthogonal Unresolved ("will hard-cut") and Unpracticed
 * badges. Auto-fill (per-adjacency and set-wide) proposes Transitions
 * only; the manual pin picker also lists the pair's Takes (ADR 0023).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SetRowWire } from '../api/client';
import { useDecks, type DeckContextValue } from '../hooks/useDeck';
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
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
import {
  EMPTY_SELECTION,
  click,
  menuTargets,
  navigate as navigateSelection,
  selectGesture,
} from '../selection/selectionModel';
import { registerBrowseSurface } from '../midi/controlRegistry';
import type { SelectMods } from '../components/TrackRow';
import { useToast } from '../components/Toast';
import ContextMenu, { useContextMenuState, type MenuItem } from '../components/ContextMenu';
import EnergySquare from '../components/EnergySquare';
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
  previewAdjacencyFutures,
  reconcileOrderChange,
  WILL_RESTORE_COLOR,
  type AdjacencyFuture,
} from './dormancy';
import {
  conductorTogglePlay,
  pickupSetPlayback,
  seekSetPlayback,
  setFollowPlayback,
  startSetPlayback,
  stopSetPlayback,
  useConductorState,
} from './conductorStore';
import { NeverAudibleBadge } from './NeverAudibleBadge';
import { OverviewLadder } from './OverviewLadder';
import { evaluatePickup, readPickupSnapshot } from './pickup';
import {
  fmtSec,
  trackEffectiveBpm,
  type PlannedAdjacency,
  type PlannedEntry,
  type PlanWarning,
} from './planner';
import { getKeyColor } from '../utils/displayColors';
import {
  ADJ_GUTTER_W,
  ADJ_PAD_LEFT,
  ADJ_ROW_GAP,
  ADJ_TIME_SPACER_W,
  BPM_COL_W,
  bpmDeltaColor,
  bpmDeltaPercent,
  bpmDeltaTitle,
  cellStyle,
  ENERGY_COL_W,
  fmtInTime,
  fmtOverlapTime,
  fmtPlayTime,
  IN_TIME_COL_W,
  INDEX_COL_W,
  KEY_COL_W,
  PLAY_COL_W,
  PLAY_TIME_COL_W,
  REMOVE_COL_W,
  ROW_ACCENT_W,
  ROW_GAP,
  ROW_PAD_X,
  type BpmDeltaRef,
} from './rowColumns';
import {
  isRowPlaying,
  loadedDecks,
  loadedWash,
  type DeckOccupancyMap,
} from './rowMarks';
import { prefetchTrackBuffer } from './prefetch';
import { hotCue1Sec, useSetPlan } from './useSetPlan';
import { useSetSettings } from './setSettings';
import {
  addTracksToSet,
  ensureSetEntriesLoaded,
  getSetScroll,
  getSetSelection,
  insertTrackIntoSet,
  removeTracksFromSet,
  reorderSetEntries,
  setAdjacencyPin,
  setAdjacencyPins,
  setSetScroll,
  setSetSelection,
  useSetDormantPins,
  useSetEntries,
  useSetSelection,
} from './setStore';
import SetSuggestions, { type SuggestTarget } from './SetSuggestions';
import { ArchivedTrackFlag, ArchivedTrackRowMark } from './archivedFlag';
import './SetDetailPane.css';

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

  // ── Live drag preview (sets 07, extended to the list in sets 23):
  // during an in-pane row drag the ladder AND the track list render the
  // hypothetical order. The planner is a read-only dependency — the
  // hypothetical entries come from the same pure reconcile rule the drop
  // will commit through, so what the preview shows is exactly what a
  // drop produces (drop commits `previewOrder` directly). Cancel
  // (dragend/leave without a drop) simply discards the hypothesis.
  const dormant = useSetDormantPins(setId);
  const dragIdsRef = useRef<number[] | null>(null);
  // The same ids as state, for rendering only (the dragged rows dim,
  // sets 23) — dragover handlers keep reading the ref (set synchronously
  // at dragstart, before any re-render).
  const [dragIds, setDragIds] = useState<number[] | null>(null);
  const [previewOrder, setPreviewOrder] = useState<number[] | null>(null);
  const previewState = useMemo(
    () =>
      previewOrder && entries
        ? reconcileOrderChange(entries, dormant ?? [], previewOrder)
        : null,
    [previewOrder, entries, dormant]
  );
  const previewPlan = useSetPlan(
    previewState?.entries,
    trackMap,
    set ? { policy: set.tempo_policy, setTempoBpm: set.set_tempo_bpm } : undefined
  );
  const previewFutures = useMemo(
    () =>
      previewOrder && entries
        ? previewAdjacencyFutures(
            entries,
            dormant ?? [],
            previewOrder,
            (a, b) => (pairStore[`${a}:${b}`]?.items ?? []).length > 0
          )
        : undefined,
    [previewOrder, entries, dormant, pairStore]
  );

  // What the row stack renders (sets 23): the hypothetical state while a
  // preview is live, the committed state otherwise. Everything the rows
  // read (entries, plan, futures) switches together, so the list is
  // internally consistent mid-drag. Row affordances stay mounted (layout
  // stability for the dragover math) but are inert mid-drag — no click
  // can happen during an HTML5 drag.
  const displayEntries = previewState?.entries ?? entries;
  const displayPlan = previewState ? previewPlan : plan;

  // BPM delta reference (sets 31): under Fixed every row measures against
  // the Set tempo (the planner's own fallback when unset: the first
  // track's effective BPM); under Riding each row measures against its
  // predecessor — resolved per-row at render, against the DISPLAYED
  // order, so a live drag preview colors the hypothetical neighbors.
  const effectiveBpmOf = (trackId: number): number | null => {
    const t = trackMap?.get(trackId);
    return t ? trackEffectiveBpm(t) : null;
  };
  const fixedTempoRef: BpmDeltaRef | null = (() => {
    if (set?.tempo_policy !== 'fixed') return null;
    const bpm =
      set.set_tempo_bpm ??
      (displayEntries && displayEntries.length > 0
        ? effectiveBpmOf(displayEntries[0].trackId)
        : null);
    return bpm ? { kind: 'set-tempo', bpm } : null;
  })();
  const bpmRefFor = (i: number): BpmDeltaRef | null => {
    if (set?.tempo_policy === 'fixed') return fixedTempoRef;
    const prev = displayEntries?.[i - 1];
    if (!prev) return null; // first row under Riding: no reference
    const bpm = effectiveBpmOf(prev.trackId);
    return bpm ? { kind: 'predecessor', bpm } : null;
  };

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
  // Row marks (sets 35): LIVE deck occupancy + transport, straight off
  // the shared engines — conducting, after takeover, or plain manual
  // deck use all mirror reality. Replaces the single conducting "active
  // row" highlight (a conducting row is a loaded+playing row now).
  const occupancy = useDeckOccupancy(decks);
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
  // by the hot-cue fallbacks when unresolved (B at its Hot Cue 1 → track
  // start — the plan's hard-cut entry, sets 19). Stays in this view;
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
      incomingHotCue1Sec: hotCue1Sec(hotCuesByTrack.get(incoming.trackId)),
    });
    cueDeckAt('A', outgoing.trackId, positions.outgoingSec);
    cueDeckAt('B', incoming.trackId, positions.incomingSec);
  };

  // ── Transport centering (22 follow-up): the header centers its
  // transport within its OWN width, but the pane sits right of the
  // sidebar — so "centered in the bar" is off-center on screen. CSS
  // can't know the header's viewport offset; measure it and hand the
  // correction to the CSS as a custom property (paint-only transform —
  // see the .set-header-transport rule for the narrow-width tradeoff).
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const recenter = () => {
      const rect = header.getBoundingClientRect();
      const shift = window.innerWidth / 2 - (rect.left + rect.width / 2);
      header.style.setProperty('--transport-viewport-shift', `${shift}px`);
    };
    recenter();
    // The observer catches sidebar resizes and window resizes alike
    // (both change the header's box); a plain resize listener backstops
    // pure offset changes.
    const observer = new ResizeObserver(recenter);
    observer.observe(header);
    window.addEventListener('resize', recenter);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recenter);
    };
  }, []);

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

  // ── Row selection (sets 18): standard gestures — click selects one,
  // shift-click ranges from the anchor (in set order), cmd-click
  // toggles; Esc / empty-space click clears. The selection lives in the
  // set store (survives mode switches; readable by the menu, keyboard,
  // and drag handlers). Entry mutations prune it store-side.
  const selection = useSetSelection(setId);
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const handleRowSelect = (trackId: number, mods: SelectMods) => {
    if (!entries) return;
    const sel = getSetSelection(setId);
    setSetSelection(setId, selectGesture(sel, trackId, mods, entries.map((e) => e.trackId)));
  };
  // Keyboard: Esc clears; Delete/Backspace removes the selection with
  // standard pin handling (one reconcile pass — identical semantics to
  // the single-row ✕). Bubble-phase on purpose: an open ContextMenu
  // eats Escape on capture, so closing a menu never clears the rows.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = getSetSelection(setId);
      if (sel.ids.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        setSetSelection(setId, EMPTY_SELECTION);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeTracksFromSet(setId, sel.ids);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setId]);
  /** Group drag (sets 18): a selected row drags the whole selection —
   * in SET order, so a non-contiguous selection compacts at the drop
   * point as one contiguous run (playlist-editor convention). An
   * unselected row SELECTS-and-drags just itself (the name says the
   * write: this deliberately diverges from the Library's pure
   * getDragIds, per the issue's Decisions). */
  const selectAndGetDragIds = (trackId: number): number[] => {
    const sel = getSetSelection(setId);
    if (sel.ids.includes(trackId) && entries) {
      const member = new Set(sel.ids);
      return entries.filter((e) => member.has(e.trackId)).map((e) => e.trackId);
    }
    setSetSelection(setId, click(sel, trackId));
    return [trackId];
  };

  // ── Controller browse target (sets 33): the Set pane implements the
  // library's browse-surface contract (midi-controller 05) instead of
  // inventing a parallel one. The embedding Library YIELDS its own
  // registration while a Set is the visible browse list (stack order
  // alone can't be trusted: child effects run before parent effects),
  // so the encoder walks THIS list and LOAD A/B load THIS selection —
  // through the same view policy as the on-screen paths (the
  // onLoadToDeck prop IS Library's loadWithViewPolicy). Encoder select
  // ≡ click select: one selection
  // model (the set store) that 17's menu and 18's ops already read; the
  // encoder walks tracks only (adjacency rows have no selection —
  // pointer/keyboard territory). Handlers read live state through refs;
  // registration is mount-scoped per set.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });
  const onLoadToDeckRef = useRef(onLoadToDeck);
  useEffect(() => {
    onLoadToDeckRef.current = onLoadToDeck;
  });
  useEffect(
    () =>
      registerBrowseSurface({
        navigate: (delta) => {
          const order = (entriesRef.current ?? []).map((e) => e.trackId);
          if (order.length === 0) return;
          const next = navigateSelection(getSetSelection(setId), delta, order);
          setSetSelection(setId, next);
          // Keep the encoder's selection visible (scoped to this pane).
          // The pane's manual-scroll detection sees this as a user
          // scroll and disengages Conductor follow — deliberate: encoder
          // browsing IS browsing, same as a hand scroll (sets 05).
          if (next.anchorId !== null) {
            const row = paneRef.current?.querySelector(
              `[data-set-track-row="${next.anchorId}"]`
            );
            (row as HTMLElement | null)?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            });
          }
        },
        getSelectedTrack: () => {
          const anchorId = getSetSelection(setId).anchorId;
          return anchorId !== null ? (trackMapRef.current?.get(anchorId) ?? null) : null;
        },
        load: (deck, track) => onLoadToDeckRef.current(deck, track),
      }),
    [setId]
  );

  // ── Track-row context menu (sets 17): the universal track menu plus
  // the surface's Remove from set. Targeting bakes in Library's rule —
  // targets = the selection if the clicked row is in it, else the
  // clicked row (sets 18: right-clicking outside the selection selects
  // the row, so menu and highlight always agree).
  const { menu: rowMenu, openMenu: openRowMenu, closeMenu: closeRowMenu } =
    useContextMenuState<Track>();
  const rowMenuTargets: Track[] = rowMenu
    ? menuTargets(selection, rowMenu.context, (id) => trackMap?.get(id))
    : [];
  const rowMenuItems = useTrackMenuItems({
    tracks: rowMenuTargets,
    excludeSetId: setId,
    loadToDeck: onLoadToDeck,
    surfaceItems: rowMenu
      ? [
          {
            label:
              rowMenuTargets.length > 1
                ? `Remove ${rowMenuTargets.length} from set`
                : 'Remove from set',
            danger: true,
            onSelect: () => removeTracksFromSet(setId, rowMenuTargets.map((t) => t.id)),
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

    // In-pane reorder drags feed the live preview (sets 07/23): the rows
    // already display the hypothetical order, so the insertion index is
    // interpreted against THAT order (standard sortable pattern — steady
    // state is stable: the pointer over the dragged row's own slot
    // reproduces the same order). The moved row is its own indicator, so
    // the line is suppressed; foreign drags (library/playlist — payload
    // unreadable during dragover, ids ride a ref set at the row's
    // dragstart) keep the indicator line and never preview.
    if (dragIdsRef.current && entries) {
      setDropIndicator(null);
      const committedIds = entries.map((en) => en.trackId);
      const displayedIds = previewOrder ?? committedIds;
      const hypothetical = applyReorder(displayedIds, dragIdsRef.current, index);
      setPreviewOrder((prev) => {
        const next = hypothetical.join(',') === committedIds.join(',') ? null : hypothetical;
        if (prev !== null && next !== null && prev.join(',') === next.join(',')) return prev;
        return next;
      });
      return;
    }
    setDropIndicator({ index, y: indicatorY(index, rects) });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!paneRef.current?.contains(e.relatedTarget as Node)) {
      setDropIndicator(null);
      setPreviewOrder(null); // cancelled hypothesis — the ladder snaps back
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const indicator = dropIndicator;
    const previewed = previewOrder;
    setDropIndicator(null);
    setPreviewOrder(null);
    if (!entries) return;
    const droppedIds = readTrackDragPayload(e.dataTransfer);
    if (droppedIds.length === 0) return;

    // In-pane drags reorder; drags from anywhere else append (a Track
    // appears at most once — present drops are skipped with a toast).
    if (readTrackDragSource(e.dataTransfer) === 'set-pane') {
      // The rows previewed the hypothetical order — commit exactly it
      // (sets 23: preview ≡ commit by construction). No live preview
      // means the drag never left the committed order: nothing to do.
      // (Indicator fallback: a set-pane drag whose ids never rode this
      // pane's dragstart ref cannot preview — treat it like before.)
      if (previewed) {
        reorderSetEntries(setId, previewed);
      } else if (indicator) {
        const orderIds = entries.map((en) => en.trackId);
        const newOrder = applyReorder(orderIds, droppedIds, indicator.index);
        if (newOrder.join(',') !== orderIds.join(',')) {
          reorderSetEntries(setId, newOrder);
        }
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
      {/* Set header strip (sets 22): three zones — name + status chips
          left, the Conductor transport centered (media-player
          convention, the view's primary action), secondary actions
          right. The transport never shrinks or moves at narrow widths;
          the side zones wrap first. */}
      <div className="set-header" ref={headerRef}>
        <span className="set-header-left">
          {set?.color && (
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                flexShrink: 0,
                background: set.color,
              }}
            />
          )}
          <span>{set?.name ?? 'Set'}</span>
          <span style={{ color: 'var(--subtext0)' }}>
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
          {/* Tempo policy chip (sets 06): Riding / Fixed · Set tempo */}
          {set && (
            <TempoPolicyChip
              set={set}
              // Grid-first (ADR 0016) — must agree with the planner's own
              // Fixed-policy fallback (first track's effective BPM).
              defaultBpm={(() => {
                const t =
                  entries && entries.length > 0
                    ? trackMap?.get(entries[0].trackId)
                    : undefined;
                return t ? trackEffectiveBpm(t) : null;
              })()}
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
        </span>
        {/* Conductor transport (sets 04) — play/pause/stop are Conductor
            controls, never takeover triggers. */}
        <span className="set-header-transport">
          {plan && plan.entries.length > 0 && (
            <>
              <button
                className={`btn btn-success set-transport-btn set-play${conductingThis ? ' on' : ''}`}
                onClick={() => (conductingThis ? conductorTogglePlay() : playFromEntry(0))}
                title={
                  conductingThis
                    ? conductorState.status === 'playing'
                      ? 'Pause set playback'
                      : 'Resume set playback'
                    : 'Play the set through the decks'
                }
              >
                {/* \uFE0E forces text presentation — Apple renders these
                    glyphs as emoji by default, at emoji metrics (the ⤴
                    button visibly outgrew its siblings). */}
                {conductingThis && conductorState.status === 'playing'
                  ? '⏸\uFE0E Playing'
                  : '▶\uFE0E Play set'}
              </button>
              {conductingThis && (
                <button
                  className="btn btn-danger set-transport-btn"
                  onClick={stopSetPlayback}
                  title="Stop the Conductor (decks pause)"
                >
                  {'⏹\uFE0E'}
                </button>
              )}
              {/* Pickup (sets 16): the inverse of takeover. Lit exactly
                  when the live deck state maps cleanly onto the plan
                  (lit = color on-state); unlit teaches the fix via the
                  tooltip. */}
              {canPickup && pickupState && (
                <button
                  className={`btn set-transport-btn set-pickup${pickupState.lit ? ' lit' : ''}`}
                  onClick={pickUp}
                  disabled={!pickupState.lit}
                  title={pickupState.message}
                >
                  {'⤴\uFE0E Pick up'}
                </button>
              )}
            </>
          )}
        </span>
        <span className="set-header-actions">
          <button
            className="btn btn-success"
            onClick={() => setAdjacencyPins(setId, autoFillable)}
            disabled={autoFillable.size === 0}
            title={
              autoFillable.size === 0
                ? 'No unresolved adjacency has an unambiguous Transition'
                : 'Pin the proposed Transition on every unresolved adjacency'
            }
          >
            Auto-fill {autoFillable.size > 0 ? `(${autoFillable.size})` : ''}
          </button>
          {/* Suggest (sets 10): ranked candidates to append after the last track */}
          <button
            className="btn btn-primary"
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
          >
            Suggest
          </button>
        </span>
      </div>

      {/* Overview ladder (sets 03; freed in 05): pan/zoom minimap with
          click-to-seek, playhead, and follow-playback paging. During an
          in-pane row drag it shows the HYPOTHETICAL order's plan with
          each affected adjacency's future marked (sets 07). */}
      {plan && trackMap && plan.entries.length > 0 && (
        <OverviewLadder
          key={setId}
          setId={setId}
          plan={previewOrder && previewPlan ? previewPlan : plan}
          previewFutures={previewOrder && previewPlan ? previewFutures : undefined}
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
        onClick={(e) => {
          // Empty-space click clears the selection (sets 18). Clicks on
          // rows (track or adjacency) are theirs — only the bare pane
          // beneath/between counts as empty space.
          if ((e.target as HTMLElement).closest('[data-set-track-row], [data-set-adjacency-row]')) {
            return;
          }
          if (getSetSelection(setId).ids.length > 0) {
            setSetSelection(setId, EMPTY_SELECTION);
          }
        }}
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

        {displayEntries === undefined ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>Loading…</div>
        ) : displayEntries.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>
            Empty set — drag tracks onto the set&apos;s sidebar row to add them.
          </div>
        ) : (
          displayEntries.map((entry, i) => {
            const track = trackMap?.get(entry.trackId);
            const next = displayEntries[i + 1];
            const planned = displayPlan?.entries[i];
            return (
              <div key={entry.trackId}>
                <SetTrackRow
                  index={i}
                  trackId={entry.trackId}
                  track={track}
                  planned={planned}
                  bpmRef={bpmRefFor(i)}
                  loadedOn={loadedDecks(entry.trackId, occupancy)}
                  playing={isRowPlaying(entry.trackId, occupancy)}
                  selected={selectedIds.has(entry.trackId)}
                  dragging={dragIds?.includes(entry.trackId) ?? false}
                  onSelect={(mods) => handleRowSelect(entry.trackId, mods)}
                  onDragStart={(e) => {
                    // Group drag (sets 18): the whole selection when the
                    // row is in it, in set order.
                    const ids = selectAndGetDragIds(entry.trackId);
                    setTrackDragPayload(e.dataTransfer, ids, 'set-pane');
                    dragIdsRef.current = ids;
                    setDragIds(ids);
                  }}
                  onDragEnd={() => {
                    // Fires after drop AND on cancel (Esc / drop outside):
                    // either way the hypothesis is over.
                    dragIdsRef.current = null;
                    setDragIds(null);
                    setPreviewOrder(null);
                  }}
                  onPlayFrom={plan ? () => playFromEntry(i) : undefined}
                  onRemove={() => removeTracksFromSet(setId, [entry.trackId])}
                  onContextMenu={
                    track
                      ? (e) => {
                          e.preventDefault();
                          // Standard: right-click outside the selection
                          // selects the row (sets 18) — the menu then
                          // targets exactly the highlighted rows.
                          const sel = getSetSelection(setId);
                          if (!sel.ids.includes(track.id)) {
                            setSetSelection(setId, click(sel, track.id));
                          }
                          openRowMenu(e.clientX, e.clientY, track);
                        }
                      : undefined
                  }
                />
                {next && (
                  <AdjacencyRow
                    pin={entry.pin}
                    planned={displayPlan?.adjacencies[i]}
                    future={previewOrder ? (previewFutures?.[i] ?? null) : null}
                    decks={
                      planned && displayPlan?.entries[i + 1]
                        ? { outgoing: planned.deck, incoming: displayPlan.entries[i + 1].deck }
                        : undefined
                    }
                    evidence={pairEvidence(entry.trackId, next.trackId)}
                    warnings={displayPlan?.warnings.filter((w) => w.adjacencyIndex === i)}
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

/**
 * Both decks' live occupancy slices (sets 35), off the shared engines.
 * Primitive selectors per useSyncExternalStore rules (a fresh object
 * every read would loop); the map itself is memoized on the slices, so
 * the pane re-renders only on load / play / pause — not per tick.
 */
function useEngineSlice<T>(engine: DeckEngine, selector: (s: DeckSnapshot) => T): T {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => selector(engine.getSnapshot())
  );
}

function useDeckOccupancy(decks: Record<ChannelId, DeckContextValue>): DeckOccupancyMap {
  const aTrackId = useEngineSlice(decks.A.engine, (s) => s.trackId);
  const aPlaying = useEngineSlice(decks.A.engine, (s) => s.playing);
  const bTrackId = useEngineSlice(decks.B.engine, (s) => s.trackId);
  const bPlaying = useEngineSlice(decks.B.engine, (s) => s.playing);
  return useMemo(
    () => ({
      A: { trackId: aTrackId, playing: aPlaying },
      B: { trackId: bTrackId, playing: bPlaying },
    }),
    [aTrackId, aPlaying, bTrackId, bPlaying]
  );
}

/** Pin-chip look per resolved status (sets 20): an UNRESOLVED
 * adjacency's "✕ hard cut" chip itself turns red — there is no separate
 * UNRESOLVED badge. Red keys off pin state, never the name: a pinned
 * Transition NAMED "hard cut" keeps the normal green chip. The style
 * rides inline on a .set-chip-btn (perf-layout 08): accent text
 * throughout — red text (bold), not a red fill, for unresolved (22
 * follow-up: a fill per hard cut is too loud on a fresh set). */
function pinChip(view: ReturnType<typeof adjacencyView>): {
  text: string;
  style: React.CSSProperties;
  title: string;
} {
  if (view.status === 'transition') {
    const star = view.transition!.favorite ? '★ ' : '';
    return {
      text: `◆ ${star}${view.transition!.name}`,
      style: { color: 'var(--green)' },
      title: 'Pin a transition or take for this handover',
    };
  }
  if (view.status === 'take') {
    const date = new Date(view.take!.detectedAt).toLocaleDateString();
    return {
      text: `● take · ${date} (unpromoted)`,
      style: { color: 'var(--mauve)' },
      title: 'Pin a transition or take for this handover',
    };
  }
  return {
    text: '✕ hard cut',
    style: { color: 'var(--red)' },
    title: 'Unresolved — will hard-cut. Pin a transition or take for this handover',
  };
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
  'entry-after-exit': 'never audible',
};

function AdjacencyRow({
  pin,
  planned,
  future,
  decks,
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
  /** This handover's slice of the playback plan (sets 32): the overlap
   * cell renders its window span. Absent while the plan is loading. */
  planned?: PlannedAdjacency;
  /** This adjacency's future under a live drag preview (sets 23):
   * 'will-restore' grows the violet ↺ marker beside the (already
   * restored) pin chip; auto-fillable/unresolved render through the
   * ordinary machinery (proposal button, red hard-cut chip); null when
   * unaffected or not previewing. */
  future?: AdjacencyFuture | null;
  /** The planned decks either side of the handover (sets 20): the left
   * accent bar renders their gradient, outgoing on top — direction
   * follows the actual deck parity. Absent while the plan is loading. */
  decks?: { outgoing: ChannelId; incoming: ChannelId };
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

  // Left-gutter geometry: the chips start at the same x as the track-row
  // titles — driven by the shared column grid (sets 31, rowColumns.ts;
  // replaces sets 20's hand-derived 58px).
  // The two-deck gradient bar (sets 20): outgoing deck's color on top,
  // incoming below — the handover visually ties to its tracks. Painted
  // as a background-image layer (geometry in the CSS) so the CSS hover
  // wash composes beneath it.
  const barImage = decks
    ? `linear-gradient(180deg, ${DECK_COLORS[decks.outgoing]}, ${DECK_COLORS[decks.incoming]})`
    : undefined;

  return (
    <>
      <div
        data-set-adjacency-row
        className="set-adjacency-row"
        onClick={onOpenEditor}
        title="Open this handover in the Transition editor"
        style={{
          // Geometry from the shared column grid (sets 31, rowColumns.ts)
          gap: `${ADJ_ROW_GAP}px`,
          padding: `2px ${ROW_PAD_X}px 2px ${ADJ_PAD_LEFT}px`,
          backgroundImage: barImage,
        }}
      >
        {/* Left gutter: the insert affordance as a small + (sets 20 —
            the old labeled button's verb rides the tooltip), sitting
            under the track rows' play-button column. */}
        <span style={{ width: `${ADJ_GUTTER_W}px`, flexShrink: 0, display: 'flex' }}>
          {onSuggestInsert && (
            <button
              className="set-glyph-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSuggestInsert(e.clientX, e.clientY);
              }}
              title="Suggest a track to insert here, ranked by the weaker of the two edges"
              style={{
                width: '18px',
                color: 'var(--blue)',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              +
            </button>
          )}
        </span>

        {/* Pin chip — click opens the manual pin picker. Unresolved
            turns the chip's text red + bold (sets 20, softened in the
            22 follow-up): the one hard-cut signal. */}
        <button
          className="set-chip-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuPos({ x: e.clientX, y: e.clientY });
          }}
          title={chip.title}
          style={{
            ...chip.style,
            fontWeight: view.status === 'unresolved' ? 600 : undefined,
          }}
        >
          {chip.text}
        </button>

        {/* WILL-RESTORE marker (sets 23, the 07 vocabulary): this pair's
            Dormant pin wakes if the drop commits — the chip above already
            shows the restored pin; the violet ↺ says it's a restoration. */}
        {future === 'will-restore' && (
          <span
            title="Dropping here restores this pair's Dormant pin"
            style={{
              padding: '1px 6px',
              border: `1px solid ${WILL_RESTORE_COLOR}`,
              color: WILL_RESTORE_COLOR,
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            ↺ will restore
          </span>
        )}

        {/* Edit (sets 20): the sketch-it verb made visible — delegates
            to the row click-through (sets 09). Practice = mix it live.
            Icon-only, uncolored (22 follow-up): ⋈ is the Transition
            editor's own icon (TopBar); the verbs ride the tooltips. */}
        <button
          className="set-chip-btn set-icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenEditor();
          }}
          title="Open this handover in the Transition editor"
        >
          ⋈
        </button>

        {/* Practice (sets 13): the mix-it-live verb — outgoing cued on A
            with a runway, incoming on B; press again to re-cue. Icon-only
            vinyl glyph, uncolored (22 follow-up). */}
        {onPractice && (
          <button
            className="set-chip-btn set-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPractice();
            }}
            title="Practice this handover: cue outgoing on deck A (with a runway), incoming on deck B — press again to re-cue"
          >
            ◉
          </button>
        )}

        {/* One-click auto-fill accept (Transitions only, favorite first) */}
        {proposal && view.status === 'unresolved' && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPin({ kind: 'transition', uuid: proposal.uuid });
            }}
            title="Pin the proposed Transition"
            style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
          >
            ↳ pin {proposal.favorite ? '★ ' : ''}{proposal.name}
          </button>
        )}

        {/* Fresh-Take offer (sets 13): the latest just-captured Take for
            this pair — one click pins it (never auto-pinned). */}
        {freshTake && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPinFreshTake(freshTake.uuid);
            }}
            title="A Take was just captured for this handover — pin it"
            style={{ borderColor: 'var(--mauve)', color: 'var(--mauve)', fontWeight: 600 }}
          >
            ● new take — pin?
          </button>
        )}

        {/* Unpracticed marker (orthogonal to resolution; the old
            UNRESOLVED badge merged into the red hard-cut chip, sets 20).
            A quiet ⚠ glyph — the shouty yellow badge was noise at scale
            (22 follow-up); the teaching rides the tooltip. */}
        {view.unpracticed && (
          <span
            title="Unpracticed — this pair has never been mixed: no saved Transition and no Take. ⏵ practice cues it on the decks"
            style={{ color: 'var(--yellow)', fontWeight: 700, cursor: 'help' }}
          >
            ⚠
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

        {/* Overlap time (sets 32): the planned window's span, sitting in
            the track rows' time-column band (the play-time column) so
            the list reads as one table. Hard cuts render blank — the
            red hard-cut chip carries that message. */}
        <span
          title="How long this handover overlaps (the planned window on the mix clock)"
          style={{ ...cellStyle(PLAY_TIME_COL_W), textAlign: 'right', color: 'var(--subtext0)' }}
        >
          {fmtOverlapTime(planned)}
        </span>
        <span style={{ width: `${ADJ_TIME_SPACER_W}px`, flexShrink: 0 }} />
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
  bpmRef,
  loadedOn,
  playing,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onPlayFrom,
  onRemove,
  onContextMenu,
}: {
  index: number;
  trackId: number;
  track: Track | undefined;
  /** This entry's slice of the playback plan (sets 03). */
  planned: PlannedEntry | undefined;
  /** The BPM the delta color is measured against (sets 31): the Set
   * tempo under Fixed, the predecessor's BPM under Riding; null when
   * there is no reference (first row under Riding, missing BPMs). */
  bpmRef: BpmDeltaRef | null;
  /** The Decks currently holding this track (sets 35: LIVE occupancy,
   * not plan parity) — the row wears the holding deck's identity wash;
   * both at once when both decks hold Set tracks. */
  loadedOn: ChannelId[];
  /** A deck holding this track is playing (sets 35): the deck-neutral
   * animated EQ-bars STATE mark. Paused-but-loaded keeps the wash only. */
  playing: boolean;
  /** In the pane's row selection (sets 18): blue wash + inset blue ring.
   * Coexists with the loaded wash — when both, the identity wash keeps
   * the background and the ring marks the selection. */
  selected: boolean;
  /** This row is the drag source (sets 23) — dimmed, sortable-style,
   * wherever it currently displays (its hypothetical slot mid-preview,
   * its committed one when the pointer is back over it). */
  dragging: boolean;
  /** Selection gestures (sets 18): plain / shift-range / cmd-toggle. */
  onSelect: (mods: { shift: boolean; toggle: boolean }) => void;
  /** Row drag lifecycle (sets 07): the pane sets the drag payload and
   * tracks the dragged ids for the ladder's live preview. */
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** Row play button: start Set playback at this track's planned entry. */
  onPlayFrom: (() => void) | undefined;
  onRemove: () => void;
  /** Right-click: the universal track menu (sets 17); absent while the
   * row's track metadata is still loading. */
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  // Selection and the loaded wash coexist, distinct (sets 18/35): deck
  // identity wash = where the track is loaded, blue = selection; a
  // selected loaded row keeps the identity wash and wears the blue
  // ring. Both are STATES — they sit above the hover wash (perf-layout
  // 08; the wash rides inline, which wins over the CSS hover rule).
  //
  // Column grid (sets 31, geometry in rowColumns.ts):
  //   ▶ · # · in · key · BPM · energy · title/artist · … · play · ✕
  // Key/BPM sit LEFT (fixed widths, values align down the list); key is
  // identity-colored (Camelot hue — the app's key convention), BPM is
  // delta-colored against `bpmRef` with the absolute value as text. The
  // tempo authority is the effective BPM (ADR 0016) — same as the plan.
  const bpm = track ? trackEffectiveBpm(track) : null;
  const deltaColor = bpmDeltaColor(bpmDeltaPercent(bpm, bpmRef));
  const keyText = formatKeyDisplay(track?.key ?? null);
  return (
    <div
      // Value = the track id (sets 33: the controller browse target
      // scrolls the selected row into view by it); presence selectors
      // ([data-set-track-row]) keep working for row rects / convergence.
      data-set-track-row={trackId}
      draggable
      className={`set-track-row${selected ? ' selected' : ''}`}
      onClick={(e) => onSelect({ shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu}
      style={{
        // The grid's gap/padding come from the shared constants — the
        // CSS carries the non-geometric treatments only (sets 31).
        gap: `${ROW_GAP}px`,
        padding: `8px ${ROW_PAD_X}px`,
        borderLeft: planned
          ? `${ROW_ACCENT_W}px solid ${DECK_COLORS[planned.deck]}`
          : `${ROW_ACCENT_W}px solid transparent`,
        // Loaded = identity wash (sets 35). Inline wins over the CSS
        // hover wash AND the .selected background — the blue ring still
        // marks selection (the conducting-wash precedent, sets 18).
        background: loadedWash(loadedOn),
        opacity: dragging ? 0.45 : 1,
      }}
    >
      {/* Play column: ▶ play-from reveals on hover (sets 20); at rest a
          PLAYING row shows the deck-neutral EQ bars here instead — the
          hover swaps state mark → affordance (the Spotify idiom;
          flagged on perf-layout 08 rather than forked silently). The
          mark only yields when the ▶ actually appears — a plan-less
          row keeps its playing mark under the pointer. */}
      <span
        style={{
          position: 'relative',
          width: `${PLAY_COL_W}px`,
          flexShrink: 0,
          display: 'flex',
        }}
      >
        <button
          className="set-glyph-btn set-row-reveal"
          onClick={(e) => {
            e.stopPropagation(); // never doubles as a selection click
            onPlayFrom?.();
          }}
          disabled={!onPlayFrom}
          title="Play the set from this track's planned entry"
          style={{
            width: `${PLAY_COL_W}px`,
            color: 'var(--mauve)',
            // Inline wins over the row-hover reveal while there is no plan
            ...(onPlayFrom ? undefined : { visibility: 'hidden' as const }),
          }}
        >
          ▶
        </button>
        {playing && (
          <span
            className={`set-playing-mark${onPlayFrom ? ' set-mark-yields-to-hover' : ''}`}
            title="Playing"
            aria-label="playing"
          >
            <span />
            <span />
            <span />
          </span>
        )}
      </span>
      <span style={{ ...cellStyle(INDEX_COL_W), textAlign: 'right', color: 'var(--subtext0)' }}>
        {index + 1}
      </span>
      {/* "in" rides next to the play order (review iteration): # and in
          together read as the running order against the mix clock. */}
      <span
        title="When this track enters the mix (mix clock)"
        style={{ ...cellStyle(IN_TIME_COL_W), textAlign: 'right', color: 'var(--subtext0)' }}
      >
        {fmtInTime(planned)}
      </span>
      {/* Right-aligned like its numeric neighbors: a left-aligned key
          stacks its slack against the BPM's (right-aligned) slack and
          the pair reads as a gulf. */}
      <span
        style={{
          ...cellStyle(KEY_COL_W),
          textAlign: 'right',
          fontWeight: 500,
          color: getKeyColor(keyText) ?? 'var(--subtext1)',
        }}
      >
        {keyText}
      </span>
      <span
        title={bpmDeltaTitle(bpm, bpmRef)}
        style={{
          ...cellStyle(BPM_COL_W),
          textAlign: 'right',
          color: deltaColor ?? 'var(--subtext1)',
        }}
      >
        {bpm ? bpm.toFixed(1) : '—'}
      </span>
      {/* Energy (review iteration): the library's energy circle, same
          key→BPM→energy order as the track table; blank when unrated. */}
      <span
        className="set-energy-cell"
        style={{ ...cellStyle(ENERGY_COL_W), display: 'flex', justifyContent: 'center' }}
      >
        {track?.energy ? <EnergySquare level={track.energy} filled showNumber /> : null}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text)' }}>{track?.title ?? `Track ${trackId}`}</span>
        {track?.artist && (
          <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>{track.artist}</span>
        )}
        {track?.archived_at != null && <ArchivedTrackRowMark />}
      </span>
      {/* NEVER AUDIBLE (sets 19): the badge carries the signal; both
          time cells go blank (rowColumns blanks them). */}
      <NeverAudibleBadge planned={planned} />
      {/* Play-time column (sets 31): the audible span over the track
          length ("in" sits left, beside the play order). */}
      <span
        title="How long this track is audible, over its full length"
        style={{ ...cellStyle(PLAY_TIME_COL_W), textAlign: 'right', color: 'var(--subtext0)' }}
      >
        {fmtPlayTime(planned, track?.duration_secs)}
      </span>
      <button
        className="set-glyph-btn set-row-reveal"
        onClick={(e) => {
          e.stopPropagation(); // never doubles as a selection click
          onRemove();
        }}
        title="Remove from set"
        style={{ width: `${REMOVE_COL_W}px`, flexShrink: 0, padding: '2px 0', color: 'var(--red)' }}
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
        className="set-chip-btn set-header-chip"
        onClick={() => setOpen((o) => !o)}
        title="Tempo policy: Riding eases each track back to its native tempo; Fixed pitches the whole set to one BPM"
        style={{ color: fixed ? 'var(--peach)' : 'var(--sapphire)' }}
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
          {/* The active policy = engaged: solid accent fill pinned
              inline across hover/press (perf-layout 08). */}
          <button
            className="set-tempo-option"
            onClick={() => {
              if (fixed) patch({ tempo_policy: 'riding' });
              setOpen(false);
            }}
            style={
              !fixed
                ? {
                    background: 'var(--sapphire)',
                    borderColor: 'var(--sapphire)',
                    color: 'var(--base)',
                  }
                : undefined
            }
          >
            Riding — tracks return to native tempo between handovers
          </button>
          <button
            className="set-tempo-option"
            onClick={() => {
              if (!fixed) {
                patch({ tempo_policy: 'fixed', set_tempo_bpm: set.set_tempo_bpm ?? defaultBpm });
              }
            }}
            style={
              fixed
                ? {
                    background: 'var(--peach)',
                    borderColor: 'var(--peach)',
                    color: 'var(--base)',
                  }
                : undefined
            }
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
            className="set-glyph-btn"
            onClick={() => setOpen(false)}
            style={{ padding: '2px 8px', color: 'var(--subtext0)', alignSelf: 'flex-end' }}
          >
            close
          </button>
        </div>
      )}
    </span>
  );
}
