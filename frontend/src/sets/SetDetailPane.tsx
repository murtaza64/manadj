/**
 * The Set detail pane (sets 01+02): replaces the track table on the
 * browse surface when a Set is selected. Ordered track rows on a shared
 * column grid (sets 31, rowColumns.ts: ▶ · # · in · trim · key · BPM · energy ·
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
 * Takes also arrive in bulk via Resolve from evidence (sets #163): a
 * previewed, one-confirm gesture pinning the best Take on every
 * Unresolved adjacency — the confirmed bulk gesture is itself the
 * explicit act ADR 0023 requires (glossary amendment 2026-08-24).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SetRowWire, type TakeRowWire } from '../api/client';
import { useDecks } from '../hooks/useDeck';
import { useDeckOccupancy } from '../hooks/useDeckOccupancy';
import { useMixer } from '../hooks/useMixer';
import { DECK_COLORS } from '../theme/deckColors';
import type { Track } from '../types';
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
import ContextMenu, { useContextMenuState } from '../components/ContextMenu';
import EnergySquare from '../components/EnergySquare';
import { useTrackMenuItems } from '../components/useTrackMenuItems';
import type { ChannelId } from '../playback/mixer';
import {
  initTransitionStore,
  snapshotPairStore,
  subscribePairStore,
  type PairStore,
} from '../editor/pairStore';
import { requestPairEdit } from '../editor/openPair';
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
  resolveFromEvidence,
  resolveTransition,
  routineCoverage,
  routineOfferable,
  type AdjacencyPin,
  type RoutineCoverage,
  type TakeEvidence,
  type TransitionEvidence,
} from './adjacency';
import PinPickerPanel, { ROUTINE_COLOR } from './PinPickerPanel';
import { getRoutineCast, primeRoutineCasts } from './routineCasts';
import ResolveFromEvidenceModal from './ResolveFromEvidenceModal';
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
import { isLadderShown, subscribeLadderShown, toggleLadderShown } from './ladderVisibilityStore';
import { OverviewLadder } from './OverviewLadder';
import { evaluatePickup, readPickupSnapshot } from './pickup';
import {
  fmtSec,
  trackEffectiveBpm,
  type PlannedAdjacency,
  type PlannedEntry,
  type PlanWarning,
  type SetPlan,
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
  fmtTrimDb,
  IN_TIME_COL_W,
  INDEX_COL_W,
  KEY_COL_W,
  PLAY_COL_W,
  PLAY_TIME_COL_W,
  REMOVE_COL_W,
  ROW_ACCENT_W,
  ROW_GAP,
  ROW_PAD_X,
  TRIM_COL_W,
  trimOffsetDb,
  trimOffsetFromDb,
  type BpmDeltaRef,
} from './rowColumns';
import {
  isRowPlaying,
  loadedDecks,
  loadedWash,
  type DeckOccupancyMap,
} from './rowMarks';
import { prefetchTrackBuffer } from './prefetch';
import { hotCue1Sec, useSetHotCues, useSetPlan } from './useSetPlan';
import { useSetSettings } from './setSettings';
import {
  addTracksToSet,
  ensureSetEntriesLoaded,
  getSetScroll,
  getSetSelection,
  insertTrackIntoSet,
  pinRoutine,
  removeTracksFromSet,
  reorderSetEntries,
  setAdjacencyPin,
  setAdjacencyPins,
  setEntryTrim,
  setSetScroll,
  toggleCameoPin,
  unpinRoutine,
  setSetSelection,
  useSetDormantPins,
  useSetEntries,
  useSetSelection,
} from './setStore';
import SetSuggestions, { type SuggestTarget } from './SetSuggestions';
import { ArchivedTrackFlag, ArchivedTrackRowMark } from './archivedFlag';
import './SetDetailPane.css';

const EMPTY_EVIDENCE: { transitions: TransitionEvidence[]; takes: TakeEvidence[] } = {
  transitions: [],
  takes: [],
};

/** Evidence for one ordered pair (sets 02): the pair store's Transitions
 * + the Take history's rows. Pure — the pane memoizes a per-adjacency
 * list from it (issue 42), and the stable event handlers call it against
 * imperative snapshots. */
