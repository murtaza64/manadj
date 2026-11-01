import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PlaylistExportRequestError } from '../api/client';
import type { PlaylistExportFieldPlan, PlaylistExportPlan, PlaylistExportTarget, PlaylistFullExportReport } from '../types';
import { cueCssColor } from '../hotcues/palette';
import { formatKeyDisplay } from '../utils/keyUtils';
import { useExportEnabled } from '../settings/useAppConfig';
import Modal from './Modal';
import './PlaylistExportInspector.css';

const TARGETS = { rekordbox: 'Rekordbox desktop', engine: 'Engine DJ' };
const LABELS: Record<string, string> = { hotcues: 'Hot cues', memorycues: 'Memory cue mirror', maincue: 'Main cue', beatgrid: 'Beatgrid', key: 'Key', tags: 'Tags', energy: 'Energy' };
const ACTIONS: Record<string, string> = { replace: 'OVERWRITE', 'replace-unknown': 'OVERWRITE · prior value unknown', clear: 'CLEAR', unchanged: 'SAME VALUE · rewritten', skip: 'SKIP', blocked: 'BLOCKED' };
const PLAN_MAX_AGE_MS = 60_000;
const basename = (path: string) => path.replaceAll('\\', '/').split('/').pop() || path;
type SavedReceipt = { plan: PlaylistExportPlan; report?: PlaylistFullExportReport; error?: { message: string; code: string } };

function CueSlots({ value, known }: { value: unknown; known: boolean }) {
  if (!known) return <span className="pei-unknown">? Not observed</span>;
  const cues = (Array.isArray(value) ? value : []) as { slot: number; time: number; color?: string; label?: string }[];
  return <div className="pei-cues">{Array.from({ length: 8 }, (_, i) => {
    const cue = cues.find(c => c.slot === i + 1);
    return <span className={`pei-cue${cue ? ' occupied' : ''}`} key={i} title={cue?.label || `Slot ${i + 1}`} style={cue ? { borderColor: cueCssColor(i + 1, cue.color), color: cueCssColor(i + 1, cue.color) } : undefined}>
      <b>{i + 1}</b><small>{cue ? `${cue.time.toFixed(3)}s` : '—'}</small>
    </span>;
  })}</div>;
}

function FieldValue({ field, value, known }: { field: string; value: unknown; known: boolean }) {
  if (field === 'hotcues') return <CueSlots value={value} known={known} />;
  if (!known) return <span className="pei-unknown">? Not observed</span>;
  if (value === null) return <span className="pei-empty">∅ Empty</span>;
  if (field === 'memorycues' && Array.isArray(value)) return value.length ? <div className="pei-tags">{value.map((v, i) => <span key={i}>{Number(v).toFixed(3)}s</span>)}</div> : <span className="pei-empty">∅ No memory cues</span>;
  if (field === 'beatgrid') {
    const changes = (value as { tempo_changes: { start_time: number; bpm: number; bar_position: number }[] }).tempo_changes;
    return <div className="pei-grid-values">{changes.map((c, i) => <span key={i}><b>▏▏▏▏</b> {c.bpm} BPM @ {c.start_time.toFixed(3)}s · bar {c.bar_position}</span>)}</div>;
  }
  if (Array.isArray(value)) return value.length ? <div className="pei-tags">{value.map((v, i) => <span key={i}>{String(v)}</span>)}</div> : <span className="pei-empty">∅ No tags</span>;
  if (field === 'key' && typeof value === 'number') return <b>{formatKeyDisplay(value)}</b>;
  return <b>{field === 'maincue' && typeof value === 'number' ? `${value.toFixed(3)}s` : String(value)}</b>;
}

function FieldChange({ change }: { change: PlaylistExportFieldPlan }) {
  return <div className={`pei-field pei-${change.action}`}>
    <div className="pei-field-title"><b>{LABELS[change.field] || change.field}</b><span className={`pei-badge pei-${change.action}`}>{ACTIONS[change.action]}</span></div>
    <div className="pei-before-after"><div><small>DESTINATION NOW</small><FieldValue field={change.field} value={change.before} known={change.before_known} /></div><span aria-hidden="true">→</span><div><small>{change.action === 'skip' || change.action === 'blocked' ? 'LIBRARY · NOT APPLIED' : 'LIBRARY → DESTINATION'}</small><FieldValue field={change.field} value={change.after} known /></div></div>
    {change.reason && <p className="pei-secondary">{change.reason}</p>}
  </div>;
}

