import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Settings → Library → Remote library: the read-only first step of the
 * cloud library. Runs the mirror plan against the real library and shows
 * what a cloud copy would send. Nothing uploads, syncs or changes - there
 * is no remote yet. */
export default function RemoteLibrarySettings() {
  const preview = useQuery({
    queryKey: ['remote-mirror-preview'],
    queryFn: api.remoteMirror.preview,
    enabled: false,
    retry: false,
    staleTime: Infinity,
  });
  const data = preview.data;

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Remote library</h2>
          <p>A cloud copy of your library you can reach from anywhere. Not live yet.</p>
        </div>
      </div>
      <div className="settings-fields">
        <div className="settings-field">
          <div>
            <span className="settings-field-label">Mirror preview</span>
            <p>
              See what copying your library to the cloud would send: files, total size, and
              anything that would need attention first. This is a heavy read: it hashes every
              audio file in your library in one go, which can take minutes on a large library
              and shares the disk with playback, so run it when you are not mixing. Leaving this
              page does not cancel a scan that is already running. Read-only: nothing uploads
              and nothing changes.
            </p>
          </div>
          <div className="settings-library-inputs">
            <button
              className="btn btn-secondary"
              disabled={preview.isFetching}
              onClick={() => preview.refetch()}
            >
              {preview.isFetching ? 'Scanning library...' : data ? 'Run again' : 'Run preview'}
            </button>
          </div>
        </div>

        {preview.isError ? (
          <p role="alert" className="settings-hint">
            Could not run the preview:{' '}
            {preview.error instanceof Error ? preview.error.message : 'unknown error'}
          </p>
        ) : null}

        {data?.status === 'no_tracks_root' ? (
          <p role="status" className="settings-hint">
            Set your tracks folder in Library settings first, then run the preview.
          </p>
        ) : null}

        {data?.status === 'ok' ? (
          <>
            <div className="settings-field">
              <div>
                <span className="settings-field-label">What a cloud copy would take</span>
                <p>
                  Scanned in {formatDuration(data.duration_ms)} ·{' '}
                  {new Date(data.computed_at).toLocaleString()}
                </p>
              </div>
              <div className="settings-library-inputs">
                <div className="remote-mirror-stats">
                  <div className="remote-mirror-stat">
                    <strong>{data.tracks.toLocaleString()}</strong>
                    <span>tracks</span>
                  </div>
                  <div className="remote-mirror-stat">
                    <strong>{data.files.toLocaleString()}</strong>
                    <span>files to send</span>
                  </div>
                  <div className="remote-mirror-stat">
                    <strong>{formatBytes(data.upload_bytes)}</strong>
                    <span>to upload</span>
                  </div>
                  <div className="remote-mirror-stat">
                    <strong>{data.missing_total.toLocaleString()}</strong>
                    <span>need attention</span>
                  </div>
                </div>
              </div>
            </div>

            {data.missing_total > 0 ? (
              <div className="settings-field">
                <div>
                  <span className="settings-field-label">Needs attention</span>
                  <p>
                    {data.missing_total === 1
                      ? 'One track could not be mirrored'
                      : `${data.missing_total.toLocaleString()} tracks could not be mirrored`}
                    {data.missing_total > data.missing.length
                      ? ` (showing ${data.missing.length})`
                      : ''}
                    .
                  </p>
                </div>
                <div className="settings-library-inputs">
                  <ul className="remote-mirror-problems">
                    {data.missing.map((m) => (
                      <li key={m.track_id}>
                        <span>Track {m.track_id}</span>
                        <small>{m.reason}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {data.collision_total > 0 ? (
              <div className="settings-field">
                <div>
                  <span className="settings-field-label">Name conflicts</span>
                  <p>
                    {data.collision_total === 1
                      ? 'One file name differs only by letter case from another'
                      : `${data.collision_total.toLocaleString()} file names differ only by letter case from another`}
. Some cloud storage treats
                    names that differ only by letter case as the same file and could merge or
                    overwrite them. They are kept apart here, not renamed.
                  </p>
                </div>
                <div className="settings-library-inputs">
                  <ul className="remote-mirror-problems">
                    {data.collisions.map((c) => (
                      <li key={c}>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