function buildPairEvidence(
  pairStore: PairStore,
  takes: TakeRowWire[],
  a: number,
  b: number
): { transitions: TransitionEvidence[]; takes: TakeEvidence[] } {
  const transitions: TransitionEvidence[] = (pairStore[`${a}:${b}`]?.items ?? []).map((it) => ({
    uuid: it.uuid,
    name: it.name,
    favorite: it.favorite ?? false,
    updatedAtMs: it.updatedAtMs,
  }));
  const pairTakes: TakeEvidence[] = takes
    .filter((t) => t.a_track_id === a && t.b_track_id === b)
    .map((t) => ({
      uuid: t.uuid,
      detectedAt: t.detected_at,
      windowS: t.window_end_s - t.window_start_s,
    }));
  return { transitions, takes: pairTakes };
}

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
  // Live entries for the identity-stable handlers (issue 42; the
  // useTrackSelection ref pattern — handlers feed memoized rows).
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
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
  // Timeline visibility (sets #161): global layout intent, #68 idiom.
  const ladderShown = useSyncExternalStore(subscribeLadderShown, isLadderShown);

  // Latest takes for event-time reads by the identity-stable handlers
  // (the useTrackSelection ref pattern — issue 42).
  const takesRef = useRef(takes);
  takesRef.current = takes;

  // ── Cameos (#140) ────────────────────────────────────────────────────
  // Saved Cameos feed the picker's ornament section (hosted by the head
  // entry); Cameo Takes are the guest-kind rows of the takes query above.
  const { data: cameoRows = [] } = useQuery({ queryKey: ['cameos'], queryFn: api.cameos.list });

  // ── Routines (sets 160, ADR 0035) ────────────────────────────────────
  // Saved Routines + Routine Takes: coverage (cast bracket, shadowing),
  // the per-adjacency "routine available" hint, and the picker's top two
  // trust tiers. Casts prime the module cache dormancy reconciliation
  // reads (reorder liveness is boundary + membership, setStore).
  const { data: routineRows = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: api.routines.list,
  });
  const { data: routineTakeRows = [] } = useQuery({
    queryKey: ['routine-takes'],
    queryFn: api.routineTakes.list,
  });
  useEffect(() => {
    primeRoutineCasts(routineRows);
  }, [routineRows]);
  const castOf = useCallback(
    (uuid: string) => routineRows.find((r) => r.uuid === uuid)?.cast ?? getRoutineCast(uuid),
    [routineRows]
  );

  // Adjacency click-through (sets 09): route by RESOLVED pin kind — a
  // Transition (pinned or auto-resolved, sets 26) opens the editor with
  // that Transition selected, a Take pin opens for review on the loaded
  // pair (gh#167 — Take pins ride the pair path now, so set context
  // travels with them), a cut (hard-cut pin, or no evidence) opens a
  // blank sketch for the pair. The request rides a window event; App
  // flips the mode; the mounted editor consumes it — this pane's state
  // (set store) survives the switch untouched. setContext arms the
  // editor's evidence cycler pin-follow (gh#167).
  // Identity-stable (issue 42): a prop on ~87 memoized adjacency rows.
  const openAdjacencyEditor = useCallback(
    (aTrackId: number, bTrackId: number, pin: AdjacencyPin | null) => {
      const { transitions, takes: pairTakes } = buildPairEvidence(
        snapshotPairStore(),
        takesRef.current,
        aTrackId,
        bTrackId
      );
      const view = adjacencyView(pin, transitions, pairTakes);
      // Routine pins have no editor click-through yet (replay/review is
      // sets #159; the future Routine editor generalizes the kind-aware
      // Transition editor). Takes ride requestPairEdit's takeUuid — the
      // unified evidence switcher (mix-editor #167).
      if (view.status === 'routine') return;
      requestPairEdit({
        aTrackId,
        bTrackId,
        transitionUuid: view.status === 'transition' ? view.transition!.uuid : null,
        takeUuid: view.status === 'take' ? view.take!.uuid : null,
        setContext: { setId, headTrackId: aTrackId },
      });
    },
    [setId]
  );

  // Set-wide auto-fill (role shrunk by sets 26): one click FREEZES every
  // auto-resolved choice as a pin — playback already plays these; pinning
  // detaches them from the library's evolution. Existing pins are never
  // overwritten.
  // Coverage over the COMMITTED entries (sets 160): the bulk gestures
  // (auto-fill, Resolve from evidence) skip Routine-covered adjacencies
  // — the Routine owns those handovers; shadowed pins stay shadowed.
  const entryCoverage = useMemo(
    () => routineCoverage(entries ?? [], castOf),
    [entries, castOf]
  );

  const autoFillable = useMemo(() => {
    const fillable = new Map<number, AdjacencyPin>();
    if (entries) {
      for (let i = 0; i < entries.length - 1; i++) {
        if (entries[i].pin !== null || entryCoverage[i]) continue;
        const { transitions } = buildPairEvidence(
          pairStore,
          takes,
          entries[i].trackId,
          entries[i + 1].trackId
        );
        const resolved = resolveTransition(transitions);
        if (resolved) fillable.set(entries[i].trackId, { kind: 'transition', uuid: resolved.uuid });
      }
    }
    return fillable;
  }, [entries, entryCoverage, pairStore, takes]);

  // Resolve from evidence (sets #163): the bulk best-Take proposal for
  // every Unresolved adjacency — previewed in a modal, applied by ONE
  // confirm through setAdjacencyPins (the same primitive auto-fill
  // uses). Pairs that auto-resolve to a Transition are skipped (saved
  // Transitions win — freezing those stays auto-fill's job); existing
  // pins untouched. The confirmed bulk gesture is the explicit act
  // ADR 0023 requires (glossary amendment 2026-08-24).
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const evidenceProposal = useMemo(
    () =>
      resolveFromEvidence(
        entries ?? [],
        (a, b) => buildPairEvidence(pairStore, takes, a, b),
        castOf
      ),
    [entries, pairStore, takes, castOf]
  );

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
  // Stale-while-replanning (#161): the last computed plan, held across
  // the momentary undefined a reorder's fresh evidence query causes —
  // the ladder keeps its frame (and the layout its height) instead of
  // unmounting. Cleared on Set switch (the ref is per mount; the pane
  // remounts per set via the browse host).
  const lastPlanRef = useRef<SetPlan | undefined>(undefined);
  if (plan) lastPlanRef.current = plan;
  const ladderPlan = plan ?? lastPlanRef.current;

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
  // Displayed order for the stable suggest-insert handler (issue 42).
  const displayEntriesRef = useRef(displayEntries);
  displayEntriesRef.current = displayEntries;

  // Routine coverage over the DISPLAYED order (sets 160): drives the cast
  // bracket (covered rows dim under a magenta bracket, interior adjacency
  // rows collapse away, the exit row is marked) and the head's routine
  // pin row. Interior reorder is free (dormancy keys on boundaries +
  // membership), so a live drag inside the bracket keeps the coverage.
  const coverage = useMemo(
    () => routineCoverage(displayEntries ?? [], castOf),
    [displayEntries, castOf]
  );
  // Per ENTRY index: its role inside a cast bracket (null = uncovered).
  const castMarks = useMemo(() => {
    const marks: ('cast' | 'exit' | null)[] = new Array(displayEntries?.length ?? 0).fill(null);
    for (const cov of coverage) {
      if (!cov) continue;
      for (let j = cov.headIndex + 1; j <= cov.lastEntryIndex && j < marks.length; j++) {
        marks[j] = j === cov.lastEntryIndex ? 'exit' : 'cast';
      }
    }
    return marks;
  }, [coverage, displayEntries]);
  // Unconfirmed miner candidates (sets #161 finding 5): fetched once and
  // matched client-side so rows can announce "routines detected" — the
  // picker-only surfacing was too quiet (the human walked past it).
  const { data: candidateRows = [] } = useQuery({
    queryKey: ['routine-candidates', 'all'],
    queryFn: api.routineCandidates.list,
  });
  // Per adjacency index: offerable saved Routines + unpromoted Routine
  // Takes + unconfirmed candidates whose cast matches the next entries
  // (all three picker tiers) — the row highlight counts everything the
  // picker would offer.
  const routineOfferCounts = useMemo(() => {
    if (!displayEntries) return undefined;
    const ids = displayEntries.map((e) => e.trackId);
    const confirmed = new Set(
      routineTakeRows.flatMap((rt) => (rt.origin_candidate_uuid ? [rt.origin_candidate_uuid] : []))
    );
    return displayEntries.map((_, i) => {
      if (i >= displayEntries.length - 1) return 0;
      return (
        routineRows.filter((r) => routineOfferable(ids, i, r.cast)).length +
        routineTakeRows.filter(
          (rt) => rt.promoted_routine_uuid === null && routineOfferable(ids, i, rt.cast)
        ).length +
        candidateRows.filter(
          (c) => !confirmed.has(c.uuid) && routineOfferable(ids, i, c.cast)
        ).length
      );
    });
  }, [displayEntries, routineRows, routineTakeRows, candidateRows]);

  // Dormant-routine hint (#161): a routine pin that went Dormant waits
  // keyed by its BOUNDARY tracks — the head adjacency shows a dimmed
  // chip naming the exit so the restore path is discoverable (dormant
  // pair pins only surface in drag previews; a whole Routine deserves a
  // standing hint).
  const dormantRoutineExitByAdj = useMemo(() => {
    if (!displayEntries || !dormant) return undefined;
    return displayEntries.map((e, i) => {
      if (i >= displayEntries.length - 1) return null;
      const d = dormant.find(
        (x) => x.pin.kind === 'routine' && x.aTrackId === e.trackId
      );
      if (!d) return null;
      const exit = trackMap?.get(d.bTrackId);
      return exit?.title || `Track ${d.bTrackId}`;
    });
  }, [displayEntries, dormant, trackMap]);

  // Pin picker (sets 160, prototype variant P): ONE panel at pane level;
  // rows open it by adjacency index (identity-stable for the row memo).
  const [picker, setPicker] = useState<{ index: number; x: number; y: number } | null>(null);
  const openPicker = useCallback(
    (index: number, x: number, y: number) => setPicker({ index, x, y }),
    []
  );

  // Per-adjacency derived props, memoized (issue 42): fresh objects and
  // filtered arrays per render would defeat the adjacency-row memo —
  // these recompute only when their real inputs change.
  const evidenceList = useMemo(() => {
    if (!displayEntries) return undefined;
    return displayEntries.map((e, i) => {
      const next = displayEntries[i + 1];
      return next
        ? buildPairEvidence(pairStore, takes, e.trackId, next.trackId)
        : { transitions: [], takes: [] };
    });
  }, [displayEntries, pairStore, takes]);
  const warningsByAdj = useMemo(() => {
    if (!displayPlan) return undefined;
    return displayPlan.adjacencies.map((_, i) =>
      displayPlan.warnings.filter((w) => w.adjacencyIndex === i)
    );
  }, [displayPlan]);
  const decksByAdj = useMemo(() => {
    if (!displayPlan) return undefined;
    return displayPlan.adjacencies.map((_, i) => {
      const outgoing = displayPlan.entries[i];
      const incoming = displayPlan.entries[i + 1];
      return outgoing && incoming
        ? { outgoing: outgoing.deck, incoming: incoming.deck }
        : undefined;
    });
  }, [displayPlan]);

  // BPM delta reference (sets 31): under Fixed every row measures against
  // the Set tempo (the planner's own fallback when unset: the first
  // track's effective BPM); under Riding each row measures against its
  // predecessor — resolved against the DISPLAYED order, so a live drag
  // preview colors the hypothetical neighbors. Memoized per-row objects
  // (issue 42): fresh {kind, bpm} literals per render would defeat the
  // row memo.
  const bpmRefs = useMemo<(BpmDeltaRef | null)[] | undefined>(() => {
    if (!displayEntries) return undefined;
    const effectiveBpmOf = (trackId: number): number | null => {
      const t = trackMap?.get(trackId);
      return t ? trackEffectiveBpm(t) : null;
    };
    if (set?.tempo_policy === 'fixed') {
      const bpm =
        set.set_tempo_bpm ??
        (displayEntries.length > 0 ? effectiveBpmOf(displayEntries[0].trackId) : null);
      const fixedRef: BpmDeltaRef | null = bpm ? { kind: 'set-tempo', bpm } : null;
      return displayEntries.map(() => fixedRef);
    }
    return displayEntries.map((_, i) => {
      const prev = displayEntries[i - 1];
      if (!prev) return null; // first row under Riding: no reference
      const bpm = effectiveBpmOf(prev.trackId);
      return bpm ? { kind: 'predecessor', bpm } : null;
    });
  }, [displayEntries, trackMap, set?.tempo_policy, set?.set_tempo_bpm]);

  // Real hot cues for the ladder clips — the same bulk query useSetPlan
  // rides (issue 43: one GET + one resolution for the whole set, and a
  // stable Map identity so the memoized ladder doesn't re-render).
  const { byTrack: hotCuesByTrack } = useSetHotCues(trackIds);

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
  // Everything below reads the live values through refs so the handlers
  // stay identity-stable — they land as props on ~175 memoized rows
  // (issue 42; the useTrackSelection ref pattern).
  const planRef = useRef(plan);
  planRef.current = plan;
  const mixerRef = useRef(mixer);
  mixerRef.current = mixer;
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const conductorAudio = useCallback(
    () => ({
      mixer: mixerRef.current,
      // All four engines: a plan with Routines allocates cast slots
      // across A→B→C→D (routines 159).
      engines: {
        A: decksRef.current.A.engine,
        B: decksRef.current.B.engine,
        C: decksRef.current.C.engine,
        D: decksRef.current.D.engine,
      },
    }),
    []
  );
  const loadTrackOnDeck = useCallback((deck: ChannelId, trackId: number) => {
    // The deck provider's one Load path (ADR 0022); the pane's track
    // map usually already holds the row.
    const known = trackMapRef.current?.get(trackId);
    if (known) decksRef.current[deck].loadTrack(known);
    else void api.tracks.getById(trackId).then((t) => decksRef.current[deck].loadTrack(t));
  }, []);
  // Prefetch one entry ahead (sets 14): warm the decode cache so the
  // handover's deck load is a near-instant cache hit.
  const prefetchTrack = useCallback((trackId: number) => {
    void prefetchTrackBuffer(mixerRef.current, trackId).catch((err) =>
      console.error(`set prefetch failed for track ${trackId}`, err)
    );
  }, []);
  const playFromEntry = useCallback(
    (index: number) => {
      const livePlan = planRef.current;
      if (!livePlan) return;
      startSetPlayback(setId, livePlan, conductorAudio(), loadTrackOnDeck, index, prefetchTrack);
    },
    [setId, conductorAudio, loadTrackOnDeck, prefetchTrack]
  );
  // Ladder click (sets 05): seek — conducting already seeks in place
  // (preserving play/pause); idle starts playing from that instant.
  const seekToMixTime = useCallback(
    (mixTime: number) => {
      const livePlan = planRef.current;
      if (!livePlan) return;
      seekSetPlayback(setId, livePlan, conductorAudio(), loadTrackOnDeck, mixTime, prefetchTrack);
    },
    [setId, conductorAudio, loadTrackOnDeck, prefetchTrack]
  );

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
  const cueDeckAt = useCallback((deck: 'A' | 'B', trackId: number, seconds: number) => {
    pendingCues.current[deck]?.(); // cancel a superseded pending cue
    pendingCues.current[deck] = null;
    const engine = decksRef.current[deck].engine;
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
  }, [loadTrackOnDeck]);

  // The second adjacency verb (issue 09 sketches it; this mixes it live):
  // outgoing→A, incoming→B, cued by the plan when the adjacency is pinned,
  // by the hot-cue fallbacks when unresolved (B at its Hot Cue 1 → track
  // start — the plan's hard-cut entry, sets 19). Stays in this view;
  // the shared surface keeps audibility, so capture stays armed — mixing
  // the pair by hand is exactly what produces the Take.
  // Identity-stable via refs (issue 42) — a prop on the memoized rows.
  const hotCuesByTrackRef = useRef(hotCuesByTrack);
  hotCuesByTrackRef.current = hotCuesByTrack;
  const practiceAdjacency = useCallback(
    (i: number) => {
      const liveEntries = entriesRef.current;
      const liveTrackMap = trackMapRef.current;
      const livePlan = planRef.current;
      const liveHotCues = hotCuesByTrackRef.current;
      if (!liveEntries) return;
      const outgoing = liveEntries[i];
      const incoming = liveEntries[i + 1];
      const outTrack = liveTrackMap?.get(outgoing.trackId);
      const inTrack = incoming ? liveTrackMap?.get(incoming.trackId) : undefined;
      if (!incoming || !outTrack || !inTrack) return;
      // Practicing takes the decks by hand — a running Conductor stands down.
      stopSetPlayback();
      const positions = practiceCuePositions({
        adjacency: livePlan?.adjacencies[i],
        outgoingEntry: livePlan?.entries[i],
        incomingEntry: livePlan?.entries[i + 1],
        outgoingDurationSec: outTrack.duration_secs ?? 0,
        outgoingHotCueSecs: (liveHotCues.get(outgoing.trackId) ?? []).map(
          (c) => c.time_seconds
        ),
        incomingHotCue1Sec: hotCue1Sec(liveHotCues.get(incoming.trackId)),
      });
      cueDeckAt('A', outgoing.trackId, positions.outgoingSec);
      cueDeckAt('B', incoming.trackId, positions.incomingSec);
    },
    [cueDeckAt]
  );

  // ── Transport centering (22 follow-up): the header centers its
  // transport within its OWN width, but the pane sits right of the
  // sidebar — so "centered in the bar" is off-center on screen. CSS
  // can't know the header's viewport offset; measure it and hand the
  // correction to the CSS as a custom property (paint-only transform).
  // CLAMPED to the header's own box (#161): the raw viewport shift used
  // to push the cluster past the header edges, painting OVER neighboring
  // surfaces (the editor's chrome, at narrow widths the left chips).
  // Bounds: never overlap the left cluster, never cross the right
  // cluster; no room at all → shift 0 (the grid cell never overlaps).
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const recenter = () => {
      const rect = header.getBoundingClientRect();
      const desired = window.innerWidth / 2 - (rect.left + rect.width / 2);
      const transport = header.querySelector<HTMLElement>('.set-header-transport');
      const left = header.querySelector<HTMLElement>('.set-header-left');
      const actions = header.querySelector<HTMLElement>('.set-header-actions');
      let shift = desired;
      if (transport) {
        // offset* geometry ignores the transform — stable bounds.
        const tLeft = transport.offsetLeft;
        const tRight = tLeft + transport.offsetWidth;
        const minShift = left ? left.offsetLeft + left.offsetWidth + 8 - tLeft : -tLeft;
        const maxShift = actions
          ? actions.offsetLeft - 8 - tRight
          : header.clientWidth - tRight;
        shift = minShift > maxShift ? 0 : Math.min(maxShift, Math.max(minShift, desired));
      }
      header.style.setProperty('--transport-viewport-shift', `${shift}px`);
    };
    recenter();
    // The observer catches sidebar resizes and window resizes alike
    // (both change the header's box); the clusters are observed too —
    // their widths move the clamp bounds without changing the header
    // box (Pick up appearing, chip counts). A plain resize listener
    // backstops pure offset changes.
    const observer = new ResizeObserver(recenter);
    observer.observe(header);
    for (const el of header.querySelectorAll(
      '.set-header-transport, .set-header-left, .set-header-actions'
    )) {
      observer.observe(el);
    }
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
  // Identity-stable (issue 42): props on ~88 memoized track rows; live
  // state comes through refs / imperative store reads.
  const handleRowSelect = useCallback(
    (trackId: number, mods: SelectMods) => {
      const liveEntries = entriesRef.current;
      if (!liveEntries) return;
      const sel = getSetSelection(setId);
      setSetSelection(
        setId,
        selectGesture(sel, trackId, mods, liveEntries.map((e) => e.trackId))
      );
    },
    [setId]
  );
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
  const selectAndGetDragIds = useCallback(
    (trackId: number): number[] => {
      const sel = getSetSelection(setId);
      const liveEntries = entriesRef.current;
      if (sel.ids.includes(trackId) && liveEntries) {
        const member = new Set(sel.ids);
        return liveEntries.filter((e) => member.has(e.trackId)).map((e) => e.trackId);
      }
      setSetSelection(setId, click(sel, trackId));
      return [trackId];
    },
    [setId]
  );

  // Row drag lifecycle (sets 07/23), row remove, context menu, and the
  // adjacency verbs — all identity-stable for the row memo (issue 42).
  const handleRowDragStart = useCallback(
    (e: React.DragEvent, trackId: number) => {
      // Group drag (sets 18): the whole selection when the row is in it,
      // in set order.
      const ids = selectAndGetDragIds(trackId);
      setTrackDragPayload(e.dataTransfer, ids, 'set-pane');
      dragIdsRef.current = ids;
      setDragIds(ids);
    },
    [selectAndGetDragIds]
  );
  const handleRowDragEnd = useCallback(() => {
    // Fires after drop AND on cancel (Esc / drop outside): either way
    // the hypothesis is over.
    dragIdsRef.current = null;
    setDragIds(null);
    setPreviewOrder(null);
  }, []);
  const handleRemoveRow = useCallback(
    (trackId: number) => removeTracksFromSet(setId, [trackId]),
    [setId]
  );
  const handleTrimChange = useCallback(
    (trackId: number, trim: number, commit: boolean) =>
      setEntryTrim(setId, trackId, trim, { commit }),
    [setId]
  );
  const handlePin = useCallback(
    (aTrackId: number, pin: AdjacencyPin | null) => setAdjacencyPin(setId, aTrackId, pin),
    [setId]
  );
  const handlePinFreshTake = useCallback(
    (aTrackId: number, bTrackId: number, uuid: string) => {
      setAdjacencyPin(setId, aTrackId, { kind: 'take', uuid });
      clearFreshTake(aTrackId, bTrackId);
    },
    [setId]
  );
  // Open insert suggestions for the adjacency above displayed index
  // `insertIndex` (sets 10) — resolved against the DISPLAYED order.
  const handleSuggestInsert = useCallback((insertIndex: number, x: number, y: number) => {
    const list = displayEntriesRef.current;
    const liveTrackMap = trackMapRef.current;
    const pred = list?.[insertIndex - 1];
    const succ = list?.[insertIndex];
    const predecessor = pred ? liveTrackMap?.get(pred.trackId) : undefined;
    const successor = succ ? liveTrackMap?.get(succ.trackId) : undefined;
    if (!predecessor || !successor) return;
    setSuggest({ x, y, target: { kind: 'insert', predecessor, successor, insertIndex } });
  }, []);

  // ── Controller browse target (sets 33): the Set pane implements the
  // library's browse-surface contract (midi-controller 05) instead of
  // inventing a parallel one. The embedding Library YIELDS its own
  // registration while a Set is the visible browse list (stack order
  // alone can't be trusted: child effects run before parent effects),
  // so the encoder walks THIS list and the LOAD controls load THIS
  // selection — through the same view policy as the on-screen paths (the
  // onLoadToDeck prop IS Library's loadWithViewPolicy). Encoder select
  // ≡ click select: one selection
  // model (the set store) that 17's menu and 18's ops already read; the
  // encoder walks tracks only (adjacency rows have no selection —
  // pointer/keyboard territory). Handlers read live state through refs;
  // registration is mount-scoped per set.
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
  // Identity-stable (issue 42): openMenu is stable by contract; selection
  // is read imperatively.
  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, track: Track) => {
      e.preventDefault();
      // Standard: right-click outside the selection selects the row
      // (sets 18) — the menu then targets exactly the highlighted rows.
      const sel = getSetSelection(setId);
      if (!sel.ids.includes(track.id)) {
        setSetSelection(setId, click(sel, track.id));
      }
      openRowMenu(e.clientX, e.clientY, track);
    },
    [setId, openRowMenu]
  );
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
          {/* Timeline toggle (sets #161): show/hide the overview ladder —
              the entry list reclaims the height. View-only: the plan and
              the Conductor never read visibility (playback runs the same
              hidden). Persisted globally, the #68 toggle idiom. */}
          <button
            className={`btn set-transport-btn set-ladder-toggle${ladderShown ? ' on' : ''}`}
            onClick={toggleLadderShown}
            title={
              ladderShown
                ? 'Hide the set timeline (the entry list takes the height)'
                : 'Show the set timeline'
            }
            style={ladderShown ? undefined : { opacity: 0.6 }}
          >
            {'▤\uFE0E'}
          </button>
        </span>
        <span className="set-header-actions">
          <button
            className="btn btn-success"
            onClick={() => setAdjacencyPins(setId, autoFillable)}
            disabled={autoFillable.size === 0}
            title={
              autoFillable.size === 0
                ? 'No unpinned adjacency auto-resolves to a Transition'
                : 'Freeze every auto-resolved choice as a pin (new saves and favorites will no longer change what plays)'
            }
          >
            Auto-fill {autoFillable.size > 0 ? `(${autoFillable.size})` : ''}
          </button>
          {/* Resolve from evidence (sets #163): opens the preview modal;
              nothing pins until its one confirm. Enabled whenever the
              gesture has anything to say (Takes to pin OR hard-cuts to
              list). */}
          <button
            className="btn"
            onClick={() => setEvidenceModalOpen(true)}
            disabled={evidenceProposal.rows.length === 0 && evidenceProposal.hardCuts.length === 0}
            title={
              evidenceProposal.rows.length === 0 && evidenceProposal.hardCuts.length === 0
                ? 'Every adjacency is pinned or auto-resolves to a Transition'
                : 'Preview pinning the best Take on every Unresolved adjacency (one confirm; chop-Takes flagged, remaining hard-cuts listed)'
            }
            style={
              evidenceProposal.rows.length > 0
                ? { borderColor: 'var(--mauve)', color: 'var(--mauve)' }
                : undefined
            }
          >
            Resolve from evidence{' '}
            {evidenceProposal.rows.length > 0 ? `(${evidenceProposal.rows.length})` : ''}
          </button>
          {/* The header Suggest button moved into the list as the
              trailing suggest row (sets 36): append is an insert at the
              terminal gap, so it gets the gap affordance. */}
        </span>
      </div>

      {/* Overview ladder (sets 03; freed in 05): pan/zoom minimap with
          click-to-seek, playhead, and follow-playback paging. During an
          in-pane row drag it shows the HYPOTHETICAL order's plan with
          each affected adjacency's future marked (sets 07). Hideable
          (sets #161): a pure projection — unmounting it never touches
          the plan or the Conductor. STALE-WHILE-REPLANNING (#161): a
          reorder that mints a fresh evidence query blanks `plan` for a
          beat — unmounting the ladder there collapsed the layout and
          threw the list scroll + ladder viewport away; the last plan
          holds the frame until the new one lands. */}
      {ladderShown && ladderPlan && trackMap && ladderPlan.entries.length > 0 && (
        <OverviewLadder
          key={setId}
          setId={setId}
          plan={previewOrder && previewPlan ? previewPlan : ladderPlan}
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
            // Both tracks' metadata present — gates the affordances that
            // need the pair (practice, suggest-insert), as before.
            const pairReady = !!(track && next && trackMap?.has(next.trackId));
            const cov = coverage[i] ?? null;
            const mark = castMarks[i];
            return (
              <div
                key={entry.trackId}
                // Cast bracket (sets 160, restyled at #161): covered
                // entries keep FULL-opacity titles — the magenta bracket
                // and the cast/exit chips carry the meaning (dimming read
                // as "disabled"; these rows are alive and reorderable —
                // interior reorder is free, dormancy keys on boundaries
                // + membership only).
                style={
                  mark
                    ? {
                        borderLeft: `3px solid ${ROUTINE_COLOR}`,
                        background: 'rgba(255, 0, 200, 0.07)',
                      }
                    : undefined
                }
              >
                <SetTrackRow
                  index={i}
                  trackId={entry.trackId}
                  track={track}
                  planned={displayPlan?.entries[i]}
                  bpmRef={bpmRefs?.[i] ?? null}
                  occupancy={occupancy}
                  selected={selectedIds.has(entry.trackId)}
                  dragging={dragIds?.includes(entry.trackId) ?? false}
                  trim={entry.trim ?? 0}
                  castMark={mark}
                  routineOffer={
                    entry.pin?.kind === 'routine' ? 0 : (routineOfferCounts?.[i] ?? 0)
                  }
                  onOpenRoutinePicker={openPicker}
                  onSelect={handleRowSelect}
                  onDragStart={handleRowDragStart}
                  onDragEnd={handleRowDragEnd}
                  onPlayFrom={plan ? playFromEntry : undefined}
                  onRemove={handleRemoveRow}
                  onTrimChange={handleTrimChange}
                  onContextMenu={track ? handleRowContextMenu : undefined}
                />
                {/* Cameo pins (#140): the entry's guest ornaments — a
                    subordinate line under the host row (never a stair
                    step; the spine stays adjacency-shaped). Click opens
                    the picker on the adjacency this entry heads. */}
                {entry.cameoPins && entry.cameoPins.length > 0 && (
                  <div
                    className="set-cameo-pin-row"
                    title="Cameo pins on this entry — guests play on a free deck inside the host's span; the Set order never advances. Click to edit."
                    onClick={(e) => {
                      e.stopPropagation();
                      openPicker(i, e.clientX, e.clientY);
                    }}
                  >
                    {entry.cameoPins.map((p) => {
                      const guestId =
                        p.kind === 'cameo'
                          ? cameoRows.find((c) => c.uuid === p.uuid)?.guest_track_id
                          : takes.find((t) => t.uuid === p.uuid)?.b_track_id;
                      const guest =
                        guestId !== undefined
                          ? trackMap?.get(guestId)?.title || `Track ${guestId}`
                          : '(deleted)';
                      return (
                        <span key={`${p.kind}:${p.uuid}`} className="set-cameo-pin-chip">
                          ◐ {guest}
                          {p.kind === 'cameo-take' ? ' ▸' : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
                {next &&
                  (cov && cov.headIndex !== i ? null : cov ? ( // covered interior: collapsed
                    <RoutinePinRow
                      index={i}
                      label={routineRowLabel(cov, routineRows, (id) =>
                        trackMap?.get(id)?.title || `Track ${id}`
                      )}
                      coversCount={cov.cast.length - 1}
                      exitLabel={
                        trackMap?.get(cov.cast[cov.cast.length - 1])?.title ||
                        `Track ${cov.cast[cov.cast.length - 1]}`
                      }
                      onOpenPicker={openPicker}
                    />
                  ) : (
                    <AdjacencyRow
                      aTrackId={entry.trackId}
                      bTrackId={next.trackId}
                      index={i}
                      pin={entry.pin}
                      planned={displayPlan?.adjacencies[i]}
                      future={previewOrder ? (previewFutures?.[i] ?? null) : null}
                      decks={decksByAdj?.[i]}
                      evidence={evidenceList?.[i] ?? EMPTY_EVIDENCE}
                      warnings={warningsByAdj?.[i]}
                      routineOffer={routineOfferCounts?.[i] ?? 0}
                      dormantRoutineExit={dormantRoutineExitByAdj?.[i] ?? null}
                      onPin={handlePin}
                      onOpenPicker={openPicker}
                      onOpenEditor={openAdjacencyEditor}
                      onPractice={pairReady ? practiceAdjacency : undefined}
                      freshTake={freshTakeChip(
                        freshTakes,
                        entry.trackId,
                        next.trackId,
                        entry.pin?.uuid ?? null
                      )}
                      onPinFreshTake={handlePinFreshTake}
                      onSuggestInsert={pairReady ? handleSuggestInsert : undefined}
                    />
                  ))}
              </div>
            );
          })
        )}

        {/* Trailing suggest row (sets 36): the terminal gap's affordance
            — the header Suggest button unified into the + insert family
            (append IS an insert at the terminal gap). Permanently
            visible, not hover-revealed: the primary set-building
            affordance. Empty set: disabled, teaching copy inline. */}
        {displayEntries !== undefined && (
          <button
            data-set-suggest-row
            className="set-suggest-row"
            disabled={!lastTrack}
            onClick={(e) => {
              if (!lastTrack) return;
              setSuggest({
                x: e.clientX,
                y: e.clientY,
                target: { kind: 'append', last: lastTrack },
              });
            }}
            title={
              lastTrack
                ? 'Suggest tracks to append, ranked by follow tiering out of the last track'
                : undefined
            }
            style={{ gap: `${ADJ_ROW_GAP}px`, padding: `4px ${ROW_PAD_X}px 4px ${ADJ_PAD_LEFT}px` }}
          >
            {/* + in the insert affordances' gutter column, label beside
                it at the shared title x (rowColumns.ts geometry). */}
            <span
              aria-hidden
              style={{
                width: `${ADJ_GUTTER_W}px`,
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'flex-start',
              }}
            >
              <span style={{ width: '18px', fontSize: '13px', fontWeight: 700 }}>+</span>
            </span>
            <span>
              {displayEntries.length === 0
                ? 'Add a track first — suggestions rank out of the last track'
                : 'suggest a track'}
            </span>
          </button>
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

      {/* Pin picker (sets 160, prototype variant P): one panel, opened
          per adjacency — Routine tiers (saved > Routine Take >
          unconfirmed candidate), Transitions, Takes, Hard cut. */}
      {picker &&
        displayEntries &&
        (() => {
          const head = displayEntries[picker.index];
          const nextEntry = displayEntries[picker.index + 1];
          if (!head || !nextEntry) return null;
          return (
            <PinPickerPanel
              x={picker.x}
              y={picker.y}
              aTrackId={head.trackId}
              bTrackId={nextEntry.trackId}
              pin={head.pin}
              transitions={evidenceList?.[picker.index]?.transitions ?? []}
              takes={evidenceList?.[picker.index]?.takes ?? []}
              upcomingTrackIds={displayEntries.slice(picker.index).map((e) => e.trackId)}
              trackLabel={(id) => trackMap?.get(id)?.title || `Track ${id}`}
              onPin={(pin) => {
                if (head.pin?.kind === 'routine' && pin === null) {
                  // Unpin the Routine: the head's shadowed pin restores
                  // and the covered adjacencies wake (sets 160).
                  unpinRoutine(setId, head.trackId);
                } else {
                  setAdjacencyPin(setId, head.trackId, pin);
                }
              }}
              onPinRoutine={(uuid, cast) => pinRoutine(setId, head.trackId, uuid, cast)}
              cameoEvidence={[
                ...cameoRows
                  .filter((c) => c.host_track_id === head.trackId)
                  .map((c) => ({
                    kind: 'cameo' as const,
                    uuid: c.uuid,
                    label: c.name,
                    guestTrackId: c.guest_track_id,
                    favorite: c.favorite,
                  })),
                ...takes
                  .filter((t) => t.kind === 'guest' && t.a_track_id === head.trackId)
                  .map((t) => ({
                    kind: 'cameo-take' as const,
                    uuid: t.uuid,
                    label: new Date(
                      t.detected_at.endsWith('Z') || t.detected_at.includes('+')
                        ? t.detected_at
                        : `${t.detected_at}Z`
                    ).toLocaleString(),
                    guestTrackId: t.b_track_id,
                    windowS: t.window_end_s - t.window_start_s,
                  })),
              ]}
              cameoPins={head.cameoPins ?? []}
              onToggleCameoPin={(pin) => toggleCameoPin(setId, head.trackId, pin)}
              onClose={() => setPicker(null)}
            />
          );
        })()}

      {/* Resolve from evidence (sets #163): preview diff, one confirm. */}
      {evidenceModalOpen && (
        <ResolveFromEvidenceModal
          preview={evidenceProposal}
          trackLabel={(id) => trackMap?.get(id)?.title || `Track ${id}`}
          onConfirm={() => {
            setAdjacencyPins(setId, evidenceProposal.pins);
            setEvidenceModalOpen(false);
            const chops = evidenceProposal.rows.filter((r) => r.chop).length;
            showToast(
              `Pinned ${evidenceProposal.pins.size} take${
                evidenceProposal.pins.size === 1 ? '' : 's'
              }${chops > 0 ? ` (${chops} chop-flagged)` : ''}${
                evidenceProposal.hardCuts.length > 0
                  ? ` — ${evidenceProposal.hardCuts.length} hard-cut${
                      evidenceProposal.hardCuts.length === 1 ? '' : 's'
                    } remain`
                  : ''
              }`
            );
          }}
          onClose={() => setEvidenceModalOpen(false)}
        />
      )}
    </div>
  );
}

/** Pin-chip look per resolved status (sets 20, revised by 26): the red
 * "✕ hard cut" chip appears exactly when a cut will actually PLAY — no
 * evidence, or an explicit Hard-cut pin. An auto-resolved adjacency
 * (unpinned, sets 26) shows the resolved Transition's chip with a
 * subtle "auto" mark: hollow diamond, dimmer text — visibly not a pin.
 * Red keys off pin state, never the name: a pinned Transition NAMED
 * "hard cut" keeps the normal green chip. The style rides inline on a
 * .set-chip-btn (perf-layout 08): accent text throughout — red text
 * (bold), not a red fill, for cuts (22 follow-up: a fill per hard cut
 * is too loud on a fresh set). */
function pinChip(view: ReturnType<typeof adjacencyView>): {
  text: string;
  style: React.CSSProperties;
  title: string;
} {
  if (view.status === 'transition') {
    const star = view.transition!.favorite ? '★ ' : '';
    if (view.auto) {
      return {
        text: `◇ ${star}${view.transition!.name} · auto`,
        style: { color: 'var(--green)', opacity: 0.75 },
        title:
          'Auto-resolved at plan time (favorite first, else most recently edited) — library-live, ' +
          'not a pin: saving or favoriting a transition for this pair may change what plays. ' +
          'Click to pin a choice.',
      };
    }
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
  if (view.status === 'routine') {
    // Reachable only while the pin's cast is unknown or no longer the
    // next-n entries here (a live routine renders its own row) —
    // reconciliation retires stale pins on the next order change.
    return {
      text: '◆ routine (not offerable here)',
      style: { color: ROUTINE_COLOR, opacity: 0.7 },
      title:
        "A Routine is pinned here but its cast is not this Set's next n entries (or its metadata has not loaded) — it plans as a hard cut. Click to change",
    };
  }
  if (view.status === 'hardcut') {
    return {
      text: '✕ hard cut',
      style: { color: 'var(--red)' },
      title: 'Hard-cut pin — cut here, play no transition (even though some exist). Click to change',
    };
  }
  return {
    text: '✕ hard cut',
    style: { color: 'var(--red)' },
    title: 'No transitions for this pair — will hard-cut. Pin a transition or take for this handover',
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
  'routine-invalid': 'routine pin skipped',
  'routine-window-collision': 'routine window collides',
  'routine-deck-overflow': 'routine out of decks',
  'routine-global-controls-dropped': 'routine crossfader dropped',
  'cameo-invalid': 'cameo pin skipped',
  'cameo-window-collision': 'cameo before host settles',
  'cameo-grace-fade': 'cameo fades early',
  'cameo-deck-overflow': 'cameo out of decks',
};

/** Memoized (issue 42): ~87 of these sit in a big set, and a selection
 * click must not re-render them all. Callbacks are identity-stable and
 * parameterized by the pair (aTrackId/bTrackId/index); object props come
 * from parent-memoized per-adjacency lists. */
const AdjacencyRow = memo(function AdjacencyRow({
  aTrackId,
  bTrackId,
  index,
  pin,
  planned,
  future,
  decks,
  evidence,
  warnings,
  routineOffer,
  dormantRoutineExit,
  onPin,
  onOpenPicker,
  onOpenEditor,
  onPractice,
  freshTake,
  onPinFreshTake,
  onSuggestInsert,
}: {
  /** The ordered pair either side of this handover. */
  aTrackId: number;
  bTrackId: number;
  /** This adjacency's index in the displayed order. */
  index: number;
  pin: AdjacencyPin | null;
  /** This handover's slice of the playback plan (sets 32): the overlap
   * cell renders its window span. Absent while the plan is loading. */
  planned?: PlannedAdjacency;
  /** This adjacency's future under a live drag preview (sets 23):
   * 'will-restore' grows the violet ↺ marker beside the (already
   * restored) pin chip; auto-resolves/unresolved render through the
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
  /** Offerable saved Routines + Routine Takes at this head (sets 160) —
   * the quiet "routine available" hint (candidates stay picker-only). */
  routineOffer: number;
  /** A Dormant ROUTINE pin waits on this head (#161): the exit track's
   * title (restore = make the cast the next entries again); null = none. */
  dormantRoutineExit: string | null;
  onPin: (aTrackId: number, pin: AdjacencyPin | null) => void;
  /** Open the pane-level pin picker panel for this adjacency (sets 160,
   * prototype variant P — replaces the old flat ContextMenu picker). */
  onOpenPicker: (index: number, x: number, y: number) => void;
  /** Click-through (sets 09): open this adjacency in the Transition
   * editor (pin-kind routing lives with the caller). */
  onOpenEditor: (aTrackId: number, bTrackId: number, pin: AdjacencyPin | null) => void;
  /** Practice (sets 13): cue the pair on the decks — re-press re-cues.
   * Absent while the pair's track metadata is still loading. */
  onPractice?: (index: number) => void;
  /** A just-captured Take for this ordered pair (sets 13) — the transient
   * "new take — pin?" offer; null when none (or it's already the pin). */
  freshTake: FreshTake | null;
  onPinFreshTake: (aTrackId: number, bTrackId: number, uuid: string) => void;
  /** Open insert suggestions for this adjacency (sets 10); absent while
   * the pair's track metadata is still loading. */
  onSuggestInsert?: (insertIndex: number, x: number, y: number) => void;
}) {
  const view = adjacencyView(pin, evidence.transitions, evidence.takes);
  const chip = pinChip(view);

  // The manual pin picker is the pane-level PinPickerPanel now (sets
  // 160, prototype variant P): the pair's Transitions AND Takes (never
  // auto-filled — ADR 0023; the carve-outs are the picker, the fresh-
  // Take offer, and Resolve from evidence, sets #163), the offerable
  // Routine tiers, the explicit Hard-cut pin, and Unpin.

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
        onClick={() => onOpenEditor(aTrackId, bTrackId, pin)}
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
                onSuggestInsert(index + 1, e.clientX, e.clientY);
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

        {/* Pin chip — click opens the pin picker panel. Unresolved
            turns the chip's text red + bold (sets 20, softened in the
            22 follow-up): the one hard-cut signal. */}
        <button
          className="set-chip-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPicker(index, e.clientX, e.clientY);
          }}
          title={chip.title}
          style={{
            ...chip.style,
            // Bold exactly when a cut actually plays (sets 26): no
            // evidence, or an explicit Hard-cut pin.
            fontWeight:
              view.status === 'unresolved' || view.status === 'hardcut' ? 600 : undefined,
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
            onOpenEditor(aTrackId, bTrackId, pin);
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
              onPractice(index);
            }}
            title="Practice this handover: cue outgoing on deck A (with a runway), incoming on deck B — press again to re-cue"
          >
            ◉
          </button>
        )}

        {/* One-click freeze (sets 26): pin the auto-resolved choice —
            playback already plays it; pinning detaches it from the
            library's evolution. */}
        {view.auto && view.transition && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPin(aTrackId, { kind: 'transition', uuid: view.transition!.uuid });
            }}
            title="Pin this auto-resolved Transition (freeze it — new saves and favorites will no longer change what plays here)"
            style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
          >
            ↳ pin
          </button>
        )}

        {/* Take-available indicator (26 review follow-up): a cut is about
            to play while the pair HAS recorded Takes — the one evidence
            resolution deliberately ignores (Takes never auto-resolve,
            ADR 0023; they arrive only by choice — this picker, or the
            Set-level Resolve-from-evidence confirm, sets #163), so
            surface the manual option. Click opens the pin picker, where
            the Takes are listed. Quiet when a Transition plays (the
            counts cell already says "· N tk"), and the fresh-take offer
            below outranks it (one mauve chip at a time). */}
        {view.status === 'unresolved' && view.counts.takes > 0 && !freshTake && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPicker(index, e.clientX, e.clientY);
            }}
            title={`This pair has ${view.counts.takes} recorded Take${
              view.counts.takes === 1 ? '' : 's'
            } but no saved Transition — Takes never auto-resolve; pin one to play it here`}
            style={{ borderColor: 'var(--mauve)', color: 'var(--mauve)' }}
          >
            {view.counts.takes === 1
              ? '● take available — pin?'
              : `● ${view.counts.takes} takes available — pin?`}
          </button>
        )}

        {/* Routines detected (sets 160, loudened at #161 finding 5): a
            saved Routine, Routine Take, OR unconfirmed candidate whose
            cast matches this Set's next n entries — filled magenta so it
            reads at a glance; the picker carries the trust tiers. */}
        {routineOffer > 0 && view.status !== 'routine' && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPicker(index, e.clientX, e.clientY);
            }}
            title={`${routineOffer} Routine${routineOffer === 1 ? '' : 's'} detected here — recorded choreography whose cast matches this Set's next entries. Open the picker to pin one`}
            style={{
              borderColor: ROUTINE_COLOR,
              color: 'var(--base)',
              background: ROUTINE_COLOR,
              fontWeight: 800,
            }}
          >
            ◆ {routineOffer > 1 ? `${routineOffer} routines detected` : 'routine detected'}
          </button>
        )}

        {/* Dormant routine (#161): the pin waits keyed by its boundary
            tracks — dimmed, non-interactive; the tooltip teaches the
            restore gesture (dormant pair pins get the drag-preview ↺;
            a broken Routine deserves a standing hint). */}
        {dormantRoutineExit !== null && (
          <span
            title={`A pinned Routine went Dormant when its cast broke — it restores when the cast is the next entries again, exiting with ${dormantRoutineExit} (drag the cast members back into place)`}
            style={{
              padding: '1px 6px',
              border: `1px dashed ${ROUTINE_COLOR}`,
              color: ROUTINE_COLOR,
              opacity: 0.55,
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'help',
            }}
          >
            ◆ routine dormant — returns with {dormantRoutineExit}
          </span>
        )}

        {/* Fresh-Take offer (sets 13): the latest just-captured Take for
            this pair — one click pins it (never auto-pinned). */}
        {freshTake && (
          <button
            className="set-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPinFreshTake(aTrackId, bTrackId, freshTake.uuid);
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
    </>
  );
});