function MembershipPlan({ plan }: { plan: PlaylistExportPlan }) {
  const m = plan.membership;
  function list(paths: string[], changes: string[], action: string) {
    const budget = new Map<string, number>();
    changes.forEach(path => budget.set(path, (budget.get(path) || 0) + 1));
    return <ol>{paths.map((path, i) => {
      const changed = (budget.get(path) || 0) > 0;
      if (changed) budget.set(path, budget.get(path)! - 1);
      return <li key={`${i}:${path}`} className={changed ? `pei-member-${action}` : ''} title={path}><span>{i + 1}.</span><span>{changed ? action === 'remove' ? '− ' : '+ ' : ''}{basename(path)}</span></li>;
    })}</ol>;
  }
  return <section className="pei-membership"><h3>{m.create ? 'Create destination playlist' : 'Replace destination playlist order'}</h3>
    <div className="pei-summary-chips"><span className="pei-badge pei-add">+ {m.added.length} entries</span><span className="pei-badge pei-clear">− {m.removed.length} entries</span><span className="pei-badge">↕ {m.moved} changed positions</span></div>
    <div className="pei-order-diff"><div><h4>BEFORE · destination</h4>{m.before.length ? list(m.before, m.removed, 'remove') : <p>∅ No entries</p>}</div><span aria-hidden="true">→</span><div><h4>AFTER · destination</h4>{m.after.length ? list(m.after, m.added, 'add') : <p>∅ No entries</p>}</div></div>
    <p className="pei-secondary">− removes destination playlist entries only. No source track or audio deletion.</p>
  </section>;
}

function ResultReceipt({ receipt }: { receipt: SavedReceipt }) {
  return <section className="pei-receipt" aria-label="Export receipt" aria-live="polite">
    <h3>{receipt.error ? receipt.error.code === 'unknown' ? 'Outcome unknown' : 'Export not started' : 'Export receipt'}</h3>
    <p>Library → {TARGETS[receipt.plan.target]} · {receipt.plan.scope === 'full' ? 'Playlist + track data' : 'Playlist order only'}</p>
    {receipt.error ? <p className="pei-warning" role="alert">{receipt.error.message}</p> : receipt.report?.results.map(result => {
      const withSkips = result.tracks.filter(t => Object.values(t.fields).some(s => s.startsWith('skipped'))).length;
      const failed = result.tracks.filter(t => t.status === 'failed' || Object.values(t.fields).some(s => s.startsWith('failed'))).length;
      const attention = result.status !== 'exported' || withSkips > 0 || failed > 0 || result.tracks_skipped > 0;
      return <section key={result.target}>
        <h4 className={attention ? 'pei-warning' : 'pei-success'}>{TARGETS[result.target]} · {attention ? 'Needs attention' : 'Writer reported completion'}</h4>
        <p>{result.tracks_total} tracks · {failed} failed/incomplete · {withSkips} with skipped fields</p>
        {result.error && <p role="alert">{result.error}</p>}
        {result.tracks.map((track, i) => <details key={`${track.track_id}:${i}`} open={track.status === 'failed' || Object.values(track.fields).some(s => s.startsWith('skipped') || s.startsWith('failed'))}>
          <summary>{track.title || `Track ${track.track_id}`} · {Object.values(track.fields).some(s => s.startsWith('failed')) ? 'incomplete' : Object.values(track.fields).some(s => s.startsWith('skipped')) ? 'with skips' : track.status}</summary>
          {track.reason && <p>{track.reason}</p>}
          <dl>{Object.entries(track.fields).map(([field, status]) => <div className={`pei-result-field ${status.startsWith('failed') ? 'pei-danger' : status.startsWith('skipped') || status.includes('cleared') ? 'pei-warning' : ''}`} key={field}><dt>{field === 'hotcues' && result.target === 'rekordbox' ? 'Hot / memory cue mirror' : LABELS[field] || field}</dt><dd>{status}</dd></div>)}</dl>
        </details>)}
      </section>;
    })}
    <p className="pei-warning">Verification: writer report only. No independent readback, desktop-app inspection, USB export or hardware playback was checked.</p>
  </section>;
}

