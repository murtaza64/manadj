import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type GroupSessionView, type SessionRowWire } from '../api/client';
import './groupSessionEvidence.css';
import { GroupReplayControls } from './GroupReplayControls';

export const groupStatus: Record<GroupSessionView['status'], string> = {
  'projection-pending': 'History projection pending', unbound: 'Tracks need binding',
  'missing-assets': 'Audio files missing', 'changed-assets': 'Audio files changed',
  'unverified-assets': 'Audio not verified', 'metadata-ready': 'Tracks verified · Replay unavailable',
  conflicted: 'Session identity conflict', revoked: 'Device trust revoked', invalid: 'Evidence unavailable',
};
const precedence: GroupSessionView['status'][] = ['invalid', 'revoked', 'conflicted', 'projection-pending',
  'unbound', 'missing-assets', 'changed-assets', 'unverified-assets', 'metadata-ready'];

export function primaryGroupView(views: GroupSessionView[]) {
  return [...views].sort((a, b) => precedence.indexOf(a.status) - precedence.indexOf(b.status))[0];
}

export function GroupSessionAttribution({ views }: { views: GroupSessionView[] }) {
  const view = primaryGroupView(views);
  const relays = [...new Set(views.flatMap(v => v.relays.map(relay => relay.label)))];
  return <span className="group-session-attribution">{view.origin.label}
    {relays.length > 0 && <span> · Via {relays.join(', ')}</span>}</span>;
}

export function GroupSessionSummary({ views }: { views: GroupSessionView[] }) {
  const view = primaryGroupView(views);
  return <span className="group-session-summary">
    <span className={`group-session-status group-session-status-${view.status}`}>{groupStatus[view.status]}</span>
    <span>{view.tracks.length} {view.tracks.length === 1 ? 'track' : 'tracks'} referenced · Read-only evidence</span>
  </span>;
}

export function GroupSessionEvidence({ session, onBack }: { session: SessionRowWire; onBack?: () => void }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { data, error: readError } = useQuery({ queryKey: ['group-session', session.uuid],
    queryFn: () => api.sessions.get(session.uuid), refetchInterval: 5000 });
  const views = data?.group_history ?? session.group_history ?? [];
  const primary = views.length ? primaryGroupView(views) : null;
  const retry = async () => {
    if (!primary) return;
    setRetrying(true); setError(null);
    try {
      await api.sessions.retryGroupProjection(primary.group_id, primary.operation_id);
      await client.invalidateQueries({ queryKey: ['sessions'] });
      await client.invalidateQueries({ queryKey: ['group-session', session.uuid] });
    } catch (err) { setError(String(err)); }
    finally { setRetrying(false); }
  };
  return <section className="group-session-evidence" aria-label="Relayed Session evidence">
    <header>{onBack && <button className="btn btn-secondary" onClick={onBack}>Back to Sessions</button>}
      <h2>Relayed Session</h2></header>
    {(error || readError) && <p role="alert">{String(error ?? readError)}</p>}
    {primary ? <>
      <GroupSessionAttribution views={views} />
      <p><time dateTime={primary.started_at}>{new Date(primary.started_at).toLocaleString()}</time></p>
      <GroupSessionSummary views={views} />
      <p>Session evidence is retained. Replay requires explicit exact local audio selections and a successful engine decode. Audio transfer and editing are unavailable.</p>
      <GroupReplayControls key={`${primary.group_id}:${primary.operation_id}`} view={primary} />
      {primary.status === 'projection-pending' && <button className="btn btn-secondary" disabled={retrying}
        onClick={() => void retry()}>{retrying ? 'Retrying…' : 'Retry history projection'}</button>}
      <h3>Track availability</h3>
      <ul>{primary.tracks.map((track, index) => <li key={track.logical_track_id}>
        Track {index + 1} · {track.asset_state === 'unbound' ? 'Needs explicit local binding' : track.asset_state}
      </li>)}</ul>
      <details><summary>Technical evidence ({views.length} {views.length === 1 ? 'operation' : 'operations'})</summary>
        <p>Supplying peers attest receipt provenance, not an ordered relay route. A metadata acknowledgement does not mean this Session is playable.</p>
        {views.map(view => <article key={`${view.group_id}:${view.operation_id}`}>
          <h4>{groupStatus[view.status]}</h4>
          <dl>{Object.entries({ Session: view.session_uuid, Group: view.group_id, Operation: view.operation_id,
            'Original device': view.origin.device_id, 'Operation SHA256': view.operation_sha256,
            'Manifest SHA256': view.manifest_sha256, Projected: String(view.projected),
            Conflicts: String(view.conflict_count) }).map(([name, value]) => <div key={name}>
              <dt>{name}</dt><dd><code>{value}</code></dd></div>)}</dl>
          {view.relays.map(relay => <p key={relay.device_id}>Via {relay.label}{relay.revoked ? ' (revoked)' : ''}: <code>{relay.device_id}</code></p>)}
          <ul>{view.tracks.map(track => <li key={track.logical_track_id}><code>{track.logical_track_id}</code>
            {' · '}{track.asset_state}{track.expected_asset && <> · {track.expected_asset.byte_length} bytes · <code>{track.expected_asset.sha256}</code></>}</li>)}</ul>
        </article>)}
      </details>
    </> : <p role="status">Group evidence is unavailable. No recorded-source fallback is allowed.</p>}
  </section>;
}
