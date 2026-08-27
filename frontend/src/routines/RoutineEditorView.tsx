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
import { api, type RoutineDetailWire } from '../api/client';
import type { HotCue, Track } from '../types';
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
import { watchAuditionTakeover } from '../editor/auditionTakeover';
import { armAudition } from '../editor/auditionArm';
import { isGuardedKeyEvent } from '../components/performance/performanceKeys';
import { useViewActive } from '../contexts/viewActive';
import { decodeWaveformBlob, type DecodedWaveform } from '../waveform/blob';
import { registerBrowseHost } from '../components/browseHost';
import {
  plannedWithLaneEdits,
  ROUTINE_DECK_ORDER,
  type RoutineDeck,
} from '../sets/routinePlan';
import { useToast } from '../components/Toast';
import { RoutinePlayer } from './RoutinePlayer';
import { RoutineTimeline, type TrimRange } from './RoutineTimeline';
import { consumeRoutineEdit, OPEN_ROUTINE_EVENT } from './openRoutine';
import { openCandidateInEditor, openRoutineTakeInEditor } from './openFlow';
import { openRoutineSource } from './provenance';
import { editsAreEmpty, parseEdits } from './routineDraft';
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
import './routineEditor.css';

const LAST_ROUTINE_KEY = 'manadj-last-routine';