export function PlaylistExportInspector({ playlistName, onClose }: { playlistName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<SavedReceipt>(['playlist-export-receipt', playlistName]);
  const [receipt, setReceipt] = useState<SavedReceipt | null>(cached || null);
  const [target, setTarget] = useState<PlaylistExportTarget | ''>(cached?.plan.target || '');
  const [scope, setScope] = useState<'full' | 'order'>(cached?.plan.scope || 'full');
  const [now, setNow] = useState(Date.now);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const inFlight = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const exportEnabled = useExportEnabled();
  const plan = useQuery({ queryKey: ['playlist-export-plan', playlistName, target, scope],
    queryFn: () => api.playlistSync.previewExportPlan(playlistName, target as PlaylistExportTarget, scope),
    enabled: Boolean(target) && !receipt && exportEnabled, retry: false, staleTime: 0,
  });
  const save = (value: SavedReceipt) => {
    setReceipt(value);
    queryClient.setQueryDefaults(['playlist-export-receipt', playlistName], { gcTime: Infinity });
    queryClient.setQueryData(['playlist-export-receipt', playlistName], value);
  };
  const mutation = useMutation({
    mutationFn: (submitted: PlaylistExportPlan) => api.playlistSync.executeExportPlan(submitted),
    onSuccess: (report, submitted) => {
      save({ plan: submitted, report });
      for (const key of ['playlistSync', 'sync-status', 'tracks', 'playlist']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (error, submitted) => save({ plan: submitted, error: { message: error.message,
      code: error instanceof PlaylistExportRequestError ? error.code : 'unknown' } }),
    onSettled: () => { inFlight.current = false; },
  });
  const writing = mutation.isPending;
  const stale = now - plan.dataUpdatedAt >= PLAN_MAX_AGE_MS;
  const matches = plan.data?.playlist_name === playlistName && plan.data.target === target && plan.data.scope === scope;
  const ready = exportEnabled && matches && plan.data?.executable && !plan.isFetching && !plan.isError && !stale && !writing && !receipt;
  const destructive = plan.data && (plan.data.scope === 'full' || plan.data.membership.removed.length > 0);
  const acknowledgementKey = JSON.stringify([playlistName, target, scope, plan.dataUpdatedAt, plan.data?.token]);
  const acknowledged = acknowledgement === acknowledgementKey;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = body.current?.closest('[role="dialog"]') as HTMLElement | null;
    dialog?.querySelector<HTMLElement>('select,button')?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialog) return;
      const elements = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,a[href]')];
      const first = elements[0], last = elements.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); opener?.focus(); };
  }, []);

  function recheck() {
    if (inFlight.current) return;
    setReceipt(null); mutation.reset(); setAcknowledgement(null);
    queryClient.removeQueries({ queryKey: ['playlist-export-receipt', playlistName], exact: true });
    void plan.refetch();
  }
  function submit() {
    if (!ready || !plan.data || inFlight.current || (destructive && !acknowledged)) return;
    inFlight.current = true;
    mutation.mutate(plan.data);
  }
  return <Modal title={<h2 id={titleId}>Export · {playlistName}</h2>} labelledBy={titleId} className="playlist-export-inspector" closeDisabled={writing} onClose={() => { if (!inFlight.current) onClose(); }}>
    <div className="pei-content" ref={body}>
      <p className="pei-direction">manaDJ Library → {target ? TARGETS[target] : 'choose destination'}</p>
      <p className="pei-secondary">External export, not phone Device sync. Desktop export does not update a USB.</p>
      {!exportEnabled && <p role="alert" className="pei-warning">External export is off. Enable it in Settings → Library. Imports remain available.</p>}
      <fieldset disabled={writing || Boolean(receipt)}><legend>Destination and scope</legend>
        <label>Destination <select aria-label="Export destination" value={target} onChange={e => setTarget(e.target.value as PlaylistExportTarget | '')}><option value="">Choose…</option><option value="rekordbox">Rekordbox desktop</option><option value="engine">Engine DJ</option></select></label>
        <label>Scope <select aria-label="Export scope" value={scope} onChange={e => setScope(e.target.value as 'full' | 'order')}><option value="full">Playlist + track data</option><option value="order">Playlist membership / order only</option></select></label>
      </fieldset>
      {writing ? <section role="status" className="pei-writing"><h3>Writing to {target ? TARGETS[target] : 'destination'}…</h3><p>Waiting for the writer receipt. No progress, cancellation or rollback API exists for this operation. Keep this inspector open.</p></section> : receipt ? <ResultReceipt receipt={receipt} /> : <>
        {!target && <p>Choose one destination to load its plan. No other library will receive this export.</p>}
        {target && plan.isFetching && <p role="status">Reading source and destination plan…</p>}
        {target && plan.isError && <div role="alert"><p className="pei-danger">Plan unavailable: {plan.error.message}</p></div>}
        {matches && plan.data && !plan.isError && !plan.isFetching && <>
          <p className="pei-secondary">Destination: {plan.data.destination}</p>
          {stale && <p role="alert" className="pei-warning">Plan expired. Recheck before exporting.</p>}
          <MembershipPlan plan={plan.data} />
          {scope === 'full' && <section className="pei-track-plans"><h3>Track data · {plan.data.tracks.length} tracks</h3><p className="pei-secondary">Compared values are the readers' observations, not independent native-file verification. Unknown is not empty. Same values can still be rewritten.</p>
            {plan.data.tracks.map((track, i) => <details key={`${track.track_id}:${i}`} open={track.record_action === 'blocked' || (i === 0 && track.fields.some(f => f.action === 'clear'))}>
              <summary>{track.title} <span className={`pei-badge ${track.record_action === 'blocked' ? 'pei-clear' : ''}`}>{track.record_action === 'blocked' ? 'RECORD ABSENT · cannot add' : 'EXISTING RECORD'}</span>{track.fields.some(f => f.action === 'clear') && <span className="pei-badge pei-clear">CLEAR: {track.fields.filter(f => f.action === 'clear').map(f => LABELS[f.field] || f.field).join(', ')}</span>}{track.fields.some(f => f.action === 'skip') && <span className="pei-badge pei-skip">SKIP</span>}</summary>
              {track.fields.map(change => <FieldChange key={change.field} change={change} />)}
            </details>)}
            <details><summary><span className="pei-badge pei-replace-unknown">SHARED TAG STRUCTURE · prior values unknown</span></summary><p>Current full export can create/update destination tag structure. Prior structure details are unknown; track assignment scope remains this playlist.</p>{plan.data.tag_structure.map(c => <p key={c.id}>{c.name} → {c.tags.map(t => t.name).join(' · ') || '∅'}</p>)}</details>
          </section>}
          {scope === 'order' && plan.data.tracks.some(t => t.record_action === 'blocked') && <p className="pei-danger">Blocked records: {plan.data.tracks.filter(t => t.record_action === 'blocked').map(t => t.title).join(', ')}. This exporter cannot add downstream records (#417).</p>}
          {!plan.data.executable && <p role="alert" className="pei-danger">Export blocked: resolve missing downstream records, then recheck. No partial playlist is submitted.</p>}
          {plan.data.warnings.map(w => <p key={w} className="pei-secondary">{w}</p>)}
          <p className="pei-warning">Quit {target ? TARGETS[target] : 'the destination'} before exporting. The server rechecks this exact scope and destination before writes.</p>
          {destructive && <label className="pei-confirm"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledgement(e.target.checked ? acknowledgementKey : null)} />I reviewed the highlighted overwrites, clears, shared tag updates and membership removals.</label>}
        </>}
      </>}
    </div>
    <footer className="pei-footer">
      <button className="btn btn-secondary" disabled={writing} onClick={() => { if (!inFlight.current) onClose(); }}>Close</button>
      {!receipt && !writing && <button className="btn btn-secondary" disabled={!target || plan.isFetching} onClick={recheck}>Recheck plan</button>}
      {receipt && <button className="btn" onClick={recheck}>{receipt.error?.code === 'unknown' ? 'I inspected the destination · load a new plan' : 'Review a new plan'}</button>}
      {!receipt && <button className="btn btn-primary" disabled={!ready || (destructive && !acknowledged)} onClick={submit}>{writing ? 'Writing…' : 'Export reviewed changes'}</button>}
    </footer>
  </Modal>;
}

/** Shared by Library and Sync. Capture the clicked playlist, not a later
 * sidebar selection; changing the underlying context cannot retarget writes. */
export function PlaylistExportEntry({ playlistName }: { playlistName?: string }) {
  const enabled = useExportEnabled();
  const [openedName, setOpenedName] = useState<string | null>(null);
  return <>
    {enabled ? <button className="btn btn-primary" aria-label="Export this playlist" disabled={!playlistName} onClick={() => { if (playlistName) setOpenedName(playlistName); }}>Export…</button>
      : <span title="Settings → Library → Allow external export">External export off</span>}
    {openedName && <PlaylistExportInspector playlistName={openedName} onClose={() => setOpenedName(null)} />}
  </>;
}
