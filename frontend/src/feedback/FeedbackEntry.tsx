import { useEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { captureFeedback, fitScreenshot, withTimeout, type Capture } from './capture';
import { feedbackApi, FeedbackError, type Kind, type Payload, type Reports } from './client';
import { redact, type Readers } from './diagnostics';
import { installModalKeyGuard } from '../focus/modalKeys';
import './feedback.css';

const reportStatus = {
  pending: 'Pending GitHub filing', filing: 'Filing on GitHub', filed: 'Filed; not sent to an agent',
  filing_failed: 'GitHub filing failed', filing_uncertain: 'GitHub filing outcome uncertain',
};
const batchStatus = {
  queued: 'Queued; waiting for recipient availability',
  submitted: 'Submitted to transport; not acknowledged by the agent',
  delivered: 'Delivered', 'needs-routing': 'Needs routing; no delivery confirmed',
};

export function FeedbackEntry({ readers = {} }: { readers?: Readers }) {
  const [page, setPage] = useState<'form' | 'review' | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [kind, setKind] = useState<Kind>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [filingIssue, setFilingIssue] = useState<'conflict' | 'unknown' | null>(null);
  const [listing, setListing] = useState<Reports | null>(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const captureLock = useRef(false);
  const actionLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = page !== null;

  useEffect(() => installModalKeyGuard(() => Boolean(dialog.current?.open), () => setPage(null)), []);

  useEffect(() => {
    if (!open) return;
    const el = dialog.current!;
    const trigger = entry.current?.querySelector('button');
    const previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus();
      else trigger?.focus();
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await feedbackApi.reports();
        if (active) { setListing(data); setListError(''); }
      } catch (err) {
        if (active) setListError(redact(err instanceof Error ? err.message : 'Could not load reports'));
      } finally {
        if (active) timer = setTimeout(poll, page === 'review' ? 3000 : 15000);
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [page]);

  async function begin(recapture = false) {
    if (captureLock.current || actionLock.current) return;
    if (capture && !recapture) { setPage('form'); return; }
    if (payload && filingIssue !== 'conflict') return;
    captureLock.current = true;
    setCapturing(true);
    setError('');
    try {
      if (recapture) {
        flushSync(() => setPage(null));
        // Let the closed overlay leave the compositor before Electron capture.
        await withTimeout(new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), 250).catch(() => {});
        setPayload(null); setFilingIssue(null);
      }
      setCapture(await captureFeedback(readers));
      setPage('form');
    } catch {
      setCapture({ snapshot: {}, screenshot: null, context: null, warnings: ['Capture failed. Reporting is still available.'] });
      setPage('form');
    } finally { captureLock.current = false; setCapturing(false); }
  }

  async function action(run: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    try { await run(); }
    catch (err) { setError(redact(err instanceof Error ? err.message : 'Feedback request failed')); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function refresh() {
    setListing(await feedbackApi.reports());
    setListError('');
  }

  function file() {
    if (!capture?.context) { setError('Retry context before filing. Your draft is retained.'); return; }
    if (!title.trim() || !description.trim()) { setError('Title and detailed description are required.'); return; }
    void action(async () => {
      // Lock all fields after the first attempt. An ambiguous POST retry must
      // reproduce the exact bytes/UUID, even after closing and reopening.
      const frozen: Payload = payload ?? {
        id: crypto.randomUUID(), kind, title: redact(title.trim(), 200), description: redact(description.trim(), 10000),
        origin: capture.context!.origin, snapshot: capture.snapshot, screenshot: capture.screenshot,
        capture_warnings: capture.warnings,
      };
      setPayload(frozen);
      let report;
      try { report = await feedbackApi.file(frozen); }
      catch (err) {
        // A later conflict cannot disprove persistence of an earlier timeout.
        setFilingIssue((previous) => previous === 'unknown' || !(err instanceof FeedbackError && err.status === 409) ? 'unknown' : 'conflict');
        throw err;
      }
      setListing((current) => ({
        origin: current?.origin ?? capture.context!.origin,
        destination: current?.destination ?? report.destination,
        reports: [...(current?.reports.filter((r) => r.id !== report.id) ?? []), report],
        batches: current?.batches ?? [],
      }));
      setCapture(null); setPayload(null); setFilingIssue(null); setTitle(''); setDescription('');
      setPage('review');
    });
  }

  const groups = new Map<string, string[]>();
  for (const report of listing?.reports ?? []) {
    if (report.status !== 'filed' || report.batch_id !== null) continue;
    groups.set(report.destination, [...(groups.get(report.destination) ?? []), report.id]);
  }
  const pendingCount = listing && !listError ? listing.reports.filter((r) => r.batch_id === null).length : '?';
  const savedPayload = payload && listing?.reports.find((r) => r.id === payload.id);

  return <>
    <span className="feedback-entry" ref={entry} data-focusable>
      <button className="btn btn-secondary" title="Report bug / Request feature" disabled={capturing || busy} onClick={() => void begin()}>
        {capturing ? 'Capturing...' : 'Feedback'}
      </button>
      <button className="btn btn-secondary" title={listError || 'Reports awaiting dispatch, including pending or failed filing'} disabled={capturing} onClick={() => { setError(''); setPage('review'); }}>Queue ({pendingCount})</button>
    </span>
    {page && createPortal(<dialog ref={dialog} className="feedback-dialog" aria-labelledby={`${id}-heading`} data-focusable
      onCancel={(e) => { e.preventDefault(); setPage(null); }}>
      <header>
        <h2 id={`${id}-heading`}>{page === 'form' ? 'File a report' : 'Review feedback batches'}</h2>
        <button className="btn btn-secondary" onClick={() => setPage(null)}>Close</button>
      </header>
      <p>Filing creates a GitHub issue, not agent work. Only Send feedback authorizes a batch. Closing never sends.</p>
      {error && <p role="alert" className="feedback-error">{error}</p>}
      {page === 'form' && capture && <form onSubmit={(event) => { event.preventDefault(); file(); }}>
        <fieldset disabled={busy || payload !== null}>
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="bug">Report bug</option><option value="feature">Request feature</option>
          </select></label>
          <label>Title<input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Detailed description<textarea rows={6} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} /></label>
          <p>Attachments stay on the local server. Only the redacted summary goes to GitHub. Review images for private information before filing.</p>
          {capture.warnings.map((warning, i) => <p className="feedback-warning" key={i}>{warning}</p>)}
          {capture.screenshot ? <section>
            <img className="feedback-screenshot" src={capture.screenshot} alt="App screenshot captured before this form opened" />
            <button type="button" className="btn btn-secondary" onClick={() => setCapture({ ...capture, screenshot: null })}>Remove screenshot</button>
          </section> : <label>Optional PNG screenshot<input type="file" accept="image/png" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void action(async () => {
              if (file.type !== 'image/png' || file.size > 20 * 1024 * 1024) throw new Error('Choose a PNG smaller than 20 MiB.');
              const data = await withTimeout(new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error('Could not read PNG'));
                reader.readAsDataURL(file);
              }).then(fitScreenshot));
              setCapture({ ...capture, screenshot: data });
            });
          }} /></label>}
          {Object.keys(capture.snapshot).length > 0 && <section>
            <details><summary>Diagnostics JSON (redacted)</summary><pre>{JSON.stringify(capture.snapshot, null, 2)}</pre></details>
            <button type="button" className="btn btn-secondary" onClick={() => setCapture({ ...capture, snapshot: {} })}>Remove diagnostics</button>
          </section>}
        </fieldset>
        <section aria-label="GitHub summary preview"><h3>GitHub summary preview</h3>
          <strong>{redact(title.trim(), 200)}</strong><pre>{redact(description.trim(), 10000)}</pre>
        </section>
        <p>Captured origin: {capture.context ? `${capture.context.origin.lane ?? 'main'} / ${capture.context.origin.owner ?? 'no owner'} / ${capture.context.origin.revision ?? 'revision unavailable'}` : 'unavailable'}</p>
        {capture.context ? <p>Destination: {capture.context.destination}</p>
          : <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void action(async () => {
            const context = await feedbackApi.context();
            setCapture({ ...capture, context, warnings: [...capture.warnings, 'Origin resolved after initial capture because context was unavailable.'] });
          })}>Retry context</button>}
        {payload && <>
          <p className="feedback-warning">{filingIssue === 'conflict'
            ? `Report ${payload.id} was rejected by a conflict. Recapture refreshes the evidence and origin while keeping your text.`
            : `Submission locked to report ${payload.id}. Retry the same report to resolve an uncertain outcome; fields cannot change.`}</p>
          {filingIssue === 'unknown' && <p>Outcome unknown. Resolve this report in the queue or retry the same ID before recapturing.</p>}
        </>}
        <button type="button" className="btn btn-secondary" disabled={busy || (payload !== null && filingIssue !== 'conflict')}
          onClick={() => void begin(true)}>Recapture</button>
        <footer>
          <button className="btn btn-primary" type="submit" disabled={busy || !capture.context}>{busy ? 'Working...' : payload ? 'Retry same report' : 'File report on GitHub'}</button>
          <button className="btn btn-secondary" type="button" onClick={() => { setError(''); setPage('review'); }}>Review batches</button>
          {!payload && <button className="btn btn-danger" type="button" disabled={busy} onClick={() => {
            setCapture(null); setTitle(''); setDescription(''); setPage(null);
          }}>Discard draft</button>}
        </footer>
      </form>}
      {page === 'review' && <>
        {capture && <button className="btn btn-secondary" onClick={() => { setError(''); setPage('form'); }}>Resume report</button>}
        {payload && <section>
          <p>Locked report: {payload.id}. {savedPayload ? 'Saved on the server; use this record instead of creating another ID.' : 'No saved record confirmed. Absence from this list does not resolve an in-flight request; retry the same ID.'}</p>
          {savedPayload && <button className="btn btn-secondary" disabled={busy || Boolean(listError)} onClick={() => {
            setPayload(null); setFilingIssue(null); setCapture(null); setTitle(''); setDescription(''); setError('');
          }}>Use saved report</button>}
        </section>}
        <p>Destination: {listing?.destination ?? 'unavailable'}</p>
        {listError && <p role="alert" className="feedback-error">{listError}</p>}
        <button className="btn btn-secondary" disabled={busy} onClick={() => void action(refresh)}>Refresh status</button>
        {!listing && !listError && <p role="status">Loading saved feedback...</p>}
        {listing?.reports.length === 0 && <p>No saved reports.</p>}
        {listing?.reports.map((report) => <article key={report.id}>
          <h3>{redact(report.title, 200)}</h3>
          <p>{report.batch_id ? `Assigned to batch ${report.batch_id}` : reportStatus[report.status]}</p>
          <p>Destination: {report.destination}</p>
          {report.issue_url && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(report.issue_url) && <a href={report.issue_url} target="_blank" rel="noreferrer">Open GitHub issue</a>}
          {report.error && <p className="feedback-error">{redact(report.error)}</p>}
          {['filing_failed', 'filing_uncertain'].includes(report.status) && <button className="btn btn-secondary" disabled={busy}
            onClick={() => void action(async () => { await feedbackApi.retryReport(report.id); await refresh(); })}>Retry GitHub filing</button>}
        </article>)}
        {[...groups].map(([destination, ids]) => <section key={destination}>
          <p>{ids.length} filed reports ready for {destination}. This authorizes agent work on these reports only.</p>
          <button className="btn btn-primary" disabled={busy || Boolean(listError)} onClick={() => void action(async () => {
            const batch = await feedbackApi.dispatch([...ids]);
            setListing((current) => current && ({ ...current,
              reports: current.reports.map((r) => batch.report_ids.includes(r.id) ? { ...r, batch_id: batch.id } : r),
              batches: [...current.batches.filter((b) => b.id !== batch.id), batch],
            }));
            await refresh();
          })}>Send feedback ({ids.length})</button>
        </section>)}
        {listing?.batches.map((batch) => <article key={batch.id}>
          <h3>Batch {batch.id}</h3><p>{batch.report_ids.length} reports / {batch.destination}</p>
          <p>{batchStatus[batch.status]}</p>
          {batch.error && <p className="feedback-error">{redact(batch.error)}</p>}
          {batch.status !== 'delivered' && <button className="btn btn-secondary" disabled={busy} onClick={() => void action(async () => {
            await feedbackApi.retryBatch(batch.id); await refresh();
          })}>Retry authorized batch</button>}
        </article>)}
      </>}
    </dialog>, document.body)}
  </>;
}
