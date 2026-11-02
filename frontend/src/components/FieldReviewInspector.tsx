import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fieldReview, FieldRequestError, supportedFields, type FieldContext, type FieldName, type FieldPlan, type FieldReceipt, type FieldScope } from '../api/fieldReview';
import Modal from './Modal';
import { useExportEnabled } from '../settings/useAppConfig';
import { ExportFieldChanges } from './PlaylistExportInspector';
import { openSyncWorkspace } from '../sync/openWorkspace';
import './PlaylistExportInspector.css';
import './FieldReviewInspector.css';

export type FieldScopes = Partial<Record<FieldScope, () => Promise<number[]>>>;
const FIELDS: FieldName[] = ['title', 'artist', 'key', 'bpm', 'energy', 'tags', 'hotcues', 'beatgrid', 'maincue'];
const key = (id: number, field: string) => `${id}:${field}`;

export function FieldReviewEntry({ scopes, initialScope = 'selected', initialFields, label = 'Review fields…' }: { scopes: FieldScopes; initialScope?: FieldScope; initialFields?: FieldName[]; label?: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function open() {
    if (pending.current) return;
    pending.current = true; setOpening(true); setError('');
    try {
      const trackIds = [...new Set(await scopes[initialScope]?.() || [])];
      if (!openSyncWorkspace({ kind: 'fields', trackIds, scope: initialScope, label, fields: initialFields })) throw new Error('A Sync operation is pending. Inspect its receipt before opening another scope.');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setOpening(false); }
  }
  return <><button className="btn" data-field-scope={initialScope} disabled={opening} onClick={() => void open()}>{opening ? 'Capturing scope…' : label}</button>{error && <span role="alert">{error}</span>}</>;
}

export type ReviewObservation = 'not checked' | 'reading' | 'plan available' | 'blocked plan' | 'unavailable';
export function FieldReviewInspector({ scopes, initialScope, initialFields, onClose, embedded = false, initialSurface = 'engine', initialDirection = 'import', onPendingChange, onFieldsChange, onObservationChange, scopeRevision }: {
  scopes: FieldScopes; initialScope: FieldScope; initialFields?: FieldName[]; onClose: () => void;
  embedded?: boolean; initialSurface?: 'engine' | 'rekordbox'; initialDirection?: 'import' | 'export';
  onPendingChange?: (pending: boolean) => void; onFieldsChange?: (fields: FieldName[]) => void; onObservationChange?: (state: ReviewObservation) => void;
  scopeRevision?: string;
}) {
  const queryClient = useQueryClient();
  const enabled = useExportEnabled();
  const [scope, setScope] = useState(initialScope);
  const [surface, setSurface] = useState<'engine' | 'rekordbox'>(initialSurface);
  const [direction, setDirection] = useState<'import' | 'export'>(initialDirection);
  const [fields, setFields] = useState<FieldName[]>((initialFields ?? ['key', 'hotcues', 'maincue']).filter(field => supportedFields(initialSurface, initialDirection).includes(field)));
  const [plan, setPlan] = useState<FieldPlan | null>(null);
  const [plannedScopeRevision, setPlannedScopeRevision] = useState(scopeRevision);
  const [receipt, setReceipt] = useState<FieldReceipt | null>(null);
  const [choices, setChoices] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const serial = useRef(0);
  const inFlight = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const liveScopes = useRef(scopes);
  liveScopes.current = scopes;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const generation = serial;
    if (embedded) return () => { generation.current++; };
    opener.current = document.activeElement as HTMLElement;
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]');
    if (dialog) dialog.tabIndex = -1;
    dialog?.querySelector<HTMLElement>('button,select')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button,input,select,summary,a[href],[tabindex]')]
        .filter(element => !element.matches(':disabled') && element.tabIndex >= 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (!focusable.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => { generation.current++; document.removeEventListener('keydown', trap, true); opener.current?.focus(); };
  }, [embedded]);
  useEffect(() => {
    // Apply disables the element that held focus. Keep focus in the live modal
    // even when every control becomes disabled during the synchronous request.
    if (writing) body.current?.closest<HTMLElement>('[role="dialog"], [data-review-panel]')?.focus();
  }, [writing]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  function clear() { serial.current++; setPlan(null); setReceipt(null); setError(null); setChoices(new Set()); setLoading(false); onObservationChange?.('not checked'); }
  async function recheck() {
    if (inFlight.current) return;
    clear();
    const ticket = ++serial.current;
    setPlannedScopeRevision(scopeRevision);
    setLoading(true);
    onObservationChange?.('reading');
    try {
      const ids = [...new Set(await liveScopes.current[scope]?.() || [])];
      if (!ids.length) throw new Error('No tracks in this scope. Select tracks or choose another scope.');
      const context: FieldContext = { track_ids: ids, scope, surface, direction, fields };
      const next = await fieldReview.plan(context);
      if (ticket !== serial.current) return;
      if (JSON.stringify(next.track_ids) !== JSON.stringify(ids) || next.scope !== scope || next.surface !== surface || next.direction !== direction || JSON.stringify(next.fields) !== JSON.stringify(fields)) throw new Error('Plan context mismatch; nothing can be applied.');
      setPlan(next); setLoadedAt(Date.now()); setNow(Date.now());
      onObservationChange?.(next.executable ? 'plan available' : 'blocked plan');
    } catch (error) {
      if (ticket === serial.current) { setError({ message: error instanceof Error ? error.message : String(error), code: 'rejected' }); onObservationChange?.('unavailable'); }
    } finally { if (ticket === serial.current) setLoading(false); }
  }
  async function apply() {
    if (!plan || inFlight.current || plannedScopeRevision !== scopeRevision || !plan.executable || now - loadedAt >= 60000 || (direction === 'export' && !enabled)) return;
    inFlight.current = true; setWriting(true); setError(null);
    onPendingChange?.(true);
    try {
      const replacements = plan.tracks.flatMap(track => track.fields.filter(field => field.action === 'consent' && choices.has(key(track.track_id, field.field))).map(field => ({ track_id: track.track_id, field: field.field })));
      setReceipt(await fieldReview.execute(plan, replacements));
    } catch (error) {
      setError({ message: error instanceof Error ? error.message : String(error), code: error instanceof FieldRequestError ? error.code : 'unknown' });
    } finally {
      // Unknown/partial may have changed data too; invalidate every affected cache.
      for (const prefix of ['tracks', 'track', 'playlist', 'sync-status', 'beatgrid', 'hotcues']) void queryClient.invalidateQueries({ queryKey: [prefix] });
      inFlight.current = false; setWriting(false);
      onPendingChange?.(false);
    }
  }
  const expired = plan && now - loadedAt >= 60000;
  const scopeChanged = plan && plannedScopeRevision !== scopeRevision;
  const resolved = receipt !== null || error !== null;
  const count = plan?.tracks.reduce((n, track) => n + track.fields.filter(field => field.action === 'fill' || (field.action === 'consent' && choices.has(key(track.track_id, field.field)))).length, 0) || 0;
  const content = <>
    <div className="pei-content" ref={body}>
      <p>Field data only · no playlist membership/order, audio copy or record creation.</p>
      <fieldset disabled={writing} className="field-review-controls">
        {!embedded && <><label>Scope <select aria-label="Field scope" value={scope} onChange={e => { clear(); setScope(e.target.value as FieldScope); }}>{(['selected', 'filtered', 'all'] as FieldScope[]).map(value => <option key={value} value={value} disabled={!scopes[value]}>{value === 'all' ? 'All Library tracks' : value}</option>)}</select></label>
        <label>Direction <select aria-label="Field direction" value={direction} onChange={e => { clear(); const value = e.target.value as typeof direction; setDirection(value); setFields(fields.filter(field => supportedFields(surface, value).includes(field))); }}><option value="import">Import external values into Library</option><option value="export">Export Library values</option></select></label>
        <label>Surface <select aria-label="Field surface" value={surface} onChange={e => { clear(); const value = e.target.value as typeof surface; setSurface(value); setFields(fields.filter(field => supportedFields(value, direction).includes(field))); }}><option value="engine">Engine DJ</option><option value="rekordbox">Rekordbox desktop</option></select></label></>}
        <div>{FIELDS.map(field => <label key={field} title={supportedFields(surface, direction).includes(field) ? field : 'Not supported by this field-isolated adapter; no wider operation is substituted'}><input type="checkbox" disabled={!supportedFields(surface, direction).includes(field)} checked={fields.includes(field)} onChange={() => { clear(); const next = fields.includes(field) ? fields.filter(f => f !== field) : [...fields, field]; setFields(next); onFieldsChange?.(next); }} />{field}</label>)}</div>
        <small>Disabled fields have no isolated writer here. Tags/catalogue and scalar BPM operations are not substituted.</small>
      </fieldset>
      {direction === 'export' && !enabled && <p role="alert">External export is off. Imports remain available.</p>}
      {loading && <p role="status">Reading exact scope and source/destination values…</p>}
      {error && <section role="alert"><h3>{error.code === 'unknown' ? 'Outcome unknown' : 'Operation not started'}</h3><p>{error.message}</p></section>}
      {plan && <><p>{plan.track_ids.length} tracks · IDs {plan.track_ids.join(', ')} · {plan.direction === 'import' ? `${plan.surface} → Library` : `Library → ${plan.surface}`}</p>
        {expired && <p role="alert">Plan expired. Recheck before applying.</p>}
        {scopeChanged && !writing && !resolved && <p role="alert">Scope changed since this plan. Recheck to capture its current IDs before applying.</p>}
        {plan.warnings.map(warning => <p className="pei-warning" key={warning}>{warning}</p>)}
        {!receipt && !error && plan.tracks.map(track => <section key={track.track_id}><h3>{track.title || track.filename}</h3>
          {track.fields.filter(field => field.action === 'consent').map(field => <label className="field-replacement" key={field.field}><input type="checkbox" disabled={writing} checked={choices.has(key(track.track_id, field.field))} onChange={() => setChoices(previous => { const next = new Set(previous); const id = key(track.track_id, field.field); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />Replace saved {field.field} for {track.title || track.track_id}</label>)}
          <ExportFieldChanges beforeLabel="DESTINATION NOW" afterLabel="SOURCE VALUE" changes={track.fields.map(field => ({ ...field, action: field.action === 'fill' || field.action === 'consent' ? 'replace' : field.action }))} />
          {track.fields.filter(field => field.action === 'blocked' || field.action === 'skip').map(field => <p className={field.action === 'blocked' ? 'pei-warning' : 'pei-secondary'} key={field.field}>{field.field}: {field.reason}</p>)}
        </section>)}
      </>}
      {receipt && <section aria-label="Field receipt"><h3>{receipt.status === 'unknown' ? 'Outcome unknown' : receipt.status === 'partial' ? 'Needs attention' : 'Field receipt'}</h3>{receipt.tracks.map(track => <section key={track.track_id}><h4>{track.title || track.track_id}</h4>{track.fields.map(field => <p key={field.field}>{field.field} · {field.status}{field.reason ? ` · ${field.reason}` : ''}</p>)}</section>)}<p>{receipt.verification}</p></section>}
    </div>
    <footer className="pei-footer"><button className="btn" disabled={writing} onClick={onClose}>{embedded ? 'Clear review' : 'Close'}</button><button className="btn" disabled={writing || !fields.length || loading} onClick={() => void recheck()}>{loading ? 'Reading…' : resolved ? 'Inspect destination, then recheck' : 'Recheck plan'}</button><button className="btn btn-primary" disabled={writing || loading || !plan?.executable || Boolean(expired) || Boolean(scopeChanged) || resolved || !count || (direction === 'export' && !enabled)} onClick={() => void apply()}>{writing ? 'Applying…' : `Apply ${count} fields`}</button></footer>
  </>;
  return embedded ? <section data-review-panel tabIndex={-1} aria-label="Field review" className="sync-embedded-review field-review-inspector"><h2>Review fields</h2>{content}</section>
    : <Modal title={<h2>Review Library fields</h2>} className="playlist-export-inspector field-review-inspector" closeDisabled={writing} onClose={() => { if (!inFlight.current) onClose(); }}>{content}</Modal>;
}