export default function RoutineEditorView() {
  const mixer = useMixer();
  const decks = useDecks();
  const queryClient = useQueryClient();
  const toast = useToast();
  const viewActive = useViewActive();

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

  // ── Which Routine ────────────────────────────────────────────────────
  const [routineUuid, setRoutineUuid] = useState<string | null>(() => {
    const req = consumeRoutineEdit();
    return req?.routineUuid ?? localStorage.getItem(LAST_ROUTINE_KEY);
  });
  useEffect(() => {
    const onOpen = () => {
      const req = consumeRoutineEdit();
      if (req) setRoutineUuid(req.routineUuid);
    };
    window.addEventListener(OPEN_ROUTINE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ROUTINE_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (routineUuid) localStorage.setItem(LAST_ROUTINE_KEY, routineUuid);
  }, [routineUuid]);

  // Picker trust tiers (pass 2 directive 3): `r:` opens directly; `t:`
  // promotes-then-opens; `c:` confirms-then-promotes-then-opens (the
  // deliberate human act the suggestion-first doctrine requires).
  const [openFlowBusy, setOpenFlowBusy] = useState(false);
  const openPickerValue = useCallback(
    async (value: string) => {
      if (!value) {
        setRoutineUuid(null);
        return;
      }
      const [tier, uuid] = [value.slice(0, 1), value.slice(2)];
      if (tier === 'r') {
        setRoutineUuid(uuid);
        return;
      }
      setOpenFlowBusy(true);
      try {
        let routineUuidOut: string;
        if (tier === 't') {
          const take = routineTakeRowsRef.current.find((t) => t.uuid === uuid);
          if (!take) return;
          routineUuidOut = await openRoutineTakeInEditor(take);
        } else {
          const cand = candidateRowsRef.current.find((c) => c.uuid === uuid);
          if (!cand) return;
          routineUuidOut = await openCandidateInEditor(cand);
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['routines'] }),
          queryClient.invalidateQueries({ queryKey: ['routine-takes'] }),
          queryClient.invalidateQueries({ queryKey: ['routine-candidates'] }),
        ]);
        setRoutineUuid(routineUuidOut);
      } catch (err) {
        toast(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setOpenFlowBusy(false);
      }
    },
    [queryClient, toast]
  );

  const { data: routineRows = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: api.routines.list,
  });
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
  const { data: detail } = useQuery<RoutineDetailWire>({
    queryKey: ['routine-detail', routineUuid],
    queryFn: () => api.routines.get(routineUuid!),
    enabled: routineUuid !== null,
  });

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
  const nativeBpm = detail && cast.length > 0 ? tracks.get(cast[0])?.bpm ?? null : null;
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
  useEffect(() => {
    const d = detailRef.current;
    if (d && d.uuid === routineUuid) draftStore.load(d.uuid, parseEdits(d.edits));
    else if (!routineUuid) draftStore.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.uuid, draftStore]);

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
      const edits = snap.edits;
      saveTimer.current = setTimeout(() => {
        void api.routines
          .saveEdits(uuid, editsForSave(edits) as Record<string, unknown> | null)
          .then((d) => queryClient.setQueryData(['routine-detail', uuid], d))
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
  const trackBpms = useMemo(() => cast.map((id) => tracks.get(id)?.bpm ?? null), [cast, tracks]);
  const missingBpm = trackBpms.some((b) => b === null || b === undefined || b <= 0);
  const buildable = !!detail && !missingBpm && !!effectiveBpm && effectiveBpm > 0;
  // RAW build (no edits): recorded-jump marker provenance (ghosts keep
  // their place after removal).
  const rawEditor = useMemo(() => {
    if (!buildable) return null;
    return buildEditorRoutine(detail!, trackBpms as number[], effectiveBpm!, null);
  }, [detail, trackBpms, buildable, effectiveBpm]);
  const recordedJumpsBySlot = useMemo(
    () => (rawEditor ? rawEditor.planned.slots.map((s) => recordedJumps(s.trace)) : []),
    [rawEditor]
  );
  const recordedPausesBySlot = useMemo(
    () => (rawEditor ? rawEditor.planned.slots.map((s) => recordedPauses(s.trace)) : []),
    [rawEditor]
  );
  // Jump-edited base: traces carry authored/removed jumps. Lane edits
  // apply as a cheap re-skin below — trace identities survive lane drags
  // (the ~60 Hz hot path never rebuilds traces).
  // Nudges rebuild traces too (gh#190 item 6 — a rigid track-time slide
  // is a trace transform, not a lane re-skin).
  const jumpEditsKey = useMemo(
    () =>
      JSON.stringify({
        j: draft.edits.jumps,
        r: draft.edits.removedRecordedJumps,
        p: draft.edits.pauses,
        rp: draft.edits.removedRecordedPauses,
        n: draft.edits.nudges,
      }),
    [
      draft.edits.jumps,
      draft.edits.removedRecordedJumps,
      draft.edits.pauses,
      draft.edits.removedRecordedPauses,
      draft.edits.nudges,
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
  useEffect(
    () =>
      watchAuditionTakeover({
        mixer,
        surface: 'routine-editor',
        standDown: () => player.standDown(),
        cancelArm,
        takeToken: () => {
          const token = automationTokenRef.current;
          automationTokenRef.current = null;
          pitchCheckpointRef.current = null;
          return token;
        },
      }),
    [player, mixer, cancelArm]
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
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [viewActive, auditionTogglePlay, draftStore]);

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
      }),
    []
  );

  // ── Boundary trim (tier 3) ───────────────────────────────────────────
  const [trim, setTrim] = useState<TrimRange | null>(null);
  useEffect(() => {
    setTrim(detail ? { startBeat: 0, endBeat: detail.duration_beats } : null);
  }, [detail]);
  const trimEnabled = !!detail?.origin_take_uuid;
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

  // ── Render ───────────────────────────────────────────────────────────
  // Provenance (gh#170 deep-link): the origin Routine Take carries the
  // source Session reference.
  const sourceTake = detail?.origin_take_uuid
    ? routineTakeRows.find((t) => t.uuid === detail.origin_take_uuid) ?? null
    : null;
  const entryTrack = detail ? tracks.get(detail.cast[0]) : undefined;
  const exitTrack = detail ? tracks.get(detail.cast[detail.cast.length - 1]) : undefined;
  const playing = player.isPlaying();

  return (
    <div className="routine-editor">
      <div className="re-header">
        <span className="re-kind">◆ ROUTINE</span>
        <select
          className="re-picker"
          value={routineUuid ? `r:${routineUuid}` : ''}
          disabled={openFlowBusy}
          onChange={(e) => void openPickerValue(e.target.value)}
          title="Every detected tier opens here: saved Routines, unpromoted Routine Takes (promoted on open), unconfirmed miner candidates (confirmed + promoted on open — choosing one IS the confirming act)"
        >
          <option value="">— open a Routine —</option>
          <optgroup label="◆ saved Routines">
            {routineRows.map((r) => (
              <option key={r.uuid} value={`r:${r.uuid}`}>
                {r.name || `${r.cast.length}-track routine`} · {r.cast.length} tracks ·{' '}
                {Math.round(r.duration_beats)}b
              </option>
            ))}
          </optgroup>
          {unpromotedTakes.length > 0 && (
            <optgroup label="◇ Routine Takes (promote on open)">
              {unpromotedTakes.map((t) => (
                <option key={t.uuid} value={`t:${t.uuid}`}>
                  {t.cast.length} tracks · {secondsLabel(t.window_end_s - t.window_start_s)} ·
                  confirmed {t.confirmed_at?.slice(0, 10) ?? ''}
                </option>
              ))}
            </optgroup>
          )}
          {unconfirmedCandidates.length > 0 && (
            <optgroup label="⧉ miner candidates (confirm + promote on open)">
              {unconfirmedCandidates.map((c) => (
                <option key={c.uuid} value={`c:${c.uuid}`}>
                  {c.cast.length} tracks · {secondsLabel(c.window_end_s - c.window_start_s)} ·
                  returns {c.evidence?.returns ?? 0}
                </option>
              ))}
            </optgroup>
          )}
        </select>
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
            {!editsAreEmpty(draft.edits) && (
              <span
                className="re-edited"
                title="Authored edits over the recording (lanes/jumps) — autosaved; the set Conductor replays them too. The recording itself never changes."
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
          {!trimEnabled && detail && (
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

      {!detail && (
        <div className="re-empty">
          Open a Routine — from a Set's routine pin, the Transition history's ◆ rows, or the
          picker above.
        </div>
      )}
      {detail && missingBpm && (
        <div className="re-empty">
          Cast tracks are missing BPM — the beat-domain build needs every cast member's tempo.
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
        />
      )}
    </div>
  );
}