/** Trim drag sensitivity (sets #164): dB per pixel of vertical travel —
 * the knob's ±12 dB spans ~160px. */
const TRIM_DRAG_DB_PER_PX = 0.15;

/**
 * Compact per-entry trim control (sets #164): the entry's trim offset in
 * dB, editable in place. Drag ↕ streams local updates (one wholesale PUT
 * on release); the hover-revealed ⟲ (or a double-click) resets to
 * neutral. The value is an OFFSET from neutral — track Autogain composes
 * with it when it lands (ADR 0034) — applied by the Conductor for the
 * entry's deck tenure; a live trim-knob move still takes over.
 */
const TrimCell = memo(function TrimCell({
  trackId,
  trim,
  onTrimChange,
}: {
  trackId: number;
  trim: number;
  onTrimChange: (trackId: number, trim: number, commit: boolean) => void;
}) {
  const drag = useRef<{ pointerId: number; startY: number; startTrim: number; moved: boolean } | null>(null);
  const neutral = trim === 0;
  const valueAt = (clientY: number): number => {
    const d = drag.current!;
    return trimOffsetFromDb(trimOffsetDb(d.startTrim) + (d.startY - clientY) * TRIM_DRAG_DB_PER_PX);
  };
  return (
    <span
      className="set-trim-cell"
      style={{
        width: `${TRIM_COL_W + 14}px`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '2px',
      }}
      // Never a selection click, never a row drag. The cell is itself
      // `draggable` so it — not the draggable ROW — is the nearest drag
      // source for any press inside it, and its dragstart cancels
      // (#161 finding: without the attribute this handler never fired —
      // dragstart targets the draggable ancestor — so a trim gesture
      // also picked the row up for reorder).
      draggable
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        className="set-glyph-btn set-row-reveal"
        onClick={(e) => {
          e.stopPropagation();
          onTrimChange(trackId, 0, true);
        }}
        title="Reset trim to neutral"
        style={{
          width: '12px',
          padding: 0,
          fontSize: '11px',
          color: 'var(--subtext0)',
          ...(neutral ? { visibility: 'hidden' as const } : undefined),
        }}
      >
        ⟲
      </button>
      <span
        title={`Entry trim ${fmtTrimDb(trim)} dB — offset from neutral, applied while this entry plays. Drag ↕ to adjust; double-click resets.`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onTrimChange(trackId, 0, true);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          drag.current = { pointerId: e.pointerId, startY: e.clientY, startTrim: trim, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.pointerId) return;
          if (!d.moved && Math.abs(e.clientY - d.startY) < 3) return; // a click never nudges
          d.moved = true;
          onTrimChange(trackId, valueAt(e.clientY), false);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.pointerId) return;
          // Read the value BEFORE dropping the drag — valueAt reads the
          // ref (a null-then-read here lost the commit; found at #161).
          const v = d.moved ? valueAt(e.clientY) : null;
          drag.current = null;
          if (v !== null) onTrimChange(trackId, v, true);
        }}
        onPointerCancel={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.pointerId) return;
          // Land whatever the stream last wrote — never leave an
          // uncommitted local value dangling.
          const v = d.moved ? valueAt(e.clientY) : null;
          drag.current = null;
          if (v !== null) onTrimChange(trackId, v, true);
        }}
        style={{
          ...cellStyle(TRIM_COL_W),
          textAlign: 'right',
          cursor: 'ns-resize',
          userSelect: 'none',
          touchAction: 'none',
          color: neutral ? 'var(--surface2)' : 'var(--yellow)',
          fontWeight: neutral ? 400 : 600,
        }}
      >
        {fmtTrimDb(trim)}
        {/* Unit label (#161): display-only — the stored value stays an
            offset in knob units so Autogain composes (ADR 0034). */}
        <span style={{ fontSize: '9px', fontWeight: 400, opacity: 0.7, marginLeft: '2px' }}>
          dB
        </span>
      </span>
    </span>
  );
});

