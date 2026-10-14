import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DeviceSyncChangeRow } from '../api/client';

/** Device change log (ADR 0045, #375): every change Device sync moved, both
 * directions, newest first and grouped by sync. Reverting writes the old
 * value back on the desktop as a new logged change; the phone picks it up on
 * its next sync. */

const SETTING_LABELS: Record<string, string> = {
  'manadj.waveformStyles': 'Waveform style',
  'manadj-filter-settings': 'Filter',
};

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = JSON.stringify(value);
  return out;
}

/** Synced setting rows: the changed leaves, `path a → b`. */
export function settingDiff(old: unknown, next: unknown): string {
  const a = flatten(old);
  const b = flatten(next);
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  if (changed.length === 0) return 'no change';
  const shown = changed.slice(0, 4).map((k) => `${k} ${a[k] ?? '—'} → ${b[k] ?? '—'}`);
  return shown.join(', ') + (changed.length > 4 ? ` +${changed.length - 4} more` : '');
}

function show(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field.startsWith('hot_cue:') && typeof value === 'object') {
    const cue = value as { time: number; label?: string | null };
    return `${cue.time.toFixed(2)}s${cue.label ? ` “${cue.label}”` : ''}`;
  }
  if (field.startsWith('tag:')) return value ? 'on' : 'off';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function fieldLabel(field: string, tagName?: string | null): string {
  if (field.startsWith('setting:')) return SETTING_LABELS[field.slice(8)] ?? field.slice(8);
  if (field.startsWith('hot_cue:')) return `Hot cue ${field.slice(8)}`;
  if (field.startsWith('tag:')) return `Tag ${tagName ?? `#${field.slice(4)}`}`;
  return { main_cue: 'Main cue', title: 'Title', artist: 'Artist', energy: 'Energy', key: 'Key' }[field] ?? field;
}

export function DeviceChangeLog() {
  const client = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['device-listener', 'changes'],
    queryFn: api.deviceListener.changes,
    refetchInterval: 10_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['device-listener', 'changes'] });
  const revertOne = useMutation({ mutationFn: api.deviceListener.revertChange, onSettled: refresh });
  const revertAll = useMutation({ mutationFn: api.deviceListener.revertBatch, onSettled: refresh });

  if (isLoading) return <p role="status">Loading change log...</p>;
  if (isError || !data) return <p role="alert">Could not load the change log.</p>;
  if (data.length === 0) return <p className="settings-hint">No phone changes yet.</p>;

  const batches: { id: string; rows: DeviceSyncChangeRow[] }[] = [];
  for (const row of data) {
    const last = batches[batches.length - 1];
    if (last?.id === row.batch_id) last.rows.push(row);
    else batches.push({ id: row.batch_id, rows: [row] });
  }
  const failure = revertOne.error ?? revertAll.error;

  return (
    <div className="device-change-log">
      {batches.map(({ id, rows }) => {
        const head = rows[0];
        const toDesktop = head.direction === 'to_desktop';
        return (
          <section key={id} className="device-change-batch">
            <header>
              <span>
                {new Date(head.synced_at).toLocaleString()} ·{' '}
                {head.reverts_id ? 'Revert' : `${head.device_name ?? head.device_id} ${toDesktop ? '→ desktop' : '← desktop'}`}{' '}
                · {rows.length} change{rows.length === 1 ? '' : 's'}
              </span>
              {rows.some((r) => r.revertable) ? (
                <button className="btn btn-secondary" disabled={revertAll.isPending} onClick={() => revertAll.mutate(id)}>
                  Revert sync
                </button>
              ) : null}
            </header>
            <table>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.outcome !== 'applied' || r.reverted_by_id ? 'is-inactive' : undefined}>
                    <td>{r.track_id === null ? 'Settings' : (r.track_title ?? `Track ${r.track_id}`)}</td>
                    <td>{fieldLabel(r.field, r.tag_name)}</td>
                    <td>
                      {r.field.startsWith('setting:')
                        ? settingDiff(r.old, r.new)
                        : `${show(r.field, r.old)} → ${show(r.field, r.new)}`}
                    </td>
                    <td>{r.reverted_by_id ? 'reverted' : r.outcome}</td>
                    <td>
                      {r.revertable ? (
                        <button className="btn btn-secondary" disabled={revertOne.isPending} onClick={() => revertOne.mutate(r.id)}>
                          Revert
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {failure ? (
        <p role="alert" className="settings-hint">
          {failure instanceof Error ? failure.message : 'Revert failed'}
        </p>
      ) : null}
    </div>
  );
}
