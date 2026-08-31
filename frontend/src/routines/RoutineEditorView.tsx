/**
 * Routine editor (gh#170) — the slot-aware sibling of the Transition
 * editor, a PARALLEL surface rather than a stretched pair mode: the pair
 * editor's machinery (EditorStore, MixPlayer, pairKey persistence,
 * evidence cycling) is A/B-scoped to the bone, so Routines get their own
 * shell over the same shared Decks+Mixer and the same borrow doctrine
 * (ADR 0022; claim on first audition gesture, capture-invisible by
 * construction — the recorder sees a tenure marker for any non-shared
 * holder).
 *
 * Pass 2: the full review+EDIT surface — slot-aware view, replay
 * audition, boundary trim + re-promotion, and the routine DRAFT layer
 * (routineDraft/routineDraftStore): authored slot lanes (the pair
 * editor's own LaneCanvas, structurally reused) and Jumps on any slot,
 * with undo/redo and debounced autosave to `Routine.edits_json`. Edits
 * apply at replay-build time, so the set Conductor hears them too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CameoRowWire,
  type RoutineDetailWire,
  type TakeRowWire,
} from '../api/client';
import type { HotCue, Track } from '../types';
import type { Transition } from '../editor/mixModel';
import {
  changedPairEdits,
  editsToTransition,
  seedNewTransition,
  transitionToProjection,
  type PairSlotProjection,
} from '../editor/pairSlotTranslation';
import { vectorizeTake } from '../capture/vectorize';
import { trackEffectiveBpm } from '../sets/planner';
import { reconcilePairFromServer } from '../editor/pairStore';
import EditableCell from '../components/EditableCell';
import { MixPicker } from './MixPicker';
import { siblingCycle, type MixArtifactRef, type TransitionRowLike } from './mixPickerModel';

/** The wire row with its opaque payload — the picker model only needs the
 * metadata slice, but the projection/save paths need `data`. */