/** Label for a pinned Routine's row: its name when named, else the
 * boundary tracks (entry → exit). */
function routineRowLabel(
  cov: RoutineCoverage,
  routineRows: readonly { uuid: string; name: string | null }[],
  trackLabel: (trackId: number) => string
): string {
  const name = routineRows.find((r) => r.uuid === cov.uuid)?.name;
  if (name?.trim()) return name;
  return `${trackLabel(cov.cast[0])} → … → ${trackLabel(cov.cast[cov.cast.length - 1])}`;
}

/** The routine pin's row (sets 160): replaces the head adjacency's row
 * while the Routine is live. The covered entries below render inside
 * the cast bracket (dimmed, exit marked); interior adjacency rows are
 * collapsed. The covered span plays the recording — slot-remapped,
 * beat-rebased replay (sets #159, wired at #161). Click opens the
 * picker (switch/unpin); there is no editor click-through. Memoized
 * like its sibling rows (issue 42): primitive props + identity-stable
 * callbacks. */
const RoutinePinRow = memo(function RoutinePinRow({
  index,
  label,
  coversCount,
  exitLabel,
  onOpenPicker,
}: {
  /** This adjacency's index in the displayed order. */
  index: number;
  label: string;
  /** Adjacencies the Routine covers (n − 1). */
  coversCount: number;
  exitLabel: string;
  onOpenPicker: (index: number, x: number, y: number) => void;
}) {
  return (
    <div
      data-set-adjacency-row
      className="set-adjacency-row"
      style={{
        gap: `${ADJ_ROW_GAP}px`,
        padding: `2px ${ROW_PAD_X}px 2px ${ADJ_PAD_LEFT}px`,
        backgroundImage: `linear-gradient(90deg, rgba(255, 0, 200, 0.10), transparent 65%)`,
      }}
    >
      <span style={{ width: `${ADJ_GUTTER_W}px`, flexShrink: 0 }} />
      <button
        className="set-chip-btn"
        onClick={(e) => {
          e.stopPropagation();
          onOpenPicker(index, e.clientX, e.clientY);
        }}
        title={`Pinned Routine — covers the next ${coversCount} adjacencies; the cast plays as recorded and exits with ${exitLabel} playing. Interior reorder is free; breaking a boundary or the cast sends it Dormant (covered pins wake). Click to switch or unpin`}
        style={{ color: ROUTINE_COLOR, fontWeight: 800 }}
      >
        ▾ ◆ ROUTINE {label}
      </button>
      <span style={{ color: 'var(--subtext0)' }}>
        covers {coversCount} adjacencies · exits with {exitLabel}
      </span>
      <span style={{ marginLeft: 'auto' }} />
      <span style={{ width: `${ADJ_TIME_SPACER_W}px`, flexShrink: 0 }} />
    </div>
  );
});

