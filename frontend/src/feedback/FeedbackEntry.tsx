import { useEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { captureFeedback, fitScreenshot, withTimeout, type Capture } from './capture';
import { feedbackApi, FeedbackError, type Kind, type Payload, type Reports } from './client';
import { redact, type Json, type Readers, type Snapshot } from './diagnostics';
import { pickElement, type PointerInfo } from './pointer';
import {
  appendPoint, compositeScreenshot, normalizePoint, PEN_COLORS, PEN_WIDTH,
  renderAnnotations, type Stroke,
} from './annotate';
import { dictationAvailable, startDictation, type Dictation } from './dictate';
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

/** Plain-literal copy so the descriptor is assignable to the snapshot's Json. */
function pointerSnapshot(pointer: PointerInfo) {
  return {
    tag: pointer.tag, id: pointer.id, role: pointer.role, label: pointer.label, text: pointer.text,
    rect: { x: pointer.rect.x, y: pointer.rect.y, width: pointer.rect.width, height: pointer.rect.height },
  };
}

function pointerLabel(pointer: PointerInfo): string {
  const named = pointer.label ?? pointer.text;
  return `${pointer.tag}${pointer.id ? `#${pointer.id}` : ''}${named ? ` "${named}"` : ''}`;
}

/** Visible hint of what the capture actually contains (feedback #518). */
function CaptureHint({ snapshot }: { snapshot: Snapshot }) {
  const chips: string[] = [];
  if (typeof snapshot.view === 'string' && snapshot.view) chips.push(snapshot.view);
  const decks = snapshot.decks;
  if (Array.isArray(decks)) {
    const playing = decks
      .filter((deck) => Boolean(deck) && typeof deck === 'object' && !Array.isArray(deck))
      .map((deck) => deck as Record<string, Json>)
      .filter((deck) => deck.playing === true)
      .map((deck) => String(deck.id ?? '?'));
    if (playing.length) chips.push(`${playing.join('+')} playing`);
  }
  const errors = Array.isArray(snapshot.errors) ? snapshot.errors.length : 0;
  if (errors) chips.push(`${errors} recent error${errors === 1 ? '' : 's'}`);
  const trail = Array.isArray(snapshot.trail) ? snapshot.trail : [];
  if (trail.length) chips.push(`${trail.length} recent events`);
  if (!chips.length) return null;
  return <div className="feedback-hint">
    <p className="feedback-capture-hint">Captured: {chips.join(' · ')}</p>
    {trail.length > 0 && <details className="feedback-trail"><summary>Recent activity</summary>
      <ul>{trail.slice(-8).map((entry, i) => {
        const item = entry as { at?: unknown; event?: unknown; detail?: unknown };
        const at = typeof item.at === 'string' ? new Date(item.at) : null;
        const time = at && !Number.isNaN(at.getTime())
          ? at.toLocaleTimeString([], { hour12: false }) : '';
        const detail = typeof item.detail === 'string' && item.detail ? `, ${item.detail}` : '';
        return <li key={i}><span className="text-tertiary">{time}</span> {String(item.event ?? '')}{detail}</li>;
      })}</ul>
    </details>}
  </div>;
}

function ScreenshotCanvas({ image, strokes, pointer, viewport, annotating, penColor, onStroke }: {
  image: string; strokes: Stroke[]; pointer: PointerInfo | null;
  viewport: Json | undefined;
  annotating: boolean; penColor: string; onStroke: (stroke: Stroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Stroke['points'] | null>(null);
  // jsdom and exotic runtimes without 2d canvas fall back to the plain img.
  const [unsupported, setUnsupported] = useState(() => {
    const probe = document.createElement('canvas');
    try { return !probe.getContext('2d'); }
    catch { return true; }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || unsupported) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let dead = false;
    const decoded = new Image();
    decoded.onload = () => {
      if (dead) return;
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      context.drawImage(decoded, 0, 0);
      const live = draft?.length
        ? [...strokes, { color: penColor, width: PEN_WIDTH, points: draft }]
        : strokes;
      const captured = viewport as { width?: unknown; height?: unknown } | undefined;
      renderAnnotations(context, canvas.width, canvas.height, live, pointer, {
        width: typeof captured?.width === "number" ? captured.width : window.innerWidth,
        height: typeof captured?.height === "number" ? captured.height : window.innerHeight,
      });
    };
    decoded.onerror = () => setUnsupported(true);
    decoded.src = image;
    return () => { dead = true; };
  }, [image, strokes, draft, pointer, viewport, penColor, unsupported]);

  if (unsupported) {
    return <img className="feedback-screenshot" src={image} alt="App screenshot captured before this form opened" />;
  }
  const pointAt = (event: React.PointerEvent) =>
    normalizePoint(event.clientX, event.clientY, canvasRef.current!.getBoundingClientRect());
  return <canvas
    ref={canvasRef}
    className={`feedback-screenshot${annotating ? ' feedback-screenshot-draw' : ''}`}
    role="img" aria-label="App screenshot captured before this form opened"
    onPointerDown={(event) => {
      if (!annotating) return;
      event.preventDefault();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDraft([pointAt(event)]);
    }}
    onPointerMove={(event) => {
      if (!annotating || !draft) return;
      event.preventDefault();
      setDraft(appendPoint(draft, pointAt(event)));
    }}
    onPointerUp={(event) => {
      if (!annotating || !draft) return;
      event.preventDefault();
      const points = appendPoint(draft, pointAt(event));
      setDraft(null);
      onStroke({ color: penColor, width: PEN_WIDTH, points });
    }}
    onPointerCancel={() => setDraft(null)}
  />;
}

export function FeedbackEntry({ readers = {}, toolbar = false }: { readers?: Readers; toolbar?: boolean }) {
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
  const [pointer, setPointer] = useState<PointerInfo | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [annotating, setAnnotating] = useState(false);
  const [dictating, setDictating] = useState<'title' | 'description' | null>(null);
  const captureLock = useRef(false);
  const actionLock = useRef(false);
  const dictationRef = useRef<Dictation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = page !== null;
  const canDictate = dictationAvailable();

  useEffect(() => installModalKeyGuard(() => Boolean(dialog.current?.open), () => setPage(null)), []);

  function stopDictation() {
    dictationRef.current?.stop();
    dictationRef.current = null;
    setDictating(null);
  }
  useEffect(() => {
    if (!open) stopDictation();
  }, [open]);
  useEffect(() => () => { dictationRef.current?.stop(); }, []);

  function toggleDictation(field: 'title' | 'description') {
    if (dictating) { stopDictation(); if (dictating === field) return; }
    try {
    const session = startDictation((text) => {
      if (!text) return;
      if (field === 'title') setTitle((current) => `${current.replace(/\s+$/, '')}${current ? ' ' : ''}${text}`.slice(0, 200));
      else setDescription((current) => `${current.replace(/\s+$/, '')}${current ? ' ' : ''}${text}`.slice(0, 10000));
    }, () => { dictationRef.current = null; setDictating(null); });
    if (session) { dictationRef.current = session; setDictating(field); }
    } catch { setError("Dictation could not start. Use the keyboard or system dictation."); }
  }

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

  // Yield two frames so a closed overlay leaves the compositor before a new
  // Electron screenshot or element pick observes the bare app.
  async function settleClosed() {
    flushSync(() => setPage(null));
    await withTimeout(new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), 250).catch(() => {});
  }

  async function begin(recapture = false) {
    if (captureLock.current || actionLock.current) return;
    if (capture && !recapture) { setPage('form'); return; }
    if (payload && filingIssue !== 'conflict') return;
    captureLock.current = true;
    setCapturing(true);
    setError('');
    try {
      if (recapture) {
        await settleClosed();
        setPayload(null); setFilingIssue(null);
      }
      setPointer(null);
      // Strokes were drawn on the previous pixels; the pointer descriptor
      // names an element and survives a fresh screenshot of the same view.
      setStrokes([]); setAnnotating(false);
      setCapture(await captureFeedback(readers));
      setPage('form');
    } catch {
      setCapture({ snapshot: {}, screenshot: null, context: null, warnings: ['Capture failed. Reporting is still available.'] });
      setPage('form');
    } finally { captureLock.current = false; setCapturing(false); }
  }

  async function point() {
    if (captureLock.current || actionLock.current) return;
    captureLock.current = true;
    setError('');
    try {
      await settleClosed();
      const picked = await pickElement();
      if (picked) setPointer(picked);
      setPage('form');
    } finally { captureLock.current = false; }
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
    stopDictation();
    if (!capture?.context) { setError('Retry context before filing. Your draft is retained.'); return; }
    if (!title.trim() || !description.trim()) { setError('Title and detailed description are required.'); return; }
    void action(async () => {
      let screenshot = capture.screenshot;
      let warnings = capture.warnings;
      if (screenshot && (strokes.length > 0 || pointer)) {
        try { screenshot = await compositeScreenshot(screenshot, strokes, pointer, capture.snapshot.viewport); }
        catch { warnings = [...warnings, 'Annotations could not be baked in; filing the plain screenshot.']; }
      }
      // Lock all fields after the first attempt. An ambiguous POST retry must
      // reproduce the exact bytes/UUID, even after closing and reopening.
      const frozen: Payload = payload ?? {
        id: crypto.randomUUID(), kind, title: redact(title.trim(), 200), description: redact(description.trim(), 10000),
        origin: capture.context!.origin,
        snapshot: pointer ? { ...capture.snapshot, pointer: pointerSnapshot(pointer) } : capture.snapshot,
        screenshot,
        capture_warnings: warnings,
      };
      setPayload(frozen);
      let report;
      try { report = await feedbackApi.file(frozen); }
      catch (err) {
        // A later conflict cannot disprove persistence of an earlier timeout.
        if (filingIssue !== 'unknown' && err instanceof FeedbackError && [400, 403, 413, 415, 422].includes(err.status ?? 0)) {
          // These boundary rejections happen before persistence; let the user
          // correct the payload without discarding their text or evidence.
          setPayload(null); setFilingIssue(null);
        } else {
          setFilingIssue((previous) => previous === 'unknown' || !(err instanceof FeedbackError && err.status === 409) ? 'unknown' : 'conflict');
        }
        throw err;
      }
      setListing((current) => ({
        origin: current?.origin ?? capture.context!.origin,
        destination: current?.destination ?? report.destination,
        reports: [...(current?.reports.filter((r) => r.id !== report.id) ?? []), report],
        batches: current?.batches ?? [],
      }));
      setCapture(null); setPayload(null); setFilingIssue(null); setTitle(''); setDescription('');
      setPointer(null); setStrokes([]); setAnnotating(false);
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
  const entryClass = toolbar ? 'btn btn-toolbar' : 'btn btn-secondary';
  const dictateButton = (field: 'title' | 'description') => {
    if (!canDictate) return null;
    const active = dictating === field;
    return <button type="button" className={`btn btn-secondary btn-mini${active ? ' btn-selected' : ''}`}
      title="Dictate with the browser speech service; audio is processed by that service, the text stays editable here"
      disabled={busy || payload !== null}
      onClick={() => toggleDictation(field)}>{active ? 'Stop dictation' : 'Dictate'}</button>;
  };

  return <>
    <span className="feedback-entry" ref={entry} data-focusable>
      <button className={`${entryClass}${page === 'form' ? ' btn-selected' : ''}`} aria-haspopup="dialog" aria-expanded={page === 'form'} title="Report bug / Request feature" disabled={capturing || busy} onClick={() => void begin()}>
        {capturing ? 'Capturing...' : 'Feedback'}
      </button>
      <button className={`${entryClass}${page === 'review' ? ' btn-selected' : ''}`} aria-haspopup="dialog" aria-expanded={page === 'review'} title={listError || 'Reports awaiting dispatch, including pending or failed filing'} disabled={capturing} onClick={() => { setError(''); setPage('review'); }}>Queue ({pendingCount})</button>
    </span>
    {page && createPortal(<dialog ref={dialog} className="feedback-dialog" aria-labelledby={`${id}-heading`} data-focusable
      onCancel={(e) => { e.preventDefault(); setPage(null); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setPage(null);
      }}>
      <header className="feedback-header">
        <h2 id={`${id}-heading`}>{page === 'form' ? 'File a report' : 'Review feedback batches'}</h2>
        <button className="btn btn-secondary btn-mini" onClick={() => setPage(null)}>Close</button>
      </header>
      {error && <p role="alert" className="feedback-error">{error}</p>}
      {page === 'form' && capture && <form className="feedback-form" onSubmit={(event) => { event.preventDefault(); file(); }}>
        <div className="feedback-body">
        <CaptureHint snapshot={capture.snapshot} />
        <fieldset disabled={busy || payload !== null}>
          <div className="feedback-fields">
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="bug">Report bug</option><option value="feature">Request feature</option>
          </select></label>
          <label>Title<span className="feedback-field-row">
            <input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            {dictateButton('title')}
          </span></label>
          </div>
          <label>Detailed description<span className="feedback-field-row">
            <textarea rows={4} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} />
            {dictateButton('description')}
          </span></label>
          {canDictate && <p className="feedback-metadata">Starting Dictate may send microphone audio to the browser speech service for transcription immediately. The transcript stays editable here. Filing the feedback report is a separate action.</p>}
          <section className="feedback-attachments" aria-label="Local attachments">
          {capture.screenshot ? <div>
            <ScreenshotCanvas image={capture.screenshot} strokes={strokes} pointer={pointer} viewport={capture.snapshot.viewport}
              annotating={annotating} penColor={penColor} onStroke={(stroke) => setStrokes((current) => [...current, stroke])} />
            <div className="feedback-shot-tools">
              <button type="button" className={`btn btn-secondary btn-mini${annotating ? ' btn-selected' : ''}`} onClick={() => setAnnotating((current) => !current)}>{annotating ? 'Done drawing' : 'Draw'}</button>
              <button type="button" className="btn btn-secondary btn-mini" onClick={() => setCapture({ ...capture, screenshot: null })}>Remove screenshot</button>
            </div>
            {annotating && <div className="feedback-pen-row">
              {PEN_COLORS.map((color) => <button key={color} type="button" aria-label={`Pen ${color}`}
                className={`feedback-pen${color === penColor ? ' feedback-pen-selected' : ''}`}
                style={{ background: color }} onClick={() => setPenColor(color)} />)}
              <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={() => setStrokes((current) => current.slice(0, -1))}>Undo</button>
              <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button>
            </div>}
          </div> : <label>Optional PNG screenshot<input type="file" accept="image/png" onChange={(e) => {
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
          <div className="feedback-evidence-info">
          <div className="feedback-shot-tools">
            <button type="button" className={`btn btn-secondary btn-mini${pointer ? ' btn-selected' : ''}`} disabled={busy} onClick={() => void point()}>
              {pointer ? 'Repoint element' : 'Point at element'}
            </button>
          </div>
          {pointer && <p className="feedback-pointer-chip">
            Element: {pointerLabel(pointer)}
            <button type="button" className="btn btn-secondary btn-mini" onClick={() => setPointer(null)}>Remove element</button>
          </p>}
          <p className="text-secondary">Attachments stay local. Check the screenshot for private information.</p>
          {capture.warnings.map((warning, i) => <p className="feedback-warning" key={i}>{warning}</p>)}
          {Object.keys(capture.snapshot).length > 0 && <div>
            <details><summary>Diagnostics JSON (redacted)</summary><pre>{JSON.stringify(capture.snapshot, null, 2)}</pre></details>
            <button type="button" className="btn btn-secondary btn-mini" onClick={() => setCapture({ ...capture, snapshot: {} })}>Remove diagnostics</button>
          </div>}
          </div>
          </section>
        </fieldset>
        <div className="feedback-context">
          <span className="text-tertiary">Captured from {capture.context?.origin.lane ?? (capture.context ? 'main' : 'unknown origin')}</span>
          <button type="button" className="btn btn-secondary btn-mini" disabled={busy || (payload !== null && filingIssue !== 'conflict')}
            onClick={() => void begin(true)}>Recapture</button>
        </div>
        <details aria-label="GitHub summary preview"><summary>GitHub summary preview</summary>
          <strong>{redact(title.trim(), 200)}</strong><pre>{redact(description.trim(), 10000)}</pre>
        </details>
        {capture.context ? <details className="feedback-metadata"><summary>Routing details</summary>
          <p>Destination: {capture.context.destination}</p>
          <p>Revision: {capture.context.origin.revision ?? 'unavailable'}</p>
        </details>
          : <button type="button" className="btn btn-secondary btn-mini" disabled={busy} onClick={() => void action(async () => {
            const context = await feedbackApi.context();
            setCapture({ ...capture, context, warnings: [...capture.warnings, 'Origin resolved after initial capture because context was unavailable.'] });
          })}>Retry context</button>}
        {payload && <>
          <p className="feedback-warning">{filingIssue === 'conflict'
            ? `Report ${payload.id} was rejected by a conflict. Recapture refreshes the evidence and origin while keeping your text.`
            : `Submission locked to report ${payload.id}. Retry the same report to resolve an uncertain outcome; fields cannot change.`}</p>
          {filingIssue === 'unknown' && <p>Outcome unknown. Resolve this report in the queue or retry the same ID before recapturing.</p>}
        </>}
        </div>
        <footer className="feedback-footer">
          <p className="text-tertiary">Files an issue with this text only; the screenshot, diagnostics and trail stay local. Agent work starts only when you send the batch.</p>
          <div className="feedback-actions">
          {!payload && <button className="btn btn-danger btn-mini" type="button" disabled={busy} onClick={() => {
            setCapture(null); setTitle(''); setDescription(''); setPointer(null); setStrokes([]); setAnnotating(false); setPage(null);
          }}>Discard draft</button>}
          <button className="btn btn-secondary" type="button" onClick={() => { setError(''); setPage('review'); }}>Review batches</button>
          <button className="btn btn-primary" type="submit" disabled={busy || !capture.context}>{busy ? 'Working...' : payload ? 'Retry same report' : 'File report on GitHub'}</button>
          </div>
        </footer>
      </form>}
      {page === 'review' && <>
        <div className="feedback-body">
        <div className="feedback-context">
          <span className="text-secondary">{listing?.destination ?? 'Destination unavailable'}</span>
          <button className="btn btn-secondary btn-mini" disabled={busy} onClick={() => void action(refresh)}>Refresh status</button>
        </div>
        {capture && <button className="btn btn-secondary btn-mini" onClick={() => { setError(''); setPage('form'); }}>Resume report</button>}
        {payload && <section>
          <p>Locked report: {payload.id}. {savedPayload ? 'Saved on the server; use this record instead of creating another ID.' : 'No saved record confirmed. Absence from this list does not resolve an in-flight request; retry the same ID.'}</p>
          {savedPayload && <button className="btn btn-secondary" disabled={busy || Boolean(listError)} onClick={() => {
            setPayload(null); setFilingIssue(null); setCapture(null); setTitle(''); setDescription(''); setError('');
          }}>Use saved report</button>}
        </section>}
        {listError && <p role="alert" className="feedback-error">{listError}</p>}
        {!listing && !listError && <p role="status">Loading saved feedback...</p>}
        {listing?.reports.length === 0 && <p>No saved reports.</p>}
        {listing?.reports.map((report) => <article key={report.id}>
          <div className="feedback-context"><h3>{redact(report.title, 200)}</h3><span className="text-tertiary">{report.kind}</span></div>
          <p className="text-secondary">{report.batch_id ? 'Included in a dispatched batch' : reportStatus[report.status]}</p>
          {report.destination !== listing.destination && <p className="feedback-metadata">Destination: {report.destination}</p>}
          {report.issue_url && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(report.issue_url) && <a href={report.issue_url} target="_blank" rel="noreferrer">Open GitHub issue</a>}
          {report.error && <p className="feedback-error">{redact(report.error)}</p>}
          {['filing_failed', 'filing_uncertain'].includes(report.status) && <button type="button" className="btn btn-secondary btn-mini" disabled={busy}
            onClick={() => void action(async () => { await feedbackApi.retryReport(report.id); await refresh(); })}>Retry GitHub filing</button>}
        </article>)}
        {listing?.batches.map((batch) => <article key={batch.id}>
          <h3>Batch of {batch.report_ids.length} reports</h3>
          <p className="feedback-metadata">{batch.destination}</p>
          <p>{batchStatus[batch.status]}</p>
          {batch.error && <p className="feedback-error">{redact(batch.error)}</p>}
          {batch.status !== 'delivered' && <button type="button" className="btn btn-secondary btn-mini" disabled={busy} onClick={() => void action(async () => {
            await feedbackApi.retryBatch(batch.id); await refresh();
          })}>Retry authorized batch</button>}
        </article>)}
        </div>
        <footer className="feedback-footer">
          <p className="text-tertiary">Send feedback authorizes agent work on that batch. Closing never sends.</p>
        {[...groups].map(([destination, ids]) => <div className="feedback-dispatch" key={destination}>
          <span className="feedback-metadata">{destination}</span>
          <button className="btn btn-primary" disabled={busy || Boolean(listError)} onClick={() => void action(async () => {
            const batch = await feedbackApi.dispatch([...ids]);
            setListing((current) => current && ({ ...current,
              reports: current.reports.map((r) => batch.report_ids.includes(r.id) ? { ...r, batch_id: batch.id } : r),
              batches: [...current.batches.filter((b) => b.id !== batch.id), batch],
            }));
            await refresh();
          })}>Send feedback ({ids.length})</button>
        </div>)}
        </footer>
      </>}
    </dialog>, document.body)}
  </>;
}
