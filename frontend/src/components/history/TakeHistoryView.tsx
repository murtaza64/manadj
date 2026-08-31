/**
 * Transition history (transition-takes 02; routines 158; cameos #140):
 * the chronological log of Takes, CAMEO TAKES, and Routine Takes — "what
 * did I actually mix, when" (glossary) — grouped with kin: rows sharing
 * an engagement identity sit together. Since #140 that identity is the
 * detector's engagement uuid when stamped (a double/triple's pairwise
 * Takes and Cameo Takes group as one move); rows without one (pre-#140,
 * hand cuts) fall back to the ordered pair, Routine Takes to the ordered
 * cast. Groups order by their newest member. False positives are kept
 * deliberately (delete is manual — ADR 0020). A Routine Take row can
 * promote (mechanical deck→slot + beat rebase, ADR 0035) right here;
 * Cameo Take promotion (→ a Cameo) waits for the kind-aware editor.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { RoutineTakeRowWire, TakeRowWire } from '../../api/client';
import { requestTakeReview } from '../../capture/takeReview';
import { pairEditorFallback, requestPairTakeEdit } from '../../routines/openMix';
import { requestRoutineEdit } from '../../routines/openRoutine';
import { requestSessionMoment } from '../../sessions/openSession';
import { degradeDeletedPinsLocal } from '../../sets/setStore';
import { useToast } from '../Toast';
import './takeHistory.css';

function fmtWhen(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtLen(sec: number): string {
  if (sec < 1) return 'cut';
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, '0')}s`;
}

/** One history row: a Take or a Routine Take, under a shared kin key. */
type HistoryEntry =
  | { kind: 'take'; when: string; kin: string; take: TakeRowWire }
  | { kind: 'routine'; when: string; kin: string; take: RoutineTakeRowWire };