/** Memoized (issue 42): ~88 of these sit in a big set, and a selection
 * click paid one full row-stack render (~80 ms) before the memo. The
 * TrackRow contract: identity-stable callbacks (parameterized by
 * trackId/index), stable object props (trackMap/plan slices, the
 * memoized occupancy map). */
const SetTrackRow = memo(function SetTrackRow({
  index,
  trackId,
  track,
  planned,
  bpmRef,
  occupancy,
  selected,
  dragging,
  trim,
  castMark,
  routineOffer,
  onOpenRoutinePicker,
  onSelect,
  onDragStart,
  onDragEnd,
  onPlayFrom,
  onRemove,
  onTrimChange,
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
  /** LIVE deck occupancy (sets 35) — the row derives its identity wash
   * (loaded decks) and the playing STATE mark from it. Memoized on the
   * engine slices, so its identity moves only on load/play/pause. */
  occupancy: DeckOccupancyMap;
  /** In the pane's row selection (sets 18): blue wash + inset blue ring.
   * Coexists with the loaded wash — when both, the identity wash keeps
   * the background and the ring marks the selection. */
  selected: boolean;
  /** This row is the drag source (sets 23) — dimmed, sortable-style,
   * wherever it currently displays (its hypothetical slot mid-preview,
   * its committed one when the pointer is back over it). */
  dragging: boolean;
  /** Covered by a pinned Routine (sets 160): 'cast' for interior cast
   * members, 'exit' for the boundary track the Routine exits with —
   * a small magenta chip beside the title (the bracket itself is the
   * wrapper's). Null when uncovered. */
  castMark: 'cast' | 'exit' | null;
  /** Routines/Routine Takes/candidates offerable on the adjacency this
   * row heads (sets #161 finding 5): >0 renders the loud "◆ routines
   * detected" tag beside the title. 0 when a routine is already pinned. */
  routineOffer: number;
  /** Opens the pin picker at this row's adjacency (identity-stable). */
  onOpenRoutinePicker: (index: number, x: number, y: number) => void;
  /** Selection gestures (sets 18): plain / shift-range / cmd-toggle. */
  onSelect: (trackId: number, mods: { shift: boolean; toggle: boolean }) => void;
  /** Row drag lifecycle (sets 07): the pane sets the drag payload and
   * tracks the dragged ids for the ladder's live preview. */
  onDragStart: (e: React.DragEvent, trackId: number) => void;
  onDragEnd: () => void;
  /** The entry's trim offset (sets #164): knob units from neutral. */
  trim: number;
  /** Row play button: start Set playback at this row's planned entry. */
  onPlayFrom: ((index: number) => void) | undefined;
  onRemove: (trackId: number) => void;
  /** Trim edits (sets #164): `commit: false` streams a drag locally,
   * `true` lands the wholesale PUT (drag release / reset). */
  onTrimChange: (trackId: number, trim: number, commit: boolean) => void;
  /** Right-click: the universal track menu (sets 17); absent while the
   * row's track metadata is still loading. */
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
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
  const loadedOn = loadedDecks(trackId, occupancy);
  const playing = isRowPlaying(trackId, occupancy);
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
      onClick={(e) => onSelect(trackId, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onDragStart={(e) => onDragStart(e, trackId)}
      onDragEnd={onDragEnd}
      onContextMenu={
        track && onContextMenu ? (e) => onContextMenu(e, track) : undefined
      }
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
            onPlayFrom?.(index);
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
      {/* Per-entry trim (sets #164; moved left of the key column at
          #161): drag ↕ adjusts, ⟲/double-click resets. */}
      <TrimCell trackId={trackId} trim={trim} onTrimChange={onTrimChange} />
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
        {castMark && (
          <span
            title={
              castMark === 'exit'
                ? 'Routine exit — sounding as the Routine ends; the next adjacency plays off this track'
                : 'Routine cast member — enters per the recorded choreography (interior Set order is presentational; reorder freely)'
            }
            style={{
              marginLeft: '8px',
              padding: '0 5px',
              fontSize: '10px',
              fontWeight: 800,
              color: castMark === 'exit' ? 'var(--base)' : ROUTINE_COLOR,
              background: castMark === 'exit' ? ROUTINE_COLOR : 'rgba(255, 0, 200, 0.12)',
              border: `1px solid ${ROUTINE_COLOR}`,
            }}
          >
            {castMark === 'exit' ? 'exit ⤴' : '◆ cast'}
          </span>
        )}
        {routineOffer > 0 && !castMark && (
          <span
            title={`${routineOffer} Routine${routineOffer === 1 ? '' : 's'} detected leaving this track — recorded choreography matching the next entries. Click to open the picker`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenRoutinePicker(index, e.clientX, e.clientY);
            }}
            style={{
              marginLeft: '8px',
              padding: '0 5px',
              fontSize: '10px',
              fontWeight: 800,
              color: 'var(--base)',
              background: ROUTINE_COLOR,
              border: `1px solid ${ROUTINE_COLOR}`,
              cursor: 'pointer',
            }}
          >
            ◆ routines detected
          </span>
        )}
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
          onRemove(trackId);
        }}
        title="Remove from set"
        style={{ width: `${REMOVE_COL_W}px`, flexShrink: 0, padding: '2px 0', color: 'var(--red)' }}
      >
        ✕
      </button>
    </div>
  );
});

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
