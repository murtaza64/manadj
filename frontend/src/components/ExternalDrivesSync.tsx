import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type {
  ExternalDrive,
  ExternalDrivePreview,
  ExternalDriveImportResult,
  ExternalDrivePreviewPlaylist,
  ExternalDrivePullEntry,
} from '../api/client';
import KeyDisplay from './KeyDisplay';
import BPMDisplay from './BPMDisplay';
import './ExternalDrivesSync.css';

type Phase =
  | { step: 'idle' }
  | { step: 'previewing'; drive: ExternalDrive }
  | { step: 'preview'; drive: ExternalDrive; preview: ExternalDrivePreview; verifying: boolean }
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

function statusLabel(kind: RowKind, verifying: boolean): string {
  if (verifying && kind === 'uncertain') return 'checking…';
  switch (kind) {
    case 'present':
      return 'in library';
    case 'renamed':
      return 'renamed, verified';
    case 'uncertain':
      return 'unverified match';
    case 'new':
      return 'no match found';
    case 'duplicate':
      return 'duplicate on drive';
    case 'missing-file':
      return 'missing audio';
  }
}

function newOrdinals(preview: ExternalDrivePreview): Set<number> {
  return new Set(preview.entries.filter((e) => e.status === 'new').map((e) => e.ordinal));
}