type TransitionRowFull = TransitionRowLike & { data: Record<string, unknown> };
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import {
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  subscribeAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import { watchAuditionTakeover, watchDeckAuditionTakeover } from '../editor/auditionTakeover';
import { armAudition } from '../editor/auditionArm';
import { isGuardedKeyEvent } from '../components/performance/performanceKeys';
import { useViewActive } from '../contexts/viewActive';
import { decodeWaveformBlob, type DecodedWaveform } from '../waveform/blob';
import { registerBrowseHost, sharedBrowseHandle } from '../components/browseHost';
import { fillPickerChip } from './pickerChips';
import {
  plannedWithLaneEdits,
  ROUTINE_DECK_ORDER,
  type RoutineDeck,
} from '../sets/routinePlan';
import { useToast } from '../components/Toast';
import { RoutinePlayer } from './RoutinePlayer';
import { RoutineTimeline, type TrimRange } from './RoutineTimeline';
import { consumeRoutineEdit, OPEN_ROUTINE_EVENT } from './openRoutine';
import { consumeMixEdit, OPEN_MIX_EVENT } from './openMix';
import { setAdjacencyPin } from '../sets/setStore';
import type { AdjacencyPin } from '../sets/adjacency';
import { openCandidateInEditor, openRoutineTakeInEditor } from './openFlow';
import { openRoutineSource } from './provenance';
import { editsAreEmpty, emptyEdits, parseEdits } from './routineDraft';
import { RoutineDraftStore, useRoutineDraft, editsForSave } from './routineDraftStore';
import {
  beatLabel,
  buildEditorRoutine,
  buildTrackMeter,
  recordedJumps,
  recordedPauses,
  secondsLabel,
  slotAccent,
  type EditorRoutine,
  type TrackMeter,
} from './routineEditorModel';
import { beatgridQueryOptions } from '../hooks/useBeatgridData';
import { metricLadderQueryOptions } from '../hooks/useMetricLadderData';
import {
  MODE_KEY_HINTS,
  MODE_LABELS,
  MODE_TITLES,
  useEditorMode,
  type EditorMode,
} from './editorMode';
import './routineEditor.css';

const LAST_ROUTINE_KEY = 'manadj-last-routine';
const LAST_MIX_KEY = 'manadj-last-mix';

/** What the Mix editor has open (#205, ADR 0037 phase 2): a Routine by
 * uuid, or a pair artifact projected through the phase-1 translation
 * layer. `seed` = a new unsaved pair draft (persists nothing until the
 * first edit — the draft posture). */
type OpenedMix =
  | { kind: 'routine'; uuid: string }
  | {
      kind: 'transition';
      aTrackId: number;
      bTrackId: number;
      uuid: string;
      seed?: Transition;
      /** Set = a PAIR-TAKE REVIEW draft (#205 slice 2): the seed came from
       * vectorizing this take — persists NOTHING until ↑ Promote (which
       * mints the Transition and marks the take promoted). */
      reviewTakeUuid?: string;
    }
  /** A REVIEW DRAFT (#205 draft-everywhere, ADR 0037): an unpromoted
   * Routine Take or miner candidate opened through the promotion PREVIEW
   * — editable, auditionable, discardable; NOTHING persists until the
   * explicit Promote (reverses #170's promote-on-open). */
  | { kind: 'review'; source: 'routine-take' | 'candidate'; uuid: string };

function restoreLastMix(): OpenedMix | null {
  try {
    const raw = localStorage.getItem(LAST_MIX_KEY);
    if (raw) {
      const v = JSON.parse(raw) as OpenedMix;
      if (v && (v.kind === 'routine' || v.kind === 'transition')) return v;
    }
  } catch {
    // fall through to the legacy key
  }
  const legacy = localStorage.getItem(LAST_ROUTINE_KEY);
  return legacy ? { kind: 'routine', uuid: legacy } : null;
}

export default function RoutineEditorView() {
  const mixer = useMixer();
  const decks = useDecks();
  const queryClient = useQueryClient();
  const toast = useToast();
  const viewActive = useViewActive();

  // Modal editing (ADR 0038, gh#207): mode is a working posture — it lives
  // here in the shell so it persists across artifact switches.
  const [editorMode, setEditorMode] = useEditorMode(viewActive);

  // Track rows for the load hook (deck reuse loads tracks mid-play):
  // usually already fetched; falls back to the API for a cold id.
  const trackLookupRef = useRef<Map<number, Track>>(new Map());
  const [player] = useState(
    () =>
      new RoutinePlayer({
        mixer,
        engines: {
          A: decks.A.engine,
          B: decks.B.engine,
          C: decks.C.engine,
          D: decks.D.engine,
        },
        audible: () => isAudible('routine-editor'),
        // The provider's one Load path (ADR 0022). Deck reuse (gh#170
        // pass 2) flips a deck's occupant mid-span — the player asks for
        // the incoming track the moment the occupancy opens.
        loadTrack: (deck, trackId) => {
          const known = trackLookupRef.current.get(trackId);
          if (known) decksRef.current[deck].loadTrack(known);
          else
            void api.tracks
              .getById(trackId)
              .then((t: Track) => decksRef.current[deck].loadTrack(t))
              .catch(() => undefined);
        },
      })
  );
  useEffect(() => () => player.dispose(), [player]);

  // ── Which mix (#205: routine OR a projected pair artifact) ───────────
  const [opened, setOpened] = useState<OpenedMix | null>(() => {
    const req = consumeRoutineEdit();
    return req ? { kind: 'routine', uuid: req.routineUuid } : restoreLastMix();
  });
  const routineUuid = opened?.kind === 'routine' ? opened.uuid : null;
  useEffect(() => {
    const onOpen = () => {
      const req = consumeRoutineEdit();
      if (req) setOpened({ kind: 'routine', uuid: req.routineUuid });
    };
    window.addEventListener(OPEN_ROUTINE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ROUTINE_EVENT, onOpen);
  }, []);

  // ── Set context (#221 phase 3): pin-follow, sticky to the MOVE ───────
  // Armed by a Set-pane open request; cycling within the move re-points
  // the Set pin (the switch IS the deliberate act, gh#167); navigating to
  // a different pair/cast DISARMS (visible — the header chip vanishes).
  const [setCtx, setSetCtx] = useState<{
    setId: number;
    headTrackId: number;
    moveKey: string;
  } | null>(null);
  const setCtxRef = useRef(setCtx);
  setCtxRef.current = setCtx;
  const routineRowsRef = useRef<{ uuid: string; cast: number[] }[]>([]);
  // The MOVE a mix belongs to: the ordered pair for pair artifacts, the
  // cast for routines (siblings share it — siblingCycle's own scoping).
  const moveKeyOf = useCallback((o: OpenedMix | null): string | null => {
    if (!o) return null;
    if (o.kind === 'transition') return `p:${o.aTrackId}:${o.bTrackId}`;
    if (o.kind === 'routine') {
      const cast = routineRowsRef.current.find((r) => r.uuid === o.uuid)?.cast;
      return cast && cast.length > 0 ? `r:${cast.join(',')}` : `ru:${o.uuid}`;
    }
    return null; // review drafts: no pinnable move (yet)
  }, []);
  /** Re-point the armed Set pin — only for opens INSIDE the armed move. */
  /** Request-initiated opens must not re-point the pin — only SWITCHES
   * within the move are deliberate acts (gh#167). */
  const suppressFollowRef = useRef(false);
  const followPin = useCallback((moveKey: string | null, pin: AdjacencyPin) => {
    if (suppressFollowRef.current) return;
    const ctx = setCtxRef.current;
    if (ctx && moveKey !== null && moveKey === ctx.moveKey) {
      setAdjacencyPin(ctx.setId, ctx.headTrackId, pin);
    }
  }, []);
  useEffect(() => {
    // Unsaved seeds and review drafts never persist as the last mix
    // (nothing durable to restore to).
    if (
      !opened ||
      opened.kind === 'review' ||
      (opened.kind === 'transition' && (opened.seed || opened.reviewTakeUuid))
    )
      return;
    localStorage.setItem(LAST_MIX_KEY, JSON.stringify(opened));
    if (opened.kind === 'routine') localStorage.setItem(LAST_ROUTINE_KEY, opened.uuid);
  }, [opened]);

  // Picker trust tiers (pass 2 directive 3): `r:` opens directly; `t:`
  // promotes-then-opens; `c:` confirms-then-promotes-then-opens (the
  // deliberate human act the suggestion-first doctrine requires).
  const [openFlowBusy, setOpenFlowBusy] = useState(false);
  const openMixRef = useCallback(
    async (ref: MixArtifactRef) => {
      switch (ref.kind) {
        case 'routine':
          setOpened({ kind: 'routine', uuid: ref.uuid });
          followPin(moveKeyOf({ kind: 'routine', uuid: ref.uuid }), {
            kind: 'routine',
            uuid: ref.uuid,
          });
          return;
        case 'transition':
          setOpened({
            kind: 'transition',
            aTrackId: ref.aTrackId,
            bTrackId: ref.bTrackId,
            uuid: ref.uuid,
          });
          // In set context the switch IS the deliberate act (gh#167).
          followPin(`p:${ref.aTrackId}:${ref.bTrackId}`, { kind: 'transition', uuid: ref.uuid });
          return;
        case 'new-transition': {
          // Seeded at the outgoing's outro (ADR 0037 pair synthesis);
          // draft posture — persists nothing until the first edit.
          setOpenFlowBusy(true);
          try {
            const a = await api.tracks.getById(ref.aTrackId);
            setOpened({
              kind: 'transition',
              aTrackId: ref.aTrackId,
              bTrackId: ref.bTrackId,
              uuid: crypto.randomUUID(),
              seed: seedNewTransition(a.duration_secs ?? 300, a.bpm ?? null),
            });
          } finally {
            setOpenFlowBusy(false);
          }
          return;
        }
        case 'pair-take': {
          // Pair-take review ON the slot surface (#205 slice 2): vectorize
          // the take into a Transition draft and open it as a review seed —
          // nothing persists until ↑ Promote.
          setOpenFlowBusy(true);
          try {
            const detail = await api.takes.get(ref.uuid);
            if (detail.promoted_transition_uuid) {
              setOpened({
                kind: 'transition',
                aTrackId: detail.a_track_id,
                bTrackId: detail.b_track_id,
                uuid: detail.promoted_transition_uuid,
              });
              followPin(`p:${detail.a_track_id}:${detail.b_track_id}`, {
                kind: 'transition',
                uuid: detail.promoted_transition_uuid,
              });
              return;
            }
            const [a, b] = await Promise.all([
              api.tracks.getById(detail.a_track_id),
              api.tracks.getById(detail.b_track_id),
            ]);
            const vectorized = vectorizeTake(
              {
                events: detail.events,
                windowStartS: detail.window_start_s,
                windowEndS: detail.window_end_s,
              },
              // Grid-first (ADR 0016), the pair editor's own authority.
              { bpmA: trackEffectiveBpm(a), bpmB: trackEffectiveBpm(b) }
            );
            if (!vectorized) {
              toast('This take cannot be vectorized (slice has no init head)');
              return;
            }
            setOpened({
              kind: 'transition',
              aTrackId: detail.a_track_id,
              bTrackId: detail.b_track_id,
              uuid: crypto.randomUUID(),
              seed: vectorized.transition,
              reviewTakeUuid: ref.uuid,
            });
            followPin(`p:${detail.a_track_id}:${detail.b_track_id}`, {
              kind: 'take',
              uuid: ref.uuid,
            });
          } catch (err) {
            toast(`Take review failed: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setOpenFlowBusy(false);
          }
          return;
        }
        case 'cameo':
          toast('Cameo editing on the slot surface lands in a later phase-2 round');
          return;
        case 'new-blank':
          toast('Blank kind-fluid drafts (ADR 0039) land with #198');
          return;
        case 'routine-take':
          // Draft-everywhere (#205): open as a REVIEW DRAFT via the
          // promotion preview — no minting on open.
          setOpened({ kind: 'review', source: 'routine-take', uuid: ref.uuid });
          return;
        case 'candidate':
          setOpened({ kind: 'review', source: 'candidate', uuid: ref.uuid });
          return;
      }
    },
    [queryClient, toast, followPin, moveKeyOf]
  );

  // Consume Mix-editor open requests (#221): map onto the picker's own
  // open path; arm set context WITHOUT letting the initial open re-point
  // the pin (only SWITCHES within the move are deliberate acts, gh#167 —
  // suppressFollow covers the request-initiated open).
  const consumeMix = useCallback(async () => {
    const req = consumeMixEdit();
    if (!req) return;
    const o = req.open;
    const moveKey =
      o.kind === 'routine'
        ? moveKeyOf({ kind: 'routine', uuid: o.uuid })
        : `p:${o.aTrackId}:${o.bTrackId}`;
    // Arm AFTER the open lands (below) — arming first lets the sticky-to-
    // move disarm effect see the PREVIOUS artifact and kill the context.
    setSetCtx(null);
    suppressFollowRef.current = true;
    try {
      if (o.kind === 'routine') {
        await openMixRef({ kind: 'routine', uuid: o.uuid });
      } else if (o.takeUuid) {
        await openMixRef({
          kind: 'pair-take',
          aTrackId: o.aTrackId,
          bTrackId: o.bTrackId,
          uuid: o.takeUuid,
        });
      } else if (o.uuid) {
        await openMixRef({
          kind: 'transition',
          aTrackId: o.aTrackId,
          bTrackId: o.bTrackId,
          uuid: o.uuid,
        });
      } else {
        await openMixRef({ kind: 'new-transition', aTrackId: o.aTrackId, bTrackId: o.bTrackId });
      }
      if (req.setContext && moveKey !== null) {
        setSetCtx({
          setId: req.setContext.setId,
          headTrackId: req.setContext.headTrackId,
          moveKey,
        });
      }
    } finally {
      suppressFollowRef.current = false;
    }
  }, [openMixRef, moveKeyOf]);
  useEffect(() => {
    const onOpen = () => void consumeMix();
    window.addEventListener(OPEN_MIX_EVENT, onOpen);
    void consumeMix(); // a request may predate the mount (App flips first)
    return () => window.removeEventListener(OPEN_MIX_EVENT, onOpen);
  }, [consumeMix]);

  const { data: routineRows = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: api.routines.list,
  });
  routineRowsRef.current = routineRows;
  // Trust tiers below saved Routines (gh#170 pass 2, directive 3 — the
  // pin picker's ladder): unpromoted Routine Takes, then unconfirmed
  // miner candidates. Opening a lower tier runs its flow (promote /
  // confirm-then-promote) and lands on the minted Routine.
  const { data: routineTakeRows = [] } = useQuery({
    queryKey: ['routine-takes'],
    queryFn: api.routineTakes.list,
  });
  const { data: candidateRows = [] } = useQuery({
    queryKey: ['routine-candidates'],
    queryFn: api.routineCandidates.list,
  });
  const routineTakeRowsRef = useRef(routineTakeRows);
  routineTakeRowsRef.current = routineTakeRows;
  const candidateRowsRef = useRef(candidateRows);
  candidateRowsRef.current = candidateRows;
  const unpromotedTakes = useMemo(
    () => routineTakeRows.filter((t) => !t.promoted_routine_uuid),
    [routineTakeRows]
  );
  const unconfirmedCandidates = useMemo(() => {
    const confirmed = new Set(
      routineTakeRows.map((t) => t.origin_candidate_uuid).filter(Boolean)
    );
    return candidateRows.filter((c) => !confirmed.has(c.uuid) && c.cast.length >= 3);
  }, [candidateRows, routineTakeRows]);
  const { data: routineDetail } = useQuery<RoutineDetailWire>({
    queryKey: ['routine-detail', routineUuid],
    queryFn: () => api.routines.get(routineUuid!),
    enabled: routineUuid !== null,
  });

  // ── Picker inventory (#205) ──────────────────────────────────────────
  const { data: transitionRows = [] } = useQuery<TransitionRowFull[]>({
    queryKey: ['transitions'],
    queryFn: () => api.transitions.list() as Promise<TransitionRowFull[]>,
  });
  const transitionRowsRef = useRef(transitionRows);
  transitionRowsRef.current = transitionRows;
  const { data: cameoRows = [] } = useQuery<CameoRowWire[]>({
    queryKey: ['cameos'],
    queryFn: () => api.cameos.list(),
  });
  const { data: takeRows = [] } = useQuery<TakeRowWire[]>({
    queryKey: ['takes'],
    queryFn: () => api.takes.list(),
  });
  const { data: allTracksPage } = useQuery<{ items: Track[] }>({
    queryKey: ['tracks-picker'],
    queryFn: () => api.tracks.list(1, 10000) as Promise<{ items: Track[] }>,
    staleTime: 60_000,
  });
  const allTracks = useMemo(() => allTracksPage?.items ?? [], [allTracksPage]);
  const trackByIdMap = useMemo(() => {
    const m = new Map<number, Track>();
    for (const t of allTracks) m.set(t.id, t);
    return m;
  }, [allTracks]);
  const trackById = useCallback((id: number) => trackByIdMap.get(id), [trackByIdMap]);

  // ── Pair projection (#205: the phase-1 translation layer as the load
  // path — a Transition opens as a synthetic 2-slot routine) ────────────
  const openedTransition = opened?.kind === 'transition' ? opened : null;
  const pairRow = useMemo(
    () =>
      openedTransition
        ? transitionRows.find((r) => r.uuid === openedTransition.uuid) ?? null
        : null,
    [transitionRows, openedTransition]
  );
  const pairTrackQueries = useQueries({
    queries: openedTransition
      ? [openedTransition.aTrackId, openedTransition.bTrackId].map((id) => ({
          queryKey: ['track', id],
          queryFn: () => api.tracks.getById(id),
          staleTime: 60_000,
        }))
      : [],
  });
  const pairTrackA = pairTrackQueries[0]?.data;
  const pairTrackB = pairTrackQueries[1]?.data;
  const proj: PairSlotProjection | null = useMemo(() => {
    if (!openedTransition) return null;
    const data = (pairRow?.data as Transition | undefined) ?? openedTransition.seed;
    if (!data || !pairTrackA || !pairTrackB) return null;
    return transitionToProjection({
      uuid: openedTransition.uuid,
      name: pairRow?.name ?? 'New Transition',
      transition: data,
      trackAId: openedTransition.aTrackId,
      trackBId: openedTransition.bTrackId,
      bpmA: pairTrackA.bpm ?? null,
      bpmB: pairTrackB.bpm ?? null,
    });
  }, [openedTransition, pairRow, pairTrackA, pairTrackB]);
  const projRef = useRef(proj);
  projRef.current = proj;
  const openedRef = useRef(opened);
  openedRef.current = opened;

  // Sticky to the move: any open OUTSIDE the armed move disarms.
  useEffect(() => {
    setSetCtx((ctx) => (ctx && moveKeyOf(openedRef.current) !== ctx.moveKey ? null : ctx));
  }, [opened, moveKeyOf]);

  // Review drafts (#205): the promotion PREVIEW is the detail — same
  // geometry a Promote would mint, persisted nowhere.
  const openedReview = opened?.kind === 'review' ? opened : null;
  const { data: previewDetail } = useQuery<RoutineDetailWire>({
    queryKey: ['routine-preview', openedReview?.source, openedReview?.uuid],
    queryFn: () =>
      openedReview!.source === 'routine-take'
        ? api.routineTakes.preview(openedReview!.uuid)
        : api.routineCandidates.preview(openedReview!.uuid),
    enabled: openedReview !== null,
    staleTime: Infinity,
  });

  const detail: RoutineDetailWire | undefined =
    opened?.kind === 'transition'
      ? proj?.detail
      : opened?.kind === 'review'
        ? previewDetail
        : routineDetail;

  // ── Cast tracks + waveforms ──────────────────────────────────────────
  const cast = useMemo(() => detail?.cast ?? [], [detail]);
  const uniqueTrackIds = useMemo(() => [...new Set(cast)], [cast]);
  const trackQueries = useQueries({
    queries: uniqueTrackIds.map((id) => ({
      queryKey: ['track', id],
      queryFn: () => api.tracks.getById(id),
      staleTime: 60_000,
    })),
  });
  // Keyed on an arrival KEY, not the useQueries result (a fresh array
  // identity every render — downstream effects like player.setRoutine
  // must not re-fire on renders; the first live run's update-depth loop).
  const tracksKey = trackQueries.map((q) => (q.data ? q.data.id : '·')).join(',');
  const tracks = useMemo(() => {
    const map = new Map<number, Track>();
    for (const q of trackQueries) {
      if (q.data) map.set(q.data.id, q.data);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksKey]);

  const waveQueries = useQueries({
    queries: uniqueTrackIds.map((id) => ({
      // Shares the app-wide decoded-blob cache (useWaveformBlob's key).
      queryKey: ['waveform-blob', id],
      queryFn: async () => decodeWaveformBlob(await api.waveforms.getData(id)),
      staleTime: Infinity,
      retry: 5,
    })),
  });
  const wavesKey = waveQueries.map((q) => (q.data ? '1' : '0')).join('');
  const waves = useMemo(() => {
    const map = new Map<number, DecodedWaveform | null>();
    uniqueTrackIds.forEach((id, i) => {
      map.set(id, waveQueries[i]?.data ?? null);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueTrackIds, wavesKey]);

  // Per-track meters (gh#190 iteration): each slot row grids on ITS
  // track's real Metric ladder (Reset marks applied), not a global
  // inference. Shares the app-wide beatgrid/metric-ladder caches.
  const gridQueries = useQueries({
    queries: uniqueTrackIds.map((id) => beatgridQueryOptions(id)),
  });
  const ladderQueries = useQueries({
    queries: uniqueTrackIds.map((id) => metricLadderQueryOptions(id)),
  });
  const metersKey =
    gridQueries.map((q) => (q.data ? q.data.updated_at ?? '1' : '·')).join(',') +
    '|' +
    ladderQueries.map((q) => (q.data ? q.data.reset_marks.join(';') : '·')).join(',');
  const meters = useMemo(() => {
    const map = new Map<number, TrackMeter | null>();
    uniqueTrackIds.forEach((id, i) => {
      map.set(
        id,
        buildTrackMeter(gridQueries[i]?.data?.data ?? null, ladderQueries[i]?.data ?? null)
      );
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueTrackIds, metersKey]);

  // Hotcues per cast track (one bulk request — the set-open idiom).
  const { data: hotcueRows } = useQuery({
    queryKey: ['hotcues-bulk', uniqueTrackIds.join(',')],
    queryFn: () => api.hotcues.getBulk(uniqueTrackIds),
    enabled: uniqueTrackIds.length > 0,
  });
  const hotcuesMap = useMemo(() => {
    const map = new Map<number, HotCue[]>();
    for (const id of uniqueTrackIds) map.set(id, hotcueRows?.[id] ?? []);
    return map;
  }, [uniqueTrackIds, hotcueRows]);

  // ── Target tempo (beat-domain doctrine: replay at any rate) ──────────
  const [targetBpm, setTargetBpm] = useState<number | null>(null);
  const bpmTouchedFor = useRef<string | null>(null);
  // A pair projection carries its own clock (bpmA, or the degraded
  // 1-beat/sec clock for gridless outgoing — never locked out).
  const nativeBpm = proj
    ? proj.targetBpm
    : detail && cast.length > 0
      ? tracks.get(cast[0])?.bpm ?? null
      : null;
  useEffect(() => {
    // Default to slot 0's native BPM per Routine until the user touches it.
    if (!detail) return;
    if (bpmTouchedFor.current !== detail.uuid) {
      setTargetBpm(null);
      bpmTouchedFor.current = null;
    }
  }, [detail]);
  const effectiveBpm = targetBpm ?? nativeBpm;

  // ── The draft layer (gh#170 pass 2) ──────────────────────────────────
  const [draftStore] = useState(() => new RoutineDraftStore());
  const draft = useRoutineDraft(draftStore);
  // Load persisted edits when the open ARTIFACT changes — keyed on the
  // uuid, never the detail object: the autosave response updates the
  // query cache (new detail identity, same artifact), and reloading then
  // would reset undo history mid-session and clobber in-flight edits.
  // Re-promotion (same uuid, rebased edits) reloads explicitly in
  // applyTrim.
  const detailRef = useRef(detail);
  detailRef.current = detail;
  // One load per opened artifact (#205): routines load their persisted
  // edits layer; pair projections load the PROJECTION's edits (drawn
  // lanes/jumps as authored edits) — the diff baseline for lossless save.
  // versionAtLoad gates the pair autosave: an artifact only auditioned
  // must leave no trace, not even a byte-identical rewrite (updated_at).
  const loadedForRef = useRef<string | null>(null);
  const versionAtLoadRef = useRef(0);
  useEffect(() => {
    if (!opened) {
      loadedForRef.current = null;
      draftStore.reset();
      return;
    }
    if (loadedForRef.current === opened.uuid) return;
    if (opened.kind === 'transition') {
      if (!proj) return; // projection still assembling (row/tracks in flight)
      draftStore.load(opened.uuid, proj.edits);
    } else if (opened.kind === 'review') {
      const d = detailRef.current;
      if (!d || !d.uuid.startsWith('preview-')) return; // preview in flight
      draftStore.load(d.uuid, emptyEdits());
    } else {
      const d = detailRef.current;
      if (!d || d.uuid !== opened.uuid) return; // detail still in flight
      draftStore.load(d.uuid, parseEdits(d.edits));
    }
    loadedForRef.current = opened.uuid;
    versionAtLoadRef.current = draftStore.getSnapshot().version;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, proj, detail?.uuid, draftStore]);

  // Debounced autosave (the pairStore idiom): every draft change PUTs the
  // edits layer after a quiet moment. The response updates the query
  // cache silently — no refetch loop (the view builds from the LIVE
  // draft anyway).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return draftStore.subscribe(() => {
      const snap = draftStore.getSnapshot();
      if (!snap.routineUuid) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const uuid = snap.routineUuid;
      // Review drafts persist nothing until Promote (#205 doctrine) —
      // and the preview uuid is no routine row anyway.
      if (uuid.startsWith('preview-')) return;
      const edits = snap.edits;
      const version = snap.version;
      saveTimer.current = setTimeout(() => {
        const o = openedRef.current;
        if (o?.kind === 'transition' && o.reviewTakeUuid) return; // review: Promote only
        if (o?.kind === 'transition' && o.uuid === uuid) {
          // Pair save (#205): project the CHANGED edits back onto the
          // seconds-anchored artifact (phase 1's lossless re-derivation)
          // and replace the pair. Never fires for a merely-auditioned
          // artifact (version gate), so untouched artifacts keep their
          // bytes AND their updated_at.
          if (version === versionAtLoadRef.current) return;
          const p = projRef.current;
          if (!p) return;
          const rows = transitionRowsRef.current
            .filter((r) => r.a_track_id === o.aTrackId && r.b_track_id === o.bTrackId)
            .sort((x, y) => x.position - y.position);
          const exists = rows.some((r) => r.uuid === uuid);
          const diff = changedPairEdits(edits, p.edits);
          // Draft posture: an unsaved seed with no real change persists
          // nothing (auditioning a blank draft leaves no trace).
          if (!exists && editsAreEmpty(diff)) return;
          const original =
            (rows.find((r) => r.uuid === uuid)?.data as Transition | undefined) ?? o.seed;
          if (!original) return;
          const data = editsToTransition(diff, {
            original,
            durationBeats: p.detail.duration_beats,
            secPerBeat: p.secPerBeat,
          });
          const items = rows.map((r) => ({
            uuid: r.uuid,
            name: r.name,
            favorite: r.favorite,
            data: r.uuid === uuid ? (data as unknown as Record<string, unknown>) : r.data,
          })) as { uuid: string; name: string; favorite: boolean; data: Record<string, unknown> }[];
          if (!exists) {
            items.push({
              uuid,
              name: `Transition ${rows.length + 1}`,
              favorite: false,
              data: data as unknown as Record<string, unknown>,
            });
          }
          void api.transitions
            .replacePair(o.aTrackId, o.bTrackId, items)
            .then((rows: TransitionRowFull[]) => {
              // Sync the pairStore SNAPSHOT (Set pane / suggestions /
              // Linked read it, not react-query — stale-until-reload bug).
              reconcilePairFromServer(`${o.aTrackId}:${o.bTrackId}`, rows);
              // First save of a seeded draft: the artifact now exists —
              // drop the seed so last-mix restore points at a real row.
              if (!exists) {
                setOpened((prev) =>
                  prev && prev.kind === 'transition' && prev.uuid === uuid && prev.seed
                    ? { kind: 'transition', aTrackId: prev.aTrackId, bTrackId: prev.bTrackId, uuid }
                    : prev
                );
              }
              return queryClient.invalidateQueries({ queryKey: ['transitions'] });
            })
            .catch((err) => console.error('transition autosave failed', err));
          return;
        }
        void api.routines
          .saveEdits(uuid, editsForSave(edits) as Record<string, unknown> | null)
          .then((d) => {
            queryClient.setQueryData(['routine-detail', uuid], d);
            // The Set plan fetches the same artifact under ['routine',
            // uuid] (useSetPlan) — update it too or the Set timeline
            // plays stale edits until a full reload (#205 bug report).
            queryClient.setQueryData(['routine', uuid], d);
          })
          .catch((err) => console.error('routine edits autosave failed', err));
      }, 700);
    });
  }, [draftStore, queryClient]);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  // ── Build (the replay engine's own artifact) ─────────────────────────
  // A pair projection supplies its own slot BPMs (gridless slots ride the
  // degraded clock — the build is never blocked, ADR 0037).
  const routineTrackBpms = useMemo(
    () => cast.map((id) => tracks.get(id)?.bpm ?? null),
    [cast, tracks]
  );
  const trackBpms = proj ? proj.trackBpms : routineTrackBpms;
  const missingBpm = proj
    ? false
    : trackBpms.some((b) => b === null || b === undefined || b <= 0);
  const buildable = !!detail && !missingBpm && !!effectiveBpm && effectiveBpm > 0;
  // RAW build (no jump/pause/lane edits): recorded-jump marker
  // provenance (ghosts keep their place after removal). Entry-offset
  // OVERRIDES apply even here (ADR 0039/#207): they move the slot's
  // whole recorded timeline, so provenance markers must ride the same
  // shifted/reordered view the edited build shows.
  const entryOffsetsKey = useMemo(
    () => JSON.stringify(draft.edits.entryOffsets),
    [draft.edits.entryOffsets]
  );
  const rawEditor = useMemo(() => {
    if (!buildable) return null;
    const eo = draft.edits.entryOffsets;
    const rawEdits =
      Object.keys(eo).length > 0 ? { ...emptyEdits(), entryOffsets: { ...eo } } : null;
    return buildEditorRoutine(detail!, trackBpms as number[], effectiveBpm!, rawEdits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, trackBpms, buildable, effectiveBpm, entryOffsetsKey]);
  // Keyed by SLOT ID (ADR 0039): provenance survives any derived-index
  // reshuffle between the raw and edited builds.
  const recordedJumpsBySlot = useMemo(
    () =>
      rawEditor
        ? Object.fromEntries(
            rawEditor.planned.slots.map((s) => [s.slotId, recordedJumps(s.trace)])
          )
        : {},
    [rawEditor]
  );
  const recordedPausesBySlot = useMemo(
    () =>
      rawEditor
        ? Object.fromEntries(
            rawEditor.planned.slots.map((s) => [s.slotId, recordedPauses(s.trace)])
          )
        : {},
    [rawEditor]
  );
  // Jump-edited base: traces carry authored/removed jumps. Lane edits
  // apply as a cheap re-skin below — trace identities survive lane drags
  // (the ~60 Hz hot path never rebuilds traces).
  // Nudges rebuild traces too (gh#190 item 6 — a rigid track-time slide
  // is a trace transform, not a lane re-skin), and so do entry-offset
  // overrides (ADR 0039/#207 — they reorder and shift the build).
  const jumpEditsKey = useMemo(
    () =>
      JSON.stringify({
        j: draft.edits.jumps,
        r: draft.edits.removedRecordedJumps,
        p: draft.edits.pauses,
        rp: draft.edits.removedRecordedPauses,
        n: draft.edits.nudges,
        eo: draft.edits.entryOffsets,
      }),
    [
      draft.edits.jumps,
      draft.edits.removedRecordedJumps,
      draft.edits.pauses,
      draft.edits.removedRecordedPauses,
      draft.edits.nudges,
      draft.edits.entryOffsets,
    ]
  );
  const baseEditor: EditorRoutine | null = useMemo(() => {
    if (!buildable) return null;
    return buildEditorRoutine(detail!, trackBpms as number[], effectiveBpm!, {
      ...draft.edits,
      lanes: {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, trackBpms, buildable, effectiveBpm, jumpEditsKey]);
  const editor: EditorRoutine | null = useMemo(() => {
    if (!baseEditor) return null;
    return { ...baseEditor, planned: plannedWithLaneEdits(baseEditor.planned, draft.edits) };
  }, [baseEditor, draft.edits]);

  // Feed the player (occupancy-aware — the build's allocation carries
  // deck reuse; the player resolves deck→slot per instant itself). Same
  // artifact = IN-PLACE update (live edits never reset the transport);
  // a different Routine = full reset.
  useEffect(() => {
    trackLookupRef.current = tracks;
  }, [tracks]);
  const playerUuidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) {
      playerUuidRef.current = null;
      player.setRoutine(null);
      return;
    }
    if (playerUuidRef.current === editor.detail.uuid) {
      player.updateRoutine(editor.planned);
    } else {
      playerUuidRef.current = editor.detail.uuid;
      player.setRoutine(editor.planned);
    }
  }, [editor, player]);

  // ── Borrow lifecycle (the Transition editor's doctrine, 4 decks) ─────
  const pitchCheckpointRef = useRef<Partial<Record<RoutineDeck, number>> | null>(null);
  const automationTokenRef = useRef<symbol | null>(null);
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const ensureAudible = useCallback(() => {
    if (isAudible('routine-editor')) return;
    claimAudible('routine-editor');
    if (!isAudible('routine-editor')) return;
    const checkpoint: Partial<Record<RoutineDeck, number>> = {};
    for (const d of ROUTINE_DECK_ORDER) {
      checkpoint[d] = decksRef.current[d].engine.getSnapshot().pitchPercent;
    }
    pitchCheckpointRef.current = checkpoint;
    automationTokenRef.current = mixer.engageAutomation();
  }, [mixer]);

  // One-press arm via the shared module (#204: the inline slot→deck
  // reimplementation is retired — armAudition now takes an arbitrary
  // target list, so the slot editor and the pair editor share one arm).
  const pendingArmRef = useRef<(() => void) | null>(null);
  const [armPending, setArmPending] = useState(false);
  const cancelArm = useCallback(() => {
    pendingArmRef.current?.();
    pendingArmRef.current = null;
    setArmPending(false);
  }, []);
  const auditionTogglePlay = useCallback(() => {
    if (pendingArmRef.current) {
      cancelArm();
      return;
    }
    if (player.isPlaying()) {
      player.pause();
      return;
    }
    const routine = player.getRoutine();
    if (!routine) return;
    ensureAudible();
    if (!isAudible('routine-editor')) return;
    // Every driven deck must hold its CURRENT occupant's track ready
    // (deck reuse loads later occupants on the fly through the player's
    // hook). The player's ready() is the authority, so onReady re-checks
    // it before playing.
    const onReady = () => {
      if (!player.ready()) return;
      pendingArmRef.current = null;
      setArmPending(false);
      player.play();
    };
    const cancel = armAudition({
      targets: player.currentTargets().map(({ deck, trackId }) => ({
        engine: decksRef.current[deck].engine,
        trackId,
        load: () => {
          const track = tracks.get(trackId);
          if (track) decksRef.current[deck].loadTrack(track);
        },
      })),
      onReady,
    });
    if (cancel === null) return; // fired synchronously
    pendingArmRef.current = cancel;
    setArmPending(true);
  }, [player, ensureAudible, cancelArm, tracks]);

  // Any seek cancels a pending arm (the pair editor's rule).
  useEffect(() => player.subscribeSeek(cancelArm), [player, cancelArm]);

  // Surface registration + displacement + teardown.
  useEffect(() => {
    registerSurface('routine-editor', {
      transport: { togglePlay: auditionTogglePlay },
      transportState: {
        playing: () => player.isPlaying(),
        subscribe: (fn) => player.subscribe(fn),
      },
      silence: () => player.pause(),
    });
    const unsubDisplaced = subscribeAudible((holder) => {
      if (holder !== 'routine-editor') {
        cancelArm();
        player.pause();
      }
    });
    return () => {
      unsubDisplaced();
      cancelArm();
      const held = isAudible('routine-editor');
      if (held) releaseAudible('routine-editor');
      unregisterSurface('routine-editor');
      if (held) {
        const token = automationTokenRef.current;
        if (token) mixer.disengageAutomation(token);
        const pitches = pitchCheckpointRef.current;
        if (pitches) {
          for (const d of ROUTINE_DECK_ORDER) {
            const p = pitches[d];
            if (p !== undefined) decksRef.current[d].engine.setPitch(p);
          }
        }
      }
      automationTokenRef.current = null;
      pitchCheckpointRef.current = null;
    };
  }, [player, mixer, auditionTogglePlay, cancelArm]);

  // Deck-control takeover (gh#186), the pair editor's rule on four decks:
  // a mixer gesture during audition stands the replay down — decks keep
  // sounding, sounding values land in base, the borrow unwinds. Pitch
  // checkpoint dropped (the user keeps the running decks).
  useEffect(() => {
    const takeoverOpts = {
      mixer,
      surface: 'routine-editor' as const,
      standDown: () => player.standDown(),
      cancelArm,
      takeToken: () => {
        const token = automationTokenRef.current;
        automationTokenRef.current = null;
        pitchCheckpointRef.current = null;
        return token;
      },
    };
    const unMixer = watchAuditionTakeover(takeoverOpts);
    // Deck-engine gestures too (#205 bug report): play/pause, pitch, jog
    // bend or keylock on a DRIVEN deck while the audition holds = the
    // human taking the decks — the Conductor's rule, now that the
    // player's own writes are self-op guarded.
    const unDecks = watchDeckAuditionTakeover({
      ...takeoverOpts,
      engines: {
        A: decksRef.current.A.engine,
        B: decksRef.current.B.engine,
        C: decksRef.current.C.engine,
        D: decksRef.current.D.engine,
      },
      isSelfOp: () => player.isSelfOp(),
      drivenDecks: () => player.drivenDecks(),
    });
    return () => {
      unMixer();
      unDecks();
    };
  }, [player, mixer, cancelArm]);

  // One-sided role assignment stash (#221): ← or → with only one side
  // known waits for the other (the pair editor's assemble-a-pair flow);
  // the open pair artifact supplies the missing side when there is one.
  const pendingSidesRef = useRef<{ a?: number; b?: number }>({});
  const assignPairSide = useCallback(
    (side: 'a' | 'b') => {
      const track = sharedBrowseHandle.current?.getSelectedTrack();
      if (!track) return;
      const stash = pendingSidesRef.current;
      if (side === 'a') stash.a = track.id;
      else stash.b = track.id;
      const o = openedRef.current;
      const cur =
        o?.kind === 'transition' ? { a: o.aTrackId, b: o.bTrackId } : ({} as { a?: number; b?: number });
      const a = stash.a ?? cur.a;
      const b = stash.b ?? cur.b;
      if (a === undefined || b === undefined || a === b) return;
      pendingSidesRef.current = {};
      void openMixRef({ kind: 'new-transition', aTrackId: a, bTrackId: b });
    },
    [openMixRef]
  );

  // Space = play/pause; ⌘Z/⌘⇧Z = the draft's undo/redo (the undo story
  // the pair editor never grew) — while this view is visible.
  useEffect(() => {
    if (!viewActive) return;
    const onKey = (e: KeyboardEvent) => {
      // ⌘Z/⌘⇧Z first: isGuardedKeyEvent drops ALL meta combos (its job is
      // guarding bare performance keys), but undo/redo ARE meta combos.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) draftStore.redo();
        else draftStore.undo();
        return;
      }
      if (isGuardedKeyEvent(e)) return;
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        auditionTogglePlay();
        return;
      }
      // Browse-table keys (#221 entry 6 — the pair editor's role-assign,
      // kept for pair drafts): ↑/↓ walk the shared browse panel; ← assigns
      // the selected track as the OUTGOING, → as the INCOMING (Enter =
      // outgoing). Assignment replaces that side of the open pair (the
      // other side carries over; both sides fresh = nothing until the
      // second key) and opens a seeded draft on the new pair's move.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        sharedBrowseHandle.current?.navigate(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        assignPairSide(e.key === 'ArrowRight' ? 'b' : 'a');
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [viewActive, auditionTogglePlay, draftStore, assignPairSide]);

  // Re-render on player state changes (play/pause/seek).
  const [, bump] = useState(0);
  useEffect(() => player.subscribe(() => bump((n) => n + 1)), [player]);

  // Shared browse panel below the editor (gh#170 pass 2 layout — the
  // app's standard top-panel-over-library arrangement). Row loads route
  // to plain deck loads (the Performance posture; the routine editor has
  // no A/B assignment semantics).
  useEffect(
    () =>
      registerBrowseHost('routine', {
        onLoadToDeck: (deck, track) => decksRef.current[deck].loadTrack(track),
        doubleClickDeck: 'A',
        // #221 quick fix: browse rows navigate the PICKER, not the decks —
        // ⋈ fills a chip and opens the seeded draft when the pair
        // completes; ⌕ fills only; double-click = ⌕.
        rowActions: [
          {
            icon: '⋈',
            title:
              'Edit with this track — fills the picker (first empty chip, else the incoming) and opens a draft when the pair completes',
            run: (track) => fillPickerChip({ trackId: track.id, intent: 'edit' }),
          },
          {
            icon: '⌕',
            title:
              'Find this track in the picker — everything out of / into / over it (fills the first empty chip, else the incoming)',
            run: (track) => fillPickerChip({ trackId: track.id, intent: 'search' }),
          },
        ],
        onDoubleClick: (track) => fillPickerChip({ trackId: track.id, intent: 'search' }),
      }),
    []
  );

  // ── Boundary trim (tier 3) ───────────────────────────────────────────
  const [trim, setTrim] = useState<TrimRange | null>(null);
  useEffect(() => {
    setTrim(detail ? { startBeat: 0, endBeat: detail.duration_beats } : null);
  }, [detail]);
  const trimEnabled = !!detail?.origin_take_uuid && opened?.kind === 'routine';
  const trimDirty =
    !!trim &&
    !!detail &&
    (Math.abs(trim.startBeat) > 0.05 || Math.abs(trim.endBeat - detail.duration_beats) > 0.05);
  const droppedSlots = useMemo(() => {
    if (!detail || !trim) return [];
    return detail.entry_offsets_beats
      .map((b, slot) => ({ slot, b }))
      .filter(({ b }) => b >= trim.endBeat)
      .map(({ slot }) => slot);
  }, [detail, trim]);
  const [retrimBusy, setRetrimBusy] = useState(false);
  const applyTrim = useCallback(async () => {
    if (!detail || !trim || !trimDirty || retrimBusy) return;
    setRetrimBusy(true);
    try {
      const d = await api.routines.retrim(detail.uuid, {
        trim_start_beats: trim.startBeat,
        // NEGATIVE widens (endBeat dragged past duration) — do not clamp
        // (gh#190 item 8: the old Math.max(0, …) silently no-oped every
        // outward end trim).
        trim_end_beats: detail.duration_beats - trim.endBeat,
      });
      // Same uuid, rebased clock: reload the draft from the response
      // (the server shifted the edits layer with the trim).
      draftStore.load(d.uuid, parseEdits(d.edits));
      queryClient.setQueryData(['routine-detail', detail.uuid], d);
      queryClient.setQueryData(['routine', detail.uuid], d);
      await queryClient.invalidateQueries({ queryKey: ['routines'] });
      toast(`Re-promoted ${detail.name || 'routine'} with trimmed boundaries`);
    } catch (err) {
      toast(`Re-promotion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetrimBusy(false);
    }
  }, [detail, trim, trimDirty, retrimBusy, queryClient, toast]);

  // ── Transport readout (rAF text — beats advance continuously) ────────
  const beatReadoutRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = beatReadoutRef.current;
      if (el && editor) {
        const beat = player.getBeat();
        el.textContent = `${beatLabel(beat)} b · ${secondsLabel(beat * editor.planned.secPerBeat)}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, editor]);

  const onSeekBeat = useCallback(
    (beat: number) => {
      const r = player.getRoutine();
      if (!r) return;
      player.seek(beat * r.secPerBeat);
    },
    [player]
  );

  // ── Picker plumbing (#205) ───────────────────────────────────────────
  // Inline mutations on Transitions (★/rename/delete): client-authoritative
  // pair replace, the pair editor's own write path.
  const mutatePairItems = useCallback(
    (
      aTrackId: number,
      bTrackId: number,
      fn: (
        items: { uuid: string; name: string; favorite: boolean; data: Record<string, unknown> }[]
      ) => { uuid: string; name: string; favorite: boolean; data: Record<string, unknown> }[]
    ) => {
      const rows = transitionRowsRef.current
        .filter((r) => r.a_track_id === aTrackId && r.b_track_id === bTrackId)
        .sort((x, y) => x.position - y.position);
      const items = rows.map((r) => ({
        uuid: r.uuid,
        name: r.name,
        favorite: r.favorite,
        data: r.data,
      }));
      void api.transitions
        .replacePair(aTrackId, bTrackId, fn(items))
        .then((rows: TransitionRowFull[]) => {
          reconcilePairFromServer(`${aTrackId}:${bTrackId}`, rows);
          return queryClient.invalidateQueries({ queryKey: ['transitions'] });
        })
        .catch((err) => toast(`Save failed: ${err instanceof Error ? err.message : String(err)}`));
    },
    [queryClient, toast]
  );
  const promoteReview = useCallback(async () => {
    const o = openedRef.current;
    if (o?.kind === 'transition' && o.reviewTakeUuid) {
      // Pair-take review (#205 slice 2): mint the Transition from the
      // reviewed draft (seed + your edits through the lossless save) and
      // mark the take promoted — the pair editor's promote semantics on
      // the slot surface.
      const p = projRef.current;
      if (!p) return;
      setOpenFlowBusy(true);
      try {
        const snap = draftStore.getSnapshot();
        const diff = changedPairEdits(snap.edits, p.edits);
        const original = o.seed;
        if (!original) return;
        const data = editsToTransition(diff, {
          original,
          durationBeats: p.detail.duration_beats,
          secPerBeat: p.secPerBeat,
        });
        const rows = transitionRowsRef.current
          .filter((r) => r.a_track_id === o.aTrackId && r.b_track_id === o.bTrackId)
          .sort((x, y) => x.position - y.position);
        const items = rows.map((r) => ({
          uuid: r.uuid,
          name: r.name,
          favorite: r.favorite,
          data: r.data,
        }));
        items.push({
          uuid: o.uuid,
          name: `Transition ${rows.length + 1}`,
          favorite: false,
          data: data as unknown as Record<string, unknown>,
        });
        const saved = await api.transitions.replacePair(o.aTrackId, o.bTrackId, items);
        reconcilePairFromServer(`${o.aTrackId}:${o.bTrackId}`, saved as never);
        await api.takes.setPromoted(o.reviewTakeUuid, o.uuid);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['transitions'] }),
          queryClient.invalidateQueries({ queryKey: ['takes'] }),
        ]);
        toast('Promoted — the take is now a saved Transition (edits carried over)');
        setOpened({ kind: 'transition', aTrackId: o.aTrackId, bTrackId: o.bTrackId, uuid: o.uuid });
      } catch (err) {
        toast(`Promote failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setOpenFlowBusy(false);
      }
      return;
    }
    if (o?.kind !== 'review') return;
    setOpenFlowBusy(true);
    try {
      let routineUuidOut: string;
      if (o.source === 'routine-take') {
        const take = routineTakeRowsRef.current.find((t) => t.uuid === o.uuid);
        if (!take) return;
        routineUuidOut = await openRoutineTakeInEditor(take);
      } else {
        const cand = candidateRowsRef.current.find((c) => c.uuid === o.uuid);
        if (!cand) return;
        routineUuidOut = await openCandidateInEditor(cand);
      }
      // The preview and the promote run the same pipeline over the same
      // inputs — geometry is identical, so review edits transfer 1:1.
      const edits = draftStore.getSnapshot().edits;
      if (!editsAreEmpty(edits)) {
        await api.routines.saveEdits(
          routineUuidOut,
          editsForSave(edits) as Record<string, unknown> | null
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['routines'] }),
        queryClient.invalidateQueries({ queryKey: ['routine-takes'] }),
        queryClient.invalidateQueries({ queryKey: ['routine-candidates'] }),
      ]);
      toast('Promoted — the review draft is now a saved Routine (edits carried over)');
      setOpened({ kind: 'routine', uuid: routineUuidOut });
    } catch (err) {
      toast(`Promote failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpenFlowBusy(false);
    }
  }, [draftStore, queryClient, toast]);

  const deckTrackIds = useMemo(
    () =>
      ROUTINE_DECK_ORDER.map((d) => decks[d].loadedTrack?.id).filter(
        (id): id is number => typeof id === 'number'
      ),
    [decks]
  );
  // Scoped sibling cycling: within the current artifact's move.
  const cycle = useMemo(() => {
    if (!opened || opened.kind === 'review') return null;
    if (opened.kind === 'transition') {
      if (opened.seed) return null; // unsaved drafts have no siblings yet
      return siblingCycle(
        { kind: 'transition', aTrackId: opened.aTrackId, bTrackId: opened.bTrackId, uuid: opened.uuid },
        transitionRows,
        routineRows
      );
    }
    return siblingCycle({ kind: 'routine', uuid: opened.uuid }, transitionRows, routineRows);
  }, [opened, transitionRows, routineRows]);
  // The pair "✎ edited" badge compares against the projection baseline —
  // a projected pair's draft holds every drawn lane, which is not an edit.
  const pairDirty = proj ? !editsAreEmpty(changedPairEdits(draft.edits, proj.edits)) : false;

  // ── Render ───────────────────────────────────────────────────────────
  // Provenance (gh#170 deep-link): the origin Routine Take carries the
  // source Session reference.
  const sourceTake = detail?.origin_take_uuid
    ? routineTakeRows.find((t) => t.uuid === detail.origin_take_uuid) ?? null
    : null;
  const entryTrack = detail ? tracks.get(detail.cast[0]) : undefined;
  const exitTrack = detail ? tracks.get(detail.cast[detail.cast.length - 1]) : undefined;
  const playing = player.isPlaying();
  // The header name is an EDITABLE field (redirect 2026-08-31: the deck
  // track-title idiom) — renames persist to the open artifact by kind.
  const currentName =
    opened?.kind === 'transition' ? pairRow?.name ?? '' : routineDetail?.name ?? '';
  const reviewLabel =
    opened?.kind === 'review'
      ? `${detail ? `${detail.cast.length}-track ` : ''}${opened.source === 'routine-take' ? 'Routine Take' : 'candidate'} — review draft`
      : opened?.kind === 'transition' && opened.reviewTakeUuid
        ? 'Take — review draft'
        : null;
  const namePlaceholder =
    opened?.kind === 'transition'
      ? 'Transition'
      : routineDetail
        ? `${routineDetail.cast.length}-track routine`
        : 'Routine';
  // Persisted artifacts rename; an unsaved seed has no row to rename yet.
  const canRename =
    opened?.kind === 'review' ? false : opened?.kind === 'transition' ? !!pairRow : !!routineDetail;
  const currentTracks =
    opened?.kind === 'transition'
      ? `${entryTrack?.title || entryTrack?.filename || `#${opened.aTrackId}`} → ${exitTrack?.title || exitTrack?.filename || `#${opened.bTrackId}`}`
      : null;
  const renameCurrent = useCallback(
    (name: string) => {
      const o = openedRef.current;
      if (!o) return;
      const trimmed = name.trim();
      if (o.kind === 'transition') {
        mutatePairItems(o.aTrackId, o.bTrackId, (items) =>
          items.map((it) => (it.uuid === o.uuid ? { ...it, name: trimmed } : it))
        );
        return;
      }
      void api.routines
        .rename(o.uuid, trimmed || null)
        .then(() =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: ['routines'] }),
            queryClient.invalidateQueries({ queryKey: ['routine-detail', o.uuid] }),
            queryClient.invalidateQueries({ queryKey: ['routine', o.uuid] }),
          ])
        )
        .catch((err) => toast(`Rename failed: ${err instanceof Error ? err.message : String(err)}`));
    },
    [mutatePairItems, queryClient, toast]
  );
  // The panel's chip sync target (stable identity per pair).
  const openPairForPicker = useMemo(
    () =>
      opened?.kind === 'transition'
        ? { aTrackId: opened.aTrackId, bTrackId: opened.bTrackId }
        : null,
    [opened]
  );
  const openRefKey = !opened
    ? null
    : opened.kind === 'transition'
      ? `transition:${opened.uuid}`
      : opened.kind === 'review'
        ? `${opened.source}:${opened.uuid}`
        : `routine:${opened.uuid}`;

  return (
    <div className="routine-editor">
      <div className="re-header">
        <span className="re-kind">
          {opened?.kind === 'transition'
            ? opened.reviewTakeUuid
              ? '⇄ REVIEW'
              : '⇄ TRANSITION'
            : opened?.kind === 'review'
              ? opened.source === 'routine-take'
                ? '◇ REVIEW'
                : '⧉ REVIEW'
              : '◆ ROUTINE'}
        </span>
        {opened && (
          <span className="mp-current">
            {canRename ? (
              <EditableCell
                value={currentName}
                onSave={renameCurrent}
                placeholder={namePlaceholder}
              />
            ) : (
              <span>
                {reviewLabel ?? (opened.kind === 'transition' ? 'New Transition' : namePlaceholder)}
              </span>
            )}
            {(opened.kind === 'review' ||
              (opened.kind === 'transition' && opened.reviewTakeUuid)) && (
              <button
                className="btn btn-mini re-promote"
                disabled={openFlowBusy || !detail}
                onClick={() => void promoteReview()}
                title={
                  opened.kind === 'transition'
                    ? 'Promote to a saved Transition and mark the take — the explicit persisting act; your review edits carry over'
                    : opened.source === 'routine-take'
                      ? 'Promote to a saved Routine — the explicit persisting act; your review edits carry over'
                      : 'Confirm into a Routine Take and promote — the explicit persisting act; your review edits carry over'
                }
              >
                ↑ Promote
              </button>
            )}
            {currentTracks && <span className="mp-current-tracks">· {currentTracks}</span>}
          </span>
        )}
        {setCtx && (
          <button
            className="btn btn-mini re-setctx"
            title="Pin-follow armed (set context): switching artifacts within this move re-points the Set pin. Navigating to a different pair/cast disarms. Click to disarm now."
            onClick={() => setSetCtx(null)}
          >
            ⚑ pin-follow
          </button>
        )}
        {cycle && cycle.refs.length > 1 && cycle.index >= 0 && (
          <span className="mp-cycle" title="Cycle siblings within this move (the ordered pair / the cast)">
            <button
              className="btn btn-mini"
              disabled={cycle.index <= 0}
              onClick={() => void openMixRef(cycle.refs[cycle.index - 1])}
            >
              ◀
            </button>
            {cycle.index + 1}/{cycle.refs.length}
            <button
              className="btn btn-mini"
              disabled={cycle.index >= cycle.refs.length - 1}
              onClick={() => void openMixRef(cycle.refs[cycle.index + 1])}
            >
              ▶
            </button>
          </span>
        )}
        {detail && (
          <>
            <span className="re-contract">
              enters with{' '}
              <b style={{ color: slotAccent(editor?.planned.slots[0]?.deck) }}>
                {entryTrack?.title || entryTrack?.filename || `#${detail.cast[0]}`}
              </b>{' '}
              · exits with{' '}
              <b style={{ color: slotAccent(editor?.planned.slots[detail.cast.length - 1]?.deck) }}>
                {exitTrack?.title || exitTrack?.filename || `#${detail.cast[detail.cast.length - 1]}`}
              </b>
            </span>
            <span className="re-meta">
              {detail.cast.length} slots · {Math.round(detail.duration_beats)} beats
              {editor
                ? ` · ${secondsLabel(detail.duration_beats * editor.planned.secPerBeat)}`
                : ''}
            </span>
            {sourceTake && (
              <button
                className="re-source"
                title="Open in Session timeline — the routine's source span, region guide flashed (provenance deep-link)"
                onClick={() =>
                  openRoutineSource({
                    sessionUuid: sourceTake.session_uuid,
                    startS: sourceTake.window_start_s,
                    endS: sourceTake.window_end_s,
                  })
                }
              >
                ▦ source
              </button>
            )}
          </>
        )}
      </div>

      {detail && (
        <div className="re-transport">
          <button
            className={`re-play${playing ? ' on' : ''}${armPending ? ' arming' : ''}`}
            onClick={auditionTogglePlay}
            disabled={!editor}
            title={
              playing
                ? 'Pause the audition'
                : armPending
                  ? 'Loading decks… (press again to cancel)'
                  : 'Audition the Routine through the shared Decks'
            }
          >
            {playing ? '❚❚' : armPending ? '…' : '▶'}
          </button>
          <span className="re-modebar" role="group" aria-label="Editor mode">
            {(['select', 'pan', 'jump'] as EditorMode[]).map((m) => (
              <button
                key={m}
                className={`re-modebtn${editorMode === m ? ' on' : ''}`}
                title={MODE_TITLES[m]}
                onClick={() => setEditorMode(m)}
              >
                {MODE_LABELS[m]}
                <kbd>{MODE_KEY_HINTS[m]}</kbd>
              </button>
            ))}
          </span>
          <span className="re-beat" ref={beatReadoutRef} />
          <span className="re-history">
            <button
              className="re-histbtn"
              disabled={!draft.canUndo}
              title="Undo (⌘Z)"
              onClick={() => draftStore.undo()}
            >
              ↩
            </button>
            <button
              className="re-histbtn"
              disabled={!draft.canRedo}
              title="Redo (⌘⇧Z)"
              onClick={() => draftStore.redo()}
            >
              ↪
            </button>
            {(opened?.kind === 'transition' ? pairDirty : !editsAreEmpty(draft.edits)) && (
              <span
                className="re-edited"
                title={
                  opened?.kind === 'transition'
                    ? 'Edits over the pair artifact — autosaved through the pair↔slot translation (only changed fields re-derive; ADR 0037).'
                    : 'Authored edits over the recording (lanes/jumps) — autosaved; the set Conductor replays them too. The recording itself never changes.'
                }
              >
                ✎ edited
              </span>
            )}
          </span>
          <label className="re-bpm">
            @
            <input
              type="number"
              min={40}
              max={220}
              step={0.1}
              value={effectiveBpm !== null && effectiveBpm !== undefined ? Number(effectiveBpm.toFixed(1)) : ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) {
                  bpmTouchedFor.current = detail.uuid;
                  setTargetBpm(v);
                }
              }}
            />
            BPM
            {nativeBpm !== null && targetBpm !== null && Math.abs(targetBpm - nativeBpm) > 0.05 && (
              <button
                className="re-bpmreset"
                title={`Back to the recording's native tempo (${nativeBpm.toFixed(1)})`}
                onClick={() => {
                  bpmTouchedFor.current = null;
                  setTargetBpm(null);
                }}
              >
                ↺
              </button>
            )}
          </label>
          {trimEnabled && trim && (
            <span className="re-trim">
              <span className={`re-trimlabel${trimDirty ? ' dirty' : ''}`}>
                window {beatLabel(trim.startBeat)} → {beatLabel(trim.endBeat)} b
                {trim.startBeat < -0.05 || trim.endBeat > detail.duration_beats + 0.05
                  ? ' (widens — clamped to the session slice)'
                  : ''}
              </span>
              {droppedSlots.length > 0 && (
                <span className="re-trimdrop">
                  drops slot{droppedSlots.length > 1 ? 's' : ''} {droppedSlots.join(', ')}
                  {detail.cast.length - droppedSlots.length < 3 ? ' — below n=3!' : ''}
                </span>
              )}
              {trimDirty && (
                <>
                  <button
                    className="re-trimapply"
                    disabled={retrimBusy || detail.cast.length - droppedSlots.length < 3}
                    onClick={applyTrim}
                    title="Re-promote the origin Routine Take with these boundaries (mechanical — the raw Take is untouched)"
                  >
                    {retrimBusy ? 'Re-promoting…' : '✓ Apply trim (re-promote)'}
                  </button>
                  <button
                    className="re-trimreset"
                    onClick={() => setTrim({ startBeat: 0, endBeat: detail.duration_beats })}
                  >
                    ↺
                  </button>
                </>
              )}
            </span>
          )}
          {!trimEnabled && detail && opened?.kind !== 'transition' && (
            <span className="re-trim re-trimoff" title="No origin Routine Take — boundaries are baked">
              trim unavailable (no origin take)
            </span>
          )}
          {editor && editor.warnings.length > 0 && (
            <span className="re-warnings">
              {editor.warnings.map((w, i) => (
                <span key={i} className={`re-warning ${w.severity}`} title={w.message}>
                  ⚠ {w.kind}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="re-body">
        <div className="re-main">
          {!detail && (
            <div className="re-empty">
              Open a mix with the picker at the right — name two tracks to land on their
              Transitions, Cameos and Routines (⇄ Transitions open here through the pair↔slot
              translation, ADR 0037), or come in from a Set pin / the Transition history's ◆
              rows.
            </div>
          )}
          {detail && missingBpm && (
            <div className="re-empty">
              Cast tracks are missing BPM — the beat-domain build needs every cast member's
              tempo.
            </div>
          )}
          {editor && (
            <RoutineTimeline
              editor={editor}
              plannedForRuns={baseEditor!.planned}
              recordedJumpsBySlot={recordedJumpsBySlot}
              recordedPausesBySlot={recordedPausesBySlot}
              tracks={tracks}
              waves={waves}
              meters={meters}
              hotcues={hotcuesMap}
              player={player}
              draftStore={draftStore}
              edits={draft.edits}
              trim={trimEnabled ? trim : null}
              onTrimChange={trimEnabled ? setTrim : null}
              onSeekBeat={onSeekBeat}
              mode={editorMode}
              onModeHome={() => setEditorMode('select')}
            />
          )}
        </div>
        <MixPicker
          openPair={openPairForPicker}
          openRefKey={openRefKey}
          tracks={allTracks}
          transitions={transitionRows}
          cameos={cameoRows}
          routines={routineRows}
          routineTakes={unpromotedTakes}
          candidates={unconfirmedCandidates}
          takes={takeRows}
          deckTrackIds={deckTrackIds}
          busy={openFlowBusy}
          onOpen={(ref) => void openMixRef(ref)}
          onRenameTransition={(ref, name) =>
            mutatePairItems(ref.aTrackId, ref.bTrackId, (items) =>
              items.map((it) => (it.uuid === ref.uuid ? { ...it, name } : it))
            )
          }
          onToggleFavoriteTransition={(ref) =>
            mutatePairItems(ref.aTrackId, ref.bTrackId, (items) =>
              items.map((it) => (it.uuid === ref.uuid ? { ...it, favorite: !it.favorite } : it))
            )
          }
          onDeleteTransition={(ref) => {
            mutatePairItems(ref.aTrackId, ref.bTrackId, (items) =>
              items.filter((it) => it.uuid !== ref.uuid)
            );
            if (opened?.kind === 'transition' && opened.uuid === ref.uuid) setOpened(null);
          }}
          trackById={trackById}
        />
      </div>
    </div>
  );
}
