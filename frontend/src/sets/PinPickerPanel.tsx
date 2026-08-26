/**
 * Pin picker panel (sets 160, prototype variant P): the per-adjacency
 * picker listing — in trust order — the Routines offerable from this
 * head (three tiers: saved Routine > unpromoted Routine Take >
 * unconfirmed set-matched candidate, visually distinct), the pair's
 * saved Transitions, its Takes, and the explicit Hard cut. Replaces the
 * old flat ContextMenu picker.
 *
 * Routine offerability (ADR 0035): cast = the next n entries from this
 * head, ending the covered sequence — saved Routines and Routine Takes
 * match client-side (routineOfferable), unconfirmed candidates through
 * the cast-prefix endpoint (routines 157). Picking a lower tier is the
 * explicit human act the doctrine requires: a Routine Take promotes
 * (mechanical, ADR 0035) and pins the Routine; a candidate confirms at
 * the miner's boundaries into a Routine Take, promotes, and pins — the
 * sequence match evidences intent (ADR 0035 exception).
 */
import { ROUTINE_ACCENT } from '../theme/routineColor';
import { openRoutineSource, routineSourceFromTakes, type RoutineSource } from '../routines/provenance';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type RoutineCandidateWire,
  type RoutineRowWire,
  type RoutineTakeRowWire,
} from '../api/client';
import { clampToViewport } from '../components/ContextMenu';
import { useToast } from '../components/Toast';
import {
  routineOfferable,
  type AdjacencyPin,
  type TakeEvidence,
  type TransitionEvidence,
} from './adjacency';
import './PinPickerPanel.css';

/** The routine family's color (matches the Session timeline's candidate
 * chips — bright, fully saturated magenta; sessionTimeline.css). */
export const ROUTINE_COLOR = ROUTINE_ACCENT;

interface PinPickerPanelProps {
  x: number;
  y: number;
  /** The adjacency's ordered pair. */
  aTrackId: number;
  bTrackId: number;
  pin: AdjacencyPin | null;
  transitions: readonly TransitionEvidence[];
  takes: readonly TakeEvidence[];
  /** Entry track ids from this head to the Set's end, in Set order —
   * the routine tiers' offerability input. */
  upcomingTrackIds: readonly number[];
  trackLabel: (trackId: number) => string;
  onPin: (pin: AdjacencyPin | null) => void;
  /** Pin a Routine (the cast rides along to prime dormancy's lookup). */
  onPinRoutine: (uuid: string, cast: readonly number[]) => void;
  onClose: () => void;
}

/** Entry-offset mini-gantt for a routine option: one lane per slot, the
 * bar running from the slot's entry to the span end (recorded interior
 * detail waits for replay, sets #159). */
