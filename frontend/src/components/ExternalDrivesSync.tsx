import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  ExternalDrive,
  ExternalDrivePreview,
  ExternalDriveImportResult,
  ExternalDrivePullEntry,
} from '../api/client';
import KeyDisplay from './KeyDisplay';
import BPMDisplay from './BPMDisplay';
import './ExternalDrivesSync.css';

type Phase =
  | { step: 'idle' }
  | { step: 'previewing'; drive: ExternalDrive }
  | { step: 'preview'; drive: ExternalDrive; preview: ExternalDrivePreview }
  | { step: 'importing'; drive: ExternalDrive; preview: ExternalDrivePreview }
  | { step: 'done'; drive: ExternalDrive; result: ExternalDriveImportResult };

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

/** Visible classification of a preview row. A verified match whose file
 * name differs from the library copy is a rename and must read as one,
 * not silently collapse into "present". */
type RowKind = 'present' | 'renamed' | 'uncertain' | 'new' | 'duplicate' | 'missing-file';

function rowKind(e: ExternalDrivePullEntry): RowKind {
  if (
    e.status === 'present' &&
    e.matched_path &&
    fileName(e.matched_path).toLowerCase() !== fileName(e.device_path).toLowerCase()
  ) {
    return 'renamed';
  }
  return e.status;
}

const STATUS_LABEL: Record<RowKind, string> = {
  present: 'in library',
  renamed: 'renamed, verified',
  uncertain: 'unverified match',
  new: 'no match found',
  duplicate: 'duplicate on drive',
  'missing-file': 'missing audio',
};