export function TakeHistoryView() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['takes'] });
    void queryClient.invalidateQueries({ queryKey: ['routine-takes'] });
  };

  const { data: rows, error } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });
  const { data: routineRows } = useQuery({
    queryKey: ['routine-takes'],
    queryFn: api.routineTakes.list,
  });

  // Live update needs no listener here: the take sink invalidates
  // `['takes']` itself on persist (sets 13).

  // Kin groups (glossary "grouped with kin"): key = the engagement
  // identity — the detector's engagement uuid when stamped (#140), else
  // the ordered pair for Takes, the ordered cast for Routine Takes.
  // Groups sort by their newest member; rows within a group newest first.
  const groups = useMemo(() => {
    const entries: HistoryEntry[] = [
      ...(rows ?? []).map((t) => ({
        kind: 'take' as const,
        when: t.detected_at,
        kin: t.engagement_uuid
          ? `engagement:${t.engagement_uuid}`
          : `pair:${t.a_track_id}->${t.b_track_id}`,
        take: t,
      })),
      ...(routineRows ?? []).map((t) => ({
        kind: 'routine' as const,
        when: t.confirmed_at,
        kin: `cast:${t.cast.join('->')}`,
        take: t,
      })),
    ];
    const byKin = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const list = byKin.get(e.kin);
      if (list) list.push(e);
      else byKin.set(e.kin, [e]);
    }
    const out = [...byKin.values()];
    for (const list of out) list.sort((a, b) => b.when.localeCompare(a.when));
    out.sort((a, b) => b[0].when.localeCompare(a[0].when));
    return out;
  }, [rows, routineRows]);

  const trackIds = useMemo(
    () =>
      [
        ...new Set([
          ...(rows ?? []).flatMap((t) => [t.a_track_id, t.b_track_id]),
          ...(routineRows ?? []).flatMap((t) => t.cast),
        ]),
      ].sort((a, b) => a - b),
    [rows, routineRows]
  );
  const { data: labels } = useQuery({
    queryKey: ['take-track-labels', trackIds],
    enabled: trackIds.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        trackIds.map(async (id) => {
          try {
            const track = await api.tracks.getById(id);
            return [id, track.title || `track ${id}`] as const;
          } catch {
            return [id, `track ${id}`] as const;
          }
        })
      );
      return Object.fromEntries(entries) as Record<number, string>;
    },
  });

  const remove = async (uuid: string) => {
    await api.takes
      .delete(uuid)
      // The endpoint degraded Set pins referencing this Take (sets 12);
      // mirror it in loaded Sets so client-authoritative entries agree.
      .then(() => degradeDeletedPinsLocal('take', uuid))
      .catch((err) => console.error('take delete failed', err));
    invalidate();
  };

  const removeRoutine = async (uuid: string) => {
    await api.routineTakes.delete(uuid).catch((err) => console.error('routine take delete failed', err));
    invalidate();
  };

  const promote = async (uuid: string): Promise<string | null> => {
    try {
      const routine = await api.routineTakes.promote(uuid);
      toast(
        `Promoted — Routine saved: ${routine.cast.length} slots · ${Math.round(routine.duration_beats)} beats.`
      );
      invalidate();
      return routine.uuid;
    } catch (err) {
      toast(String(err));
      invalidate();
      return null;
    }
  };

  const label = (id: number) => labels?.[id] ?? `track ${id}`;

  const empty = (rows?.length ?? 0) === 0 && (routineRows?.length ?? 0) === 0;

  return (
    <div className="take-history">
      {error ? <div className="take-history-error">{String(error)}</div> : null}
      {rows === undefined ? (
        <div className="take-history-empty">Loading…</div>
      ) : empty ? (
        <div className="take-history-empty">
          No Takes yet — mix something in the Performance view and finished handovers land here.
        </div>
      ) : (
        <table className="take-history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Engagement</th>
              <th>Window</th>
              <th>Confidence</th>
              <th />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const head = group[0];
              const kinLabel =
                head.kind === 'take'
                  ? head.take.kind === 'guest'
                    ? `${label(head.take.b_track_id)} over ${label(head.take.a_track_id)}`
                    : `${label(head.take.a_track_id)} → ${label(head.take.b_track_id)}`
                  : head.take.cast.map(label).join(' → ');
              return [
                <tr key={`kin-${head.kin}`} className="take-kin-header">
                  <td colSpan={7}>
                    {head.kind === 'routine' ? '◆ ' : head.take.kind === 'guest' ? '◐ ' : ''}
                    {kinLabel}
                    <span className="take-kin-count">
                      {group.length > 1 ? ` · ${group.length} takes` : ''}
                    </span>
                  </td>
                </tr>,
                ...group.map((e) =>
                  e.kind === 'take' ? (
                    <tr
                      key={e.take.uuid}
                      className={e.take.kind === 'guest' ? 'take-row guest' : 'take-row'}
                      title={
                        e.take.kind === 'guest'
                          ? e.take.session_uuid
                            ? 'A Cameo Take (#140) — view this tease on its Session timeline (Cameo review/promotion arrives with the kind-aware editor)'
                            : 'A Cameo Take (#140) — review/promotion arrives with the kind-aware editor'
                          : e.take.promoted_transition_uuid
                            ? 'Open its promoted Transition in the editor'
                            : 'Review this Take in the Transition editor'
                      }
                      onClick={() => {
                        // Vectorization's Cameo mode is deferred with the
                        // editor (#140 tracer): a guest Take deep-links to
                        // its Session moment instead of a Transition draft.
                        if (e.take.kind === 'guest') {
                          if (e.take.session_uuid) {
                            requestSessionMoment({
                              sessionUuid: e.take.session_uuid,
                              atS: e.take.window_start_s,
                            });
                          }
                          return;
                        }
                        // #221: pair takes review on the Mix editor
                        // (legacy pair editor behind the fallback flag).
                        if (pairEditorFallback()) requestTakeReview(e.take.uuid);
                        else requestPairTakeEdit(e.take);
                      }}
                    >
                      <td className="take-when">{fmtWhen(e.take.detected_at)}</td>
                      <td className="take-pair">
                        {e.take.kind === 'guest' ? (
                          <>
                            <span
                              className="take-guest-badge"
                              title="Cameo Take: the host survived — the guest rode over it (#140)"
                            >
                              ◐
                            </span>{' '}
                            <span title={`guest: ${label(e.take.b_track_id)}`}>
                              {label(e.take.b_track_id)}
                            </span>
                            <span className="take-arrow"> over </span>
                            <span title={`host: ${label(e.take.a_track_id)}`}>
                              {label(e.take.a_track_id)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span title={`outgoing: ${label(e.take.a_track_id)}`}>
                              {label(e.take.a_track_id)}
                            </span>
                            <span className="take-arrow"> → </span>
                            <span title={`incoming: ${label(e.take.b_track_id)}`}>
                              {label(e.take.b_track_id)}
                            </span>
                          </>
                        )}
                      </td>
                      <td>{fmtLen(e.take.window_end_s - e.take.window_start_s)}</td>
                      <td>
                        <span
                          className="take-confidence"
                          style={{ opacity: 0.4 + e.take.confidence * 0.6 }}
                          title={`detector v${e.take.detector_version}${e.take.origin === 'manual' ? ' · hand-cut' : ''}`}
                        >
                          {(e.take.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="take-promoted">
                        {e.take.promoted_transition_uuid ? (
                          <span title="Promoted to the Transition library">★</span>
                        ) : null}
                      </td>
                      <td>
                        {e.take.session_uuid ? (
                          <button
                            className="take-view-session"
                            title="View this moment on its Session's timeline"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              requestSessionMoment({
                                sessionUuid: e.take.session_uuid!,
                                atS: e.take.window_start_s,
                              });
                            }}
                          >
                            ▦
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <button
                          className="take-delete"
                          title="Delete this Take"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void remove(e.take.uuid);
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={e.take.uuid}
                      className="take-row routine"
                      title={
                        e.take.promoted_routine_uuid
                          ? 'Open its Routine in the Mix editor'
                          : 'Open in the Mix editor (promotes on open — mechanical deck→slot re-addressing)'
                      }
                      onClick={() => {
                        // #205 bug report: the row opens the EDITOR (like
                        // every other history row) — the Session deep-link
                        // keeps its own ▦ button.
                        if (e.take.promoted_routine_uuid) {
                          requestRoutineEdit({ routineUuid: e.take.promoted_routine_uuid });
                        } else {
                          void promote(e.take.uuid).then((uuid) => {
                            if (uuid) requestRoutineEdit({ routineUuid: uuid });
                          });
                        }
                      }}
                    >
                      <td className="take-when">{fmtWhen(e.take.confirmed_at)}</td>
                      <td className="take-pair">
                        <span className="take-routine-badge" title="Routine Take (ADR 0035)">
                          ◆ {e.take.cast.length}×
                        </span>{' '}
                        {e.take.cast.map(label).join(' → ')}
                      </td>
                      <td>{fmtLen(e.take.window_end_s - e.take.window_start_s)}</td>
                      <td>
                        <span className="take-confidence" title="Hand-confirmed — no detector score">
                          confirmed
                        </span>
                      </td>
                      <td className="take-promoted">
                        {e.take.promoted_routine_uuid ? (
                          <button
                            className="take-open-routine"
                            title="Promoted — open the Routine in the Routine editor (gh#170)"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              requestRoutineEdit({ routineUuid: e.take.promoted_routine_uuid! });
                            }}
                          >
                            ★
                          </button>
                        ) : (
                          <button
                            className="take-promote"
                            title="Promote to a Routine (mechanical deck→slot re-addressing + beat-domain rebase)"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void promote(e.take.uuid);
                            }}
                          >
                            ↑
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          className="take-view-session"
                          title="View this span on its Session's timeline"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            requestSessionMoment({
                              sessionUuid: e.take.session_uuid,
                              atS: e.take.window_start_s,
                            });
                          }}
                        >
                          ▦
                        </button>
                      </td>
                      <td>
                        <button
                          className="take-delete"
                          title="Delete this Routine Take"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void removeRoutine(e.take.uuid);
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
