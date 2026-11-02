import { useCallback, useEffect, useState } from 'react';
import { api, type ExchangeDetail, type ExchangeStatus, type SessionRowWire } from '../api/client';
import './exchangeSettings.css';

/** Folder mutations stay behind the backend's local-control guard. Remote previews
 * render health only; this UI check is not an authorization boundary. */
export default function ExchangeSettings() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [identity, setIdentity] = useState('');
  const [root, setRoot] = useState('');
  const [replica, setReplica] = useState('');
  const [label, setLabel] = useState('');
  const [sessions, setSessions] = useState<SessionRowWire[]>([]);
  const [sid, setSid] = useState('');
  const [detail, setDetail] = useState<ExchangeDetail | null>(null);
  const [retained, setRetained] = useState<Pick<ExchangeStatus, 'root' | 'publications' | 'receipts'> | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const current = await api.exchange.status();
    setStatus(current);
    setSessions(await api.sessions.list());
  }, []);
  useEffect(() => {
    let stopped = false;
    const load = () => { if (!stopped) void refresh().catch(e => { if (!stopped) setError(String(e.message ?? e)); }); };
    load();
    void api.exchange.identity().then(i => { if (!stopped) setIdentity(i.replica_id); }).catch(() => {});
    const timer = setInterval(load, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [refresh]);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); await refresh(); setConsent(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const active = status?.roots.find(r => r.id === status.root_id);
  const writable = local && !busy;
  const archiveGuard = status ? `${status.root_id}:${status.generation}:${status.pending}` : '';
  return <div className="exchange-settings">
    <div className="settings-section-heading"><div>
      <h2>Session exchange</h2>
      <p>Exchange closed Session evidence through an existing folder. No audio, playlists, Sets or curated Library metadata are transferred.</p>
    </div><button className="btn" disabled={busy} onClick={() => void act(refresh)}>Refresh health</button></div>
    {!local && <p role="note">Read-only preview. Configure folders and bindings in the local desktop app.</p>}
    {error && <p role="alert">{error}</p>}
    {!status ? <p role="status">Loading exchange health…</p> : <>
      <p role="status">Transport: <strong>{status.state}</strong> · {status.enabled ? 'Enabled' : 'Disabled'} · {status.pending} pending / unacknowledged outboxes</p>
      {!status.supported && <p role="alert">Folder transport is unsupported on this platform. Secure no-follow filesystem operations are required. Use the paired desktop adapter on Android.</p>}
      <p>Local replica: <code>{identity || 'Not initialized'}</code></p>
      {!identity && <button className="btn" disabled={!writable} onClick={() => void act(async () => {
        setIdentity((await api.exchange.initialize()).replica_id);
      })}>Initialize local replica</button>}
      <fieldset disabled={!writable || !identity || !status.supported}>
        <legend>Authorize an existing folder</legend>
        <p>Use an empty folder or an existing manadj-owned exchange folder. This does not create or configure a share. Rotation requires disable, then archive.</p>
        <label>Existing absolute folder path <input aria-label="Existing absolute folder path" value={root} onChange={e => setRoot(e.target.value)} /></label>
        <button className="btn" disabled={!root.trim()} onClick={() => void act(() => api.exchange.configure(root.trim(), true))}>Authorize and enable folder</button>
        {status.root && <>
          <p>Active folder: <code>{status.root}</code></p>
          <button className="btn" onClick={() => void act(() => api.exchange.configure(status.root!, !status.enabled))}>{status.enabled ? 'Disable exchange' : 'Enable current folder'}</button>
        </>}
      </fieldset>
      <fieldset disabled={!writable || !identity}>
        <legend>Accept a replica namespace</legend>
        <p>Only accept your chosen source. A namespace claim is not cryptographic authentication.</p>
        <label>Replica UUID <input aria-label="Replica UUID" value={replica} onChange={e => setReplica(e.target.value)} /></label>
        <label>Replica label <input aria-label="Replica label" maxLength={80} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <button className="btn" disabled={!replica.trim() || !label.trim()} onClick={() => void act(() => api.exchange.accept(replica.trim(), label.trim()))}>Accept namespace</button>
        <ul>{status.sources.map(s => <li key={s.replica_id}>{s.label} · <code>{s.replica_id}</code></li>)}</ul>
      </fieldset>
      <fieldset disabled={!writable || !identity || !active || active.archived}>
        <legend>Select a closed Session for this root</legend>
        <label>Local Session <select aria-label="Local Session" value={sid} onChange={e => setSid(e.target.value)}>
          <option value="">Choose a Session</option>
          {sessions.map(s => <option key={s.uuid} value={s.uuid}>{s.started_at} · {s.uuid}</option>)}
        </select></label>
        <button className="btn" disabled={!sid} onClick={() => void act(() => api.exchange.select(sid))}>Publish selected Session</button>
        <p>{status.publications.length} / {status.selection_limit} selections on this root. New roots never automatically export historical evidence.</p>
      </fieldset>
      <h3>Delivery and readiness</h3>
      <p>Acknowledgment confirms durable evidence receipt, not playable media. Partial files retry automatically while enabled. Conflicts preserve the original; missing published files are not silently recreated.</p>
      <ul>{status.publications.map(p => <li key={p.session_uuid}><code>{p.session_uuid}</code> · {p.state}</li>)}</ul>
      <ul>{status.receipts.map(r => <li key={r.artifact}><code>{r.artifact}</code> · {r.state} · media/history: {r.readiness ?? 'Not ready'}{' '}
        {r.received && <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setDetail(await api.exchange.detail(r.artifact.split('_')[1]));
        })}>Inspect dependencies</button>}</li>)}</ul>
      {detail && <section aria-label="Session dependencies"><h4>{detail.session_uuid} · {detail.state}</h4>
        {detail.dependencies.map(d => <div key={d.logical_track_id}>
          <p>Logical Track <code>{d.logical_track_id}</code> · local {d.local_track_id ?? 'unbound'} · asset: {d.asset_state}</p>
          <label>Local Track ID <input aria-label={`Local Track ID for ${d.logical_track_id}`} type="number" min="1" step="1" value={bindings[d.logical_track_id] ?? ''} onChange={e => setBindings({ ...bindings, [d.logical_track_id]: e.target.value })} /></label>
          <button className="btn" disabled={!writable || !Number.isSafeInteger(Number(bindings[d.logical_track_id])) || Number(bindings[d.logical_track_id]) < 1} onClick={() => void act(async () => {
            const id = Number(bindings[d.logical_track_id]);
            const selected = await api.exchange.selectTrack(id);
            await api.exchange.bind(id, selected.guard, d.logical_track_id);
            setDetail(await api.exchange.detail(detail.session_uuid));
          })}>Bind selected local Track</button>
        </div>)}
        <p>Only exact pre-existing media enables normal Sessions history and replay. Recheck health after the next worker cycle.</p>
      </section>}
      <h3>Capacity and retained roots</h3>
      <p>{status.retention} Active roots are bounded to {status.entry_limit} entries. When full, disable, archive and authorize another existing folder.</p>
      <ul>{status.roots.map(r => <li key={r.id}><code>{r.root}</code> · {r.archived ? 'Archived; not scanned' : 'Active'} · {r.pending} pending / unacknowledged · entries: {r.entries ?? 'Not scanned'} / {status.entry_limit} · last successful scan: {r.last_success ?? 'Never'}
        <button className="btn" disabled={busy} onClick={() => void act(async () => { setRetained(await api.exchange.rootEvidence(r.id)); })}>Inspect retained evidence</button>
        {r.archived && <button className="btn" disabled={!writable || status.enabled || (active && !active.archived)} onClick={() => void act(() => api.exchange.configure(r.root, true))}>Reactivate retained root</button>}</li>)}</ul>
      {retained && <section aria-label="Retained root evidence"><h4>{retained.root}</h4>
        <p>Last durable state; archived roots are not scanned.</p>
        <ul>{retained.publications.map(p => <li key={p.session_uuid}>{p.session_uuid} · {p.state}</li>)}
          {retained.receipts.map(r => <li key={r.artifact}>{r.artifact} · {r.state} · {r.readiness ?? 'Not ready'}</li>)}</ul>
      </section>}
      {active && !active.archived && <fieldset disabled={!writable || status.enabled}>
        <legend>Archive current root</legend>
        <p>{status.pending} pending / unacknowledged outboxes will stop retrying until this root is explicitly reactivated. Every file, receipt and immutable evidence record remains. Disk space is not reclaimed.</p>
        <label><input type="checkbox" checked={consent === archiveGuard} onChange={e => setConsent(e.target.checked ? archiveGuard : '')} /> Retain all files and evidence; stop scanning this root</label>
        <button className="btn" disabled={consent !== archiveGuard} onClick={() => void act(() => api.exchange.archive(status.generation, status.pending))}>Archive and retain all files</button>
      </fieldset>}
    </>}
  </div>;
}