function formatDuration(secs: number | null): string {
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** External drives: detect a Rekordbox or Engine USB library, preview what a
 * pull would add, then run it on an explicit confirm. Pull only — the drive
 * is never written to from this view. */
export function ExternalDrivesSync() {
  const [drives, setDrives] = useState<ExternalDrive[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDrives(await api.externalDrives.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drive detection failed');
      setDrives([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setDrives(await api.externalDrives.list());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Drive detection failed');
        setDrives([]);
      }
    })();
  }, []);

  const openPreview = useCallback(async (drive: ExternalDrive) => {
    setError(null);
    setPhase({ step: 'previewing', drive });
    try {
      const preview = await api.externalDrives.preview(drive.root);
      setDestination(preview.default_destination ?? '');
      setPhase({ step: 'preview', drive, preview });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
      setPhase({ step: 'idle' });
    }
  }, []);

  const runImport = useCallback(async () => {
    if (phase.step !== 'preview') return;
    const { drive, preview } = phase;
    setError(null);
    setPhase({ step: 'importing', drive, preview });
    try {
      // Re-preview (read-only) with the destination so the fingerprint the
      // confirm carries binds the reviewed set AND where it lands, both as
      // they are right now.
      const bound = await api.externalDrives.preview(drive.root, destination || undefined);
      // The re-preview must not mint a fingerprint for a plan the user
      // never saw: if the freshly read plan differs from the reviewed one
      // in ANY entry (path added or gone, classification changed), swap in
      // the fresh preview for explicit review and import nothing.
      const planOf = (p: ExternalDrivePreview) =>
        p.entries.map((e) => `${e.ordinal}:${e.device_path}:${e.status}`).join('\n');
      if (planOf(bound) !== planOf(preview)) {
        setError(
          'The drive or library changed since this preview; review the refreshed plan before importing.'
        );
        setPhase({ step: 'preview', drive, preview: bound });
        return;
      }
      const result = await api.externalDrives.import({
        root: drive.root,
        destination: destination || undefined,
        confirm: true,
        preview_fingerprint: bound.fingerprint,
      });
      setPhase({ step: 'done', drive, result });
      refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
      // A changed plan (409) invalidates the reviewed preview: back to the
      // drive list so the next step is a fresh preview, never a retry of
      // the stale one.
      if (message.includes('changed since the preview')) {
        setPhase({ step: 'idle' });
      } else {
        setPhase({ step: 'preview', drive, preview });
      }
    }
  }, [phase, destination, refresh]);

  const busy = phase.step === 'previewing' || phase.step === 'importing';

  return (
    <div className="external-drives">
      <div className="external-drives-header">
        <h2>USB drives</h2>
        <button className="btn" onClick={refresh} disabled={busy}>
          Detect drives
        </button>
      </div>
      <p className="external-drives-hint">
        Pull tracks from a Rekordbox or Engine USB library into manaDJ. The drive is only
        read from; nothing is written back to it here.
      </p>

      {error && <div className="external-drives-error">{error}</div>}

      {drives !== null && drives.length === 0 && phase.step === 'idle' && (
        <p className="external-drives-empty">
          No Rekordbox or Engine libraries found on mounted drives.
        </p>
      )}

      {drives !== null && drives.length > 0 && (
        <div className="external-drives-list">
          {drives.map((drive) => (
            <div key={drive.root} className="external-drive-row">
              <span className={`external-drive-kind ${drive.kind}`}>
                {drive.kind === 'rekordbox' ? 'Rekordbox' : 'Engine'}
              </span>
              <span className="external-drive-root">{drive.root}</span>
              <span className="external-drive-count">
                {drive.track_count == null ? 'unknown size' : `${drive.track_count} tracks`}
              </span>
              <button
                className="btn"
                disabled={busy}
                onClick={() => openPreview(drive)}
              >
                Pull…
              </button>
            </div>
          ))}
        </div>
      )}

      {(phase.step === 'preview' || phase.step === 'importing') && (
        <div className="external-drive-preview">
          <h3>
            Pull from {phase.drive.name} ({phase.preview.kind})
          </h3>
          <p className="external-drive-summary">
            {phase.preview.new_count} new · {phase.preview.present_count} already in library
            {phase.preview.uncertain_count > 0 &&
              ` · ${phase.preview.uncertain_count} name-only match${phase.preview.uncertain_count === 1 ? '' : 'es'} (not imported)`}
            {phase.preview.duplicate_count > 0 && ` · ${phase.preview.duplicate_count} duplicates on drive`}
            {phase.preview.missing_file_count > 0 && ` · ${phase.preview.missing_file_count} missing audio`}
          </p>

          <label className="external-drive-dest">
            Copy new files into
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Library folder (required)"
              disabled={phase.step === 'importing'}
            />
          </label>

          <p className="external-drive-hint">
            Every track on the drive, in drive order. Unverified matches are never
            imported; tracks with no library match are not proven new, just unmatched.
          </p>
          <ul className="external-drive-tracklist">
            {phase.preview.entries.map((e) => {
              const kind = rowKind(e);
              return (
                <li key={e.ordinal} className={`external-drive-track status-${kind}`}>
                  <span className={`external-drive-status status-${kind}`}>
                    {STATUS_LABEL[kind]}
                  </span>
                  <span className="external-drive-artist">{e.artist ?? ''}</span>
                  <span className="external-drive-title">
                    {e.title ?? fileName(e.device_path)}
                    {kind === 'renamed' && e.matched_path ? (
                      <span className="external-drive-detail">
                        USB {fileName(e.device_path)} = library{' '}
                        {fileName(e.matched_path)} (same audio, verified)
                      </span>
                    ) : (
                      e.detail && <span className="external-drive-detail">{e.detail}</span>
                    )}
                  </span>
                  <span className="external-drive-key">
                    <KeyDisplay keyValue={e.key} />
                  </span>
                  <span className="external-drive-bpm">
                    <BPMDisplay bpm={e.bpm} round />
                  </span>
                  <span className="external-drive-time">{formatDuration(e.duration_secs)}</span>
                </li>
              );
            })}
          </ul>

          <div className="external-drive-actions">
            <button
              className="btn btn-primary external-drive-confirm"
              disabled={
                phase.step === 'importing' ||
                phase.preview.new_count === 0 ||
                !destination.trim()
              }
              onClick={runImport}
            >
              {phase.step === 'importing'
                ? 'Importing…'
                : `Import ${phase.preview.new_count} track${phase.preview.new_count === 1 ? '' : 's'}`}
            </button>
            <button
              className="btn"
              disabled={phase.step === 'importing'}
              onClick={() => setPhase({ step: 'idle' })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.step === 'done' && (
        <div className="external-drive-result">
          <h3>Imported from {phase.drive.name}</h3>
          <p>
            {phase.result.imported} added · {phase.result.skipped_present} already in library
            {phase.result.skipped_uncertain > 0 &&
              ` · ${phase.result.skipped_uncertain} name-only match${phase.result.skipped_uncertain === 1 ? '' : 'es'} skipped`}
            {phase.result.skipped_missing_file > 0 &&
              ` · ${phase.result.skipped_missing_file} missing audio`}
            . Copied into {phase.result.destination}. Waveform and analysis jobs are queued.
          </p>
          {phase.result.errors.length > 0 && (
            <ul className="external-drive-errors">
              {phase.result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
          <button className="btn" onClick={() => setPhase({ step: 'idle' })}>Done</button>
        </div>
      )}
    </div>
  );
                    }
