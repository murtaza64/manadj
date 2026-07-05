/**
 * Transition history (transition-takes 02): the chronological log of
 * Takes — "what did I actually mix, when" (glossary). Minimal on
 * purpose: newest-first rows with pair, time, window length, confidence,
 * and delete. Opening a Take in the editor is issue 03; false positives
 * are kept deliberately (delete is manual — ADR 0020).
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { TAKE_RECORDED_EVENT } from '../../capture/takeSink';
import { requestTakeReview } from '../../capture/takeReview';
import { degradeDeletedPinsLocal } from '../../sets/setStore';
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

export function TakeHistoryView() {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['takes'] });

  const { data: rows, error } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });

  // Live update: the capture layer announces each persisted Take.
  useEffect(() => {
    const onRecorded = () => void queryClient.invalidateQueries({ queryKey: ['takes'] });
    window.addEventListener(TAKE_RECORDED_EVENT, onRecorded);
    return () => window.removeEventListener(TAKE_RECORDED_EVENT, onRecorded);
  }, [queryClient]);

  const trackIds = useMemo(
    () => [...new Set((rows ?? []).flatMap((t) => [t.a_track_id, t.b_track_id]))].sort((a, b) => a - b),
    [rows]
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

  const label = (id: number) => labels?.[id] ?? `track ${id}`;

  return (
    <div className="take-history">
      {error ? <div className="take-history-error">{String(error)}</div> : null}
      {rows === undefined ? (
        <div className="take-history-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="take-history-empty">
          No Takes yet — mix something in the Performance view and finished handovers land here.
        </div>
      ) : (
        <table className="take-history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Handover</th>
              <th>Window</th>
              <th>Confidence</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.uuid}
                className="take-row"
                title={
                  t.promoted_transition_uuid
                    ? 'Open its promoted Transition in the editor'
                    : 'Review this Take in the Transition editor'
                }
                onClick={() => requestTakeReview(t.uuid)}
              >
                <td className="take-when">{fmtWhen(t.detected_at)}</td>
                <td className="take-pair">
                  <span title={`outgoing: ${label(t.a_track_id)}`}>{label(t.a_track_id)}</span>
                  <span className="take-arrow"> → </span>
                  <span title={`incoming: ${label(t.b_track_id)}`}>{label(t.b_track_id)}</span>
                </td>
                <td>{fmtLen(t.window_end_s - t.window_start_s)}</td>
                <td>
                  <span
                    className="take-confidence"
                    style={{ opacity: 0.4 + t.confidence * 0.6 }}
                    title={`detector v${t.detector_version}`}
                  >
                    {(t.confidence * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="take-promoted">
                  {t.promoted_transition_uuid ? (
                    <span title="Promoted to the Transition library">★</span>
                  ) : null}
                </td>
                <td>
                  <button
                    className="take-delete"
                    title="Delete this Take"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(t.uuid);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
