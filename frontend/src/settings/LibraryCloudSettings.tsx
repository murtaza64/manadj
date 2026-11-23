import { useEffect, useRef, useState } from 'react';
import './LibraryCloudSettings.css';
const EMPTY: LibraryCloudSummary = { connection: { enabled: false, phase: 'disabled', destination: null }, upload: { phase: 'idle', error: null } };
const messages: Record<string, string> = {
  cloud_disabled: 'Cloud connection is not enabled in this build.',
  cloud_review_expired: 'This review expired or the connection changed. Review a new snapshot before uploading.',
  cloud_signin_required: 'Connect your owner account first.',
  cloud_auth_rejected: 'Owner sign-in was not accepted. Your local data is unchanged.',
  cloud_managed_backend_required: 'Use the managed desktop app for a metadata review. Attach-only mode cannot prepare a snapshot.',
  cloud_snapshot_limit: 'This snapshot exceeds the reviewed limits. Nothing was shortened or uploaded.',
  cloud_frozen_source_invalid: 'Some metadata is outside the reviewed format. Nothing was silently dropped. Upload is paused.',
  cloud_prepare_failed: 'Could not prepare a safe metadata snapshot. Your library is unchanged.',
  cloud_upload_cancelled: 'Canceled locally. An incomplete cloud reservation may remain. No cloud data was deleted.',
  cloud_operation_cancelled: 'The operation was canceled.',
};
export default function LibraryCloudSettings() {
  const bridge = window.manadjLibraryCloud;
  const [state, setState] = useState<LibraryCloudSummary>(EMPTY);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    bridge?.state().then(result => { if (mounted.current && result.ok) setState(result.value); });
    return () => { mounted.current = false; operation.current++; void bridge?.cancel(); };
  }, [bridge]);
  async function act(action: () => Promise<LibraryCloudResult>) {
    const generation = ++operation.current; setBusy(true); setError(null);
    try {
      const result = await action();
      if (!mounted.current || generation !== operation.current) return;
      if (result.ok) setState(result.value);
      else { setError(messages[result.error] ?? 'Cloud operation failed. The reviewed local snapshot is kept for an explicit retry.');
        const latest = await bridge?.state(); if (latest?.ok && mounted.current && generation === operation.current) setState(latest.value); }
    } catch { if (mounted.current && generation === operation.current) setError('Desktop connection unavailable. Your local data is unchanged.'); }
    finally { if (mounted.current && generation === operation.current) setBusy(false); }
  }
  const connected = state.connection.phase === 'connected', enabled = !!bridge && state.connection.enabled;
  const review = state.upload, canUpload = enabled && connected && ['review', 'failed'].includes(review.phase) && !!review.reviewID && !!review.reviewedSha256;
  return <>
    <div className="settings-section-heading"><div><h2>Private metadata snapshots</h2>
      <p>Library metadata and local mixing history. No audio or stems. Not playback or sync.</p></div></div>
    <div className="settings-fields">
      {!enabled ? <p role="status" className="settings-hint">Under construction. Cloud uploads are disabled in this build. Your library stays on this device.</p> : <>
        <p className="settings-hint library-cloud-destination">Owner-only destination: {state.connection.destination}. Metered storage, not a fixed-price plan.</p>
        <div className="library-cloud-actions">
          {!connected ? <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void act(() => bridge!.connect())}>Connect owner account</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void act(() => bridge!.resume())}>Resume saved connection</button>
          </> : <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void act(() => bridge!.review())}>Review snapshot</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void act(() => bridge!.disconnect())}>Disconnect locally</button>
          </>}
        </div>
      </>}
      {review.snapshotId && <section aria-label="Reviewed metadata snapshot" className="library-cloud-review">
        <div><strong>{review.phase === 'verified' ? 'Uploaded and read back' : 'Frozen metadata review'}</strong>
          <p>{review.destination}</p><p>{review.bytes?.toLocaleString()} bytes · {review.partCount} parts</p>
          <p>Snapshot {review.snapshotId}</p>
          <ul>{Object.entries(review.rowCounts ?? {}).map(([table, count]) => <li key={table}>{table}: {count.toLocaleString()} rows</li>)}</ul>
          <details><summary>What stays out</summary><ul>{review.omissions?.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
          <p className="settings-hint">Manual upload only. No cloud deletion control is available yet. App quotas are not a billing cap. Your SSD backup stays separate.</p>
          {review.phase === 'verified' && <p role="status">Receipt and every downloaded part matched the reviewed hashes. Local files were not changed.</p>}
        </div>
        {canUpload && <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => bridge!.upload({ reviewID: review.reviewID!, reviewedSha256: review.reviewedSha256! }))}>
          {review.phase === 'failed' ? 'Retry reviewed upload' : 'Upload reviewed snapshot'}</button>}
      </section>}
      {busy && <div role="status"><p>{review.phase === 'review' || review.phase === 'failed' ? 'Uploading and checking the reviewed snapshot...' : 'Working...'}</p>
        <button className="btn btn-secondary" onClick={() => void act(() => bridge!.cancel())}>Cancel</button></div>}
      {error && <p role="alert" className="settings-hint">{error}</p>}
    </div>
  </>;
}