function CastLanes({
  cast,
  offsets,
  total,
  trackLabel,
}: {
  cast: readonly number[];
  offsets: readonly number[];
  total: number;
  trackLabel: (trackId: number) => string;
}) {
  return (
    <div className="ppp-lanes">
      {cast.map((trackId, s) => {
        const off = offsets[s] ?? 0;
        const left = total > 0 ? Math.min(100, (off / total) * 100) : 0;
        return (
          <div key={s} className="ppp-lane">
            <span className="ppp-lane-label">{trackLabel(trackId)}</span>
            <span className="ppp-lane-track">
              <i style={{ left: `${left}%`, width: `${Math.max(2, 100 - left)}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function PinPickerPanel({
  x,
  y,
  aTrackId,
  bTrackId,
  pin,
  transitions,
  takes,
  upcomingTrackIds,
  trackLabel,
  onPin,
  onPinRoutine,
  onClose,
}: PinPickerPanelProps) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  /** An async pin act (promote / confirm+promote) in flight — the panel
   * stays up, options go inert, the acted row shows a spinner glyph. */
  const [busyUuid, setBusyUuid] = useState<string | null>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition(
      clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    );
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [onClose]);

  // ── Routine tiers ──────────────────────────────────────────────────
  const routineTiersPossible = upcomingTrackIds.length >= 3;
  const { data: routines = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: api.routines.list,
    enabled: routineTiersPossible,
  });
  const { data: routineTakes = [] } = useQuery({
    queryKey: ['routine-takes'],
    queryFn: api.routineTakes.list,
    enabled: routineTiersPossible,
  });
  const upcomingKey = upcomingTrackIds.join(',');
  const { data: candidates = [] } = useQuery({
    queryKey: ['routine-candidates', 'query', upcomingKey],
    queryFn: () => api.routineCandidates.query([...upcomingTrackIds]),
    enabled: routineTiersPossible,
  });

  const offeredRoutines = routines.filter((r) =>
    routineOfferable(upcomingTrackIds, 0, r.cast)
  );
  // Tier 2: unpromoted only — a promoted Take's Routine already sits in
  // tier 1 (one representation per choreography).
  const offeredTakes = routineTakes.filter(
    (rt) => rt.promoted_routine_uuid === null && routineOfferable(upcomingTrackIds, 0, rt.cast)
  );
  // Tier 3: candidates not yet confirmed into a Routine Take.
  const confirmedCandidateUuids = new Set(
    routineTakes.flatMap((rt) => (rt.origin_candidate_uuid ? [rt.origin_candidate_uuid] : []))
  );
  const offeredCandidates = candidates.filter((c) => !confirmedCandidateUuids.has(c.uuid));

  const pinSavedRoutine = (r: RoutineRowWire) => {
    onPinRoutine(r.uuid, r.cast);
    onClose();
  };

  const promoteAndPin = async (rt: RoutineTakeRowWire) => {
    setBusyUuid(rt.uuid);
    try {
      const routine = await api.routineTakes.promote(rt.uuid);
      await queryClient.invalidateQueries({ queryKey: ['routines'] });
      await queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
      onPinRoutine(routine.uuid, routine.cast);
      showToast(`Routine saved and pinned — ${routine.cast.length} slots`);
      onClose();
    } catch (err) {
      setBusyUuid(null);
      showToast(String(err));
    }
  };

  const confirmPromoteAndPin = async (c: RoutineCandidateWire) => {
    setBusyUuid(c.uuid);
    try {
      // Confirm at the miner's boundaries — picking the candidate here
      // IS the human confirmation (ADR 0035: the set match evidences
      // intent); boundary trim stays available on the Session timeline.
      const rt = await api.routineTakes.create({
        uuid: crypto.randomUUID(),
        session_uuid: c.session_uuid,
        window_start_s: c.window_start_s,
        window_end_s: c.window_end_s,
        cast: c.cast,
        entry_offsets: c.entry_offsets,
        origin_candidate_uuid: c.uuid,
      });
      const routine = await api.routineTakes.promote(rt.uuid);
      await queryClient.invalidateQueries({ queryKey: ['routines'] });
      await queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
      onPinRoutine(routine.uuid, routine.cast);
      showToast(`Candidate confirmed → Routine pinned — ${routine.cast.length} slots`);
      onClose();
    } catch (err) {
      setBusyUuid(null);
      showToast(String(err));
    }
  };

  const routineLabel = (r: RoutineRowWire) =>
    r.name?.trim() ? r.name : `${trackLabel(r.cast[0])} → … → ${trackLabel(r.cast[r.cast.length - 1])}`;

  const pick = (fn: () => void) => () => {
    if (busyUuid !== null) return;
    fn();
  };

  /** Provenance deep-link (gh#170): ▦ opens the source Session timeline
   * centered on the span with its region guide flashed. */
  const sourceBtn = (src: RoutineSource | null) =>
    src && (
      <button
        className="ppp-source"
        title="Open in Session timeline (the routine's source span)"
        onClick={(e) => {
          e.stopPropagation();
          openRoutineSource(src);
          onClose();
        }}
      >
        ▦
      </button>
    );

  return (
    <div
      ref={panelRef}
      className="ppp-panel"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ppp-title">
        PIN {trackLabel(aTrackId)} → {trackLabel(bTrackId)}
      </div>

      {routineTiersPossible &&
        (offeredRoutines.length > 0 ||
          offeredTakes.length > 0 ||
          offeredCandidates.length > 0) && (
          <>
            <div className="ppp-section ppp-routine">
              Routines from {trackLabel(aTrackId)}{' '}
              <small>(cast = next n entries, ends the sequence)</small>
            </div>
            {offeredRoutines.map((r) => (
              <div
                key={r.uuid}
                className={`ppp-opt ppp-routine-opt tier-saved${pin?.kind === 'routine' && pin.uuid === r.uuid ? ' current' : ''}`}
                onClick={pick(() => pinSavedRoutine(r))}
                title={`Saved Routine — pin it here: covers the next ${r.cast.length - 1} adjacencies; exits with ${trackLabel(r.cast[r.cast.length - 1])} playing`}
              >
                <b>◆ ROUTINE {routineLabel(r)}</b>
                {sourceBtn(routineSourceFromTakes(r.uuid, routineTakes))}
                <small>
                  {r.cast.length} slots · ~{Math.round(r.duration_beats)} beats · covers{' '}
                  {r.cast.length - 1} adjacencies
                  {pin?.kind === 'routine' && pin.uuid === r.uuid ? ' · pinned ✓' : ''}
                </small>
                <CastLanes
                  cast={r.cast}
                  offsets={r.entry_offsets_beats}
                  total={r.duration_beats}
                  trackLabel={trackLabel}
                />
              </div>
            ))}
            {offeredTakes.map((rt) => (
              <div
                key={rt.uuid}
                className="ppp-opt ppp-routine-opt tier-take"
                onClick={pick(() => void promoteAndPin(rt))}
                title="Unpromoted Routine Take — picking it promotes it (mechanical slot re-addressing + beat rebase) and pins the Routine"
              >
                <b>
                  {busyUuid === rt.uuid ? '… ' : ''}◆ Routine Take ·{' '}
                  {new Date(rt.confirmed_at).toLocaleDateString()}
                </b>
                {sourceBtn({ sessionUuid: rt.session_uuid, startS: rt.window_start_s, endS: rt.window_end_s })}
                <small>
                  {rt.cast.length} tracks · {Math.round(rt.window_end_s - rt.window_start_s)}s ·
                  promote → pin
                </small>
                <CastLanes
                  cast={rt.cast}
                  offsets={rt.entry_offsets}
                  total={rt.window_end_s - rt.window_start_s}
                  trackLabel={trackLabel}
                />
              </div>
            ))}
            {offeredCandidates.map((c) => (
              <div
                key={c.uuid}
                className="ppp-opt ppp-routine-opt tier-candidate"
                onClick={pick(() => void confirmPromoteAndPin(c))}
                title="Unconfirmed miner candidate whose cast matches this Set's next entries (lowest trust) — picking it confirms it at the miner's boundaries, promotes, and pins"
              >
                <b>
                  {busyUuid === c.uuid ? '… ' : ''}⧉ candidate (unconfirmed)
                </b>
                {sourceBtn({ sessionUuid: c.session_uuid, startS: c.window_start_s, endS: c.window_end_s })}
                <small>
                  {c.cast.length} tracks · {Math.round(c.window_end_s - c.window_start_s)}s ·
                  confirm → promote → pin
                </small>
                <CastLanes
                  cast={c.cast}
                  offsets={c.entry_offsets}
                  total={c.window_end_s - c.window_start_s}
                  trackLabel={trackLabel}
                />
              </div>
            ))}
          </>
        )}

      <div className="ppp-section ppp-transitions">
        Transitions {trackLabel(aTrackId)} → {trackLabel(bTrackId)}
      </div>
      {transitions.length > 0 ? (
        transitions.map((t) => (
          <div
            key={t.uuid}
            className={`ppp-opt ppp-transition-opt${pin?.kind === 'transition' && pin.uuid === t.uuid ? ' current' : ''}`}
            onClick={pick(() => {
              onPin({ kind: 'transition', uuid: t.uuid });
              onClose();
            })}
          >
            ◈ {t.favorite ? '★ ' : ''}
            {t.name}
            {pin?.kind === 'transition' && pin.uuid === t.uuid ? ' ✓' : ''}
          </div>
        ))
      ) : (
        <div className="ppp-none">none saved</div>
      )}

      <div className="ppp-section ppp-takes">Takes</div>
      {takes.length > 0 ? (
        takes.map((t) => (
          <div
            key={t.uuid}
            className={`ppp-opt ppp-take-opt${pin?.kind === 'take' && pin.uuid === t.uuid ? ' current' : ''}`}
            onClick={pick(() => {
              onPin({ kind: 'take', uuid: t.uuid });
              onClose();
            })}
          >
            ▸ {new Date(t.detectedAt).toLocaleString()}
            {t.windowS !== undefined ? ` · ${t.windowS.toFixed(1)}s` : ''}
            {pin?.kind === 'take' && pin.uuid === t.uuid ? ' ✓' : ''}
          </div>
        ))
      ) : (
        <div className="ppp-none">none</div>
      )}

      <div
        className={`ppp-opt ppp-hardcut${pin?.kind === 'hardcut' ? ' current' : ''}`}
        onClick={pick(() => {
          onPin({ kind: 'hardcut' });
          onClose();
        })}
      >
        ✂ hard cut — play no transition{pin?.kind === 'hardcut' ? ' ✓' : ''}
      </div>
      {pin !== null && (
        <div
          className="ppp-opt ppp-unpin"
          onClick={pick(() => {
            onPin(null);
            onClose();
          })}
          title={
            pin.kind === 'routine'
              ? 'Unpin the Routine — the covered adjacencies return to their own (shadowed) pins'
              : 'Unpin (auto-resolve from the library)'
          }
        >
          Unpin{pin.kind === 'routine' ? ' Routine (restore covered pins)' : ' (auto-resolve from the library)'}
        </div>
      )}
    </div>
  );
}