function formatDuration(secs: number | null): string {
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function summaryOf(preview: ExternalDrivePreview, verifying: boolean): string {
  if (verifying) {
    const pending = preview.uncertain_count;
    return pending > 0
      ? `${preview.entries.length} tracks on the drive · checking ${pending} possible match${pending === 1 ? '' : 'es'}…`
      : `${preview.entries.length} tracks on the drive · finishing verification…`;
  }
  const renamed = preview.entries.filter((e) => rowKind(e) === 'renamed').length;
  const parts = [
    `${preview.new_count} no match found`,
    `${preview.present_count} already in library${renamed > 0 ? ` (${renamed} renamed, verified)` : ''}`,
  ];
  if (preview.uncertain_count > 0) {
    parts.push(
      `${preview.uncertain_count} unverified match${preview.uncertain_count === 1 ? '' : 'es'} (not imported)`
    );
  }
  if (preview.duplicate_count > 0) {
    parts.push(`${preview.duplicate_count} duplicate${preview.duplicate_count === 1 ? '' : 's'} on drive`);
  }
  if (preview.missing_file_count > 0) {
    parts.push(`${preview.missing_file_count} missing audio`);
  }
  return parts.join(' · ');
}

/** External drives: detect a Rekordbox or Engine USB library, preview what a
 * pull would add, then run it on an explicit confirm. Pull only — the drive
 * is never written to from this view. */
export function ExternalDrivesSync() {
  const [drives, setDrives] = useState<ExternalDrive[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [destination, setDestination] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Editable local name per device playlist (keyed by device playlist id),
  // prefilled with the device name so a conflict is resolved by the user,
  // never by silently merging.
  const [playlistNames, setPlaylistNames] = useState<Record<number, string>>({});
  const [importingPlaylistId, setImportingPlaylistId] = useState<number | null>(null);
  // Monotonic token: every async preview checks it before applying, so a
  // response racing a cancel, a failure, or a newer preview is dropped
  // instead of resurrecting a stale plan.
  const previewGen = useRef(0);

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
    const gen = ++previewGen.current;
    setError(null);
    setFilter('');
    setPhase({ step: 'previewing', drive });
    try {
      // Metadata first: every row listed immediately, matches unverified.
      const fast = await api.externalDrives.preview(drive.root, undefined, false);
      if (gen !== previewGen.current) return;
      setDestination(fast.default_destination ?? '');
      setSelected(newOrdinals(fast));
      setPlaylistNames(
        Object.fromEntries((fast.playlists ?? []).map((pl) => [pl.id, pl.name ?? '']))
      );
      setPhase({ step: 'preview', drive, preview: fast, verifying: true });
      // Then content verification; rows refine in place when it lands.
      const full = await api.externalDrives.preview(drive.root, undefined, true);
      if (gen !== previewGen.current) return;
      setDestination(full.default_destination ?? '');
      // Verification can only move tracks OUT of new (into verified or
      // unverified), so keep checks the user already made where the row
      // is still importable and drop the rest.
      setSelected((prev) => {
        const stillNew = newOrdinals(full);
        return new Set([...prev].filter((o) => stillNew.has(o)));
      });
      setPhase({ step: 'preview', drive, preview: full, verifying: false });
    } catch (e) {
      if (gen !== previewGen.current) return;
      setError(e instanceof Error ? e.message : 'Preview failed');
      setPhase({ step: 'idle' });
    }
  }, []);

  const cancelPreview = useCallback(() => {
    previewGen.current += 1; // in-flight verification resolves into the void
    setPhase({ step: 'idle' });
  }, []);

  const runImport = useCallback(async () => {
    if (phase.step !== 'preview' || phase.verifying) return;
    const { drive, preview } = phase;
    setError(null);
    setPhase({ step: 'importing', drive, preview });
    try {
      // Re-preview (read-only, verified) with the destination so the
      // fingerprint the confirm carries binds the reviewed set AND where
      // it lands, both as they are right now.
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
        setSelected(newOrdinals(bound));
        setPhase({ step: 'preview', drive, preview: bound, verifying: false });
        return;
      }
      const checked = [...selected].filter((o) => newOrdinals(bound).has(o));
      const result = await api.externalDrives.import({
        root: drive.root,
        destination: destination || undefined,
        confirm: true,
        preview_fingerprint: bound.fingerprint,
        ordinals: checked,
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
        setPhase({ step: 'preview', drive, preview, verifying: false });
      }
    }
  }, [phase, destination, refresh, selected]);

  const runPlaylistImport = useCallback(
    async (playlist: ExternalDrivePreviewPlaylist) => {
      if (phase.step !== 'preview' || phase.verifying) return;
      const { drive, preview } = phase;
      setError(null);
      setImportingPlaylistId(playlist.id);
      setPhase({ step: 'importing', drive, preview });
      try {
        // Same binding discipline as the track import: re-preview verified
        // with the destination; a changed plan swaps in for fresh review
        // and the server fingerprint refuses anything that slips past.
        const bound = await api.externalDrives.preview(drive.root, destination || undefined);
        const planOf = (p: ExternalDrivePreview) =>
          p.entries.map((e) => `${e.ordinal}:${e.device_path}:${e.status}`).join('\n') +
          '\n' +
          (p.playlists ?? [])
            .map((pl) => `${pl.id}:${pl.name}:${(pl.track_ordinals ?? []).join(',')}`)
            .join('\n');
        if (planOf(bound) !== planOf(preview)) {
          setError(
            'The drive or library changed since this preview; review the refreshed plan before importing.'
          );
          setSelected(newOrdinals(bound));
          setPlaylistNames(
            Object.fromEntries((bound.playlists ?? []).map((pl) => [pl.id, pl.name ?? '']))
          );
          setPhase({ step: 'preview', drive, preview: bound, verifying: false });
          return;
        }
        const editedName = (playlistNames[playlist.id] ?? '').trim();
        const result = await api.externalDrives.import({
          root: drive.root,
          destination: destination || undefined,
          confirm: true,
          preview_fingerprint: bound.fingerprint,
          create_playlist_id: playlist.id,
          ...(editedName && editedName !== (playlist.name ?? '')
            ? { playlist_name: editedName }
            : {}),
        });
        setPhase({ step: 'done', drive, result });
        refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Import failed';
        setError(message);
        if (message.includes('changed since the preview')) {
          setPhase({ step: 'idle' });
        } else {
          setPhase({ step: 'preview', drive, preview, verifying: false });
        }
      } finally {
        setImportingPlaylistId(null);
      }
    },
    [phase, destination, refresh, playlistNames]
  );

  const busy = phase.step === 'previewing' || phase.step === 'importing';
  const verifying = phase.step === 'preview' && phase.verifying;
  const selectedNewCount =
    phase.step === 'preview' || phase.step === 'importing'
      ? [...selected].filter((o) => newOrdinals(phase.preview).has(o)).length
      : 0;
  const filterNorm = filter.trim().toLowerCase();
  const visibleEntries =
    phase.step === 'preview' || phase.step === 'importing'
      ? phase.preview.entries.filter((e) => {
          if (!filterNorm) return true;
          return [e.artist ?? '', e.title ?? '', e.device_path]
            .join(' ')
            .toLowerCase()
            .includes(filterNorm);
        })
      : [];

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
            {summaryOf(phase.preview, verifying)}
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

          <label className="external-drive-filter">
            Filter
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Artist, title or file name"
              disabled={phase.step === 'importing'}
            />
          </label>

          <p className="external-drive-hint">
            Every track on the drive, in drive order. Unverified matches are never
            imported; tracks with no library match are not proven new, just unmatched.
            {verifying && ' Match verification is still running; import unlocks when it finishes.'}
          </p>
          {(phase.preview.playlists ?? []).length > 0 && (
            <div className="external-drive-playlists">
              <h4>Playlists on this drive</h4>
              <p className="external-drive-hint">
                Importing a playlist copies only its tracks that have no library match and
                creates the playlist in manaDJ in USB order. Nothing is written to the drive.
              </p>
              <ul>
                {phase.preview.playlists.map((pl) => (
                  <li key={pl.id} className="external-drive-playlist">
                    <span className="external-drive-playlist-name">
                      {pl.folder_path ? `${pl.folder_path} / ` : ''}
                      {pl.name ?? '(unnamed)'}
                    </span>
                    <span className="external-drive-playlist-counts">
                      {pl.track_count} tracks · {pl.new_count} to import ·{' '}
                      {pl.present_count} already in library
                      {pl.uncertain_count > 0 &&
                        ` · ${pl.uncertain_count} unverified (skipped)`}
                    </span>
                    <input
                      type="text"
                      className="external-drive-playlist-rename"
                      aria-label={`Local name for ${pl.name ?? 'playlist'}`}
                      value={playlistNames[pl.id] ?? pl.name ?? ''}
                      disabled={phase.step === 'importing'}
                      onChange={(e) =>
                        setPlaylistNames((prev) => ({ ...prev, [pl.id]: e.target.value }))
                      }
                    />
                    <button
                      className="btn"
                      disabled={
                        phase.step === 'importing' ||
                        verifying ||
                        !destination.trim() ||
                        pl.track_count === 0
                      }
                      title={
                        verifying ? 'Match verification is still running' : undefined
                      }
                      onClick={() => runPlaylistImport(pl)}
                    >
                      {importingPlaylistId === pl.id ? 'Importing…' : 'Import playlist'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="external-drive-tracklist">
            <div className="external-drive-track external-drive-track-head">
              <span></span>
              <span>Match</span>
              <span>Artist</span>
              <span>Title</span>
              <span className="external-drive-key">Key</span>
              <span className="external-drive-bpm">BPM</span>
              <span className="external-drive-time">Time</span>
            </div>
            <ul className="external-drive-tracklist-body">
              {visibleEntries.map((e) => {
                const kind = rowKind(e);
                return (
                  <li key={e.ordinal} className={`external-drive-track status-${kind}`}>
                    <span className="external-drive-check">
                      {kind === 'new' && (
                        <input
                          type="checkbox"
                          checked={selected.has(e.ordinal)}
                          disabled={phase.step === 'importing'}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(e.ordinal)) next.delete(e.ordinal);
                              else next.add(e.ordinal);
                              return next;
                            })
                          }
                        />
                      )}
                    </span>
                    <span className={`external-drive-status status-${kind}`}>
                      {statusLabel(kind, verifying)}
                    </span>
                    <span className="external-drive-artist" title={e.artist ?? ''}>
                      {e.artist ?? ''}
                    </span>
                    <span
                      className="external-drive-title"
                      title={`${e.title ?? ''} · USB: ${e.device_path}${
                        e.matched_path ? ` · library: ${e.matched_path}` : ''
                      }`}
                    >
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
          </div>

          <div className="external-drive-actions">
            <button
              className="btn btn-primary external-drive-confirm"
              disabled={
                phase.step === 'importing' ||
                verifying ||
                selectedNewCount === 0 ||
                !destination.trim()
              }
              title={
                verifying
                  ? 'Match verification is still running'
                  : undefined
              }
              onClick={runImport}
            >
              {phase.step === 'importing'
                ? 'Importing…'
                : verifying
                  ? 'Checking matches…'
                  : `Import ${selectedNewCount} selected`}
            </button>
            <button
              className="btn"
              disabled={phase.step === 'importing'}
              onClick={cancelPreview}
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
              ` · ${phase.result.skipped_uncertain} unverified match${phase.result.skipped_uncertain === 1 ? '' : 'es'} skipped`}
            {phase.result.skipped_missing_file > 0 &&
              ` · ${phase.result.skipped_missing_file} missing audio`}
            . Copied into {phase.result.destination}. Waveform and analysis jobs are queued.
          </p>
          {phase.result.playlist && (
            <p className="external-drive-playlist-result">
              Playlist &quot;{phase.result.playlist.name}&quot; created with{' '}
              {phase.result.playlist.member_count} tracks in USB order ·{' '}
              {phase.result.playlist.imported} new files copied ·{' '}
              {phase.result.playlist.already_in_library} already in library
              {phase.result.playlist.skipped_uncertain > 0 &&
                ` · ${phase.result.playlist.skipped_uncertain} unverified skipped`}
              {phase.result.playlist.skipped_other > 0 &&
                ` · ${phase.result.playlist.skipped_other} unavailable skipped`}
              .
            </p>
          )}
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
