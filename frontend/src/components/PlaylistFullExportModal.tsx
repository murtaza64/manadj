import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import type { PlaylistExportTarget, PlaylistExportTargetPreview } from '../types';
import './PlaylistFullExportModal.css';


interface PlaylistFullExportModalProps {
  playlistName: string;
  onClose: () => void;
}

function TargetPlan({ preview, loading }: {
  preview: PlaylistExportTargetPreview | undefined;
  loading: boolean;
}) {
  if (loading) return <span className="target-plan">computing plan...</span>;
  if (!preview) return <span className="target-plan">plan unavailable</span>;
  if (!preview.available) {
    return <span className="target-plan plan-unavailable">unavailable: {preview.error}</span>;
  }
  const changes = [
    ...(preview.tracks_to_add ? [`adds ${preview.tracks_to_add}`] : []),
    ...(preview.tracks_to_remove ? [`removes ${preview.tracks_to_remove}`] : []),
    ...(preview.tracks_moved ? [`moves ${preview.tracks_moved}`] : []),
  ];
  const membership = preview.playlist_exists
    ? (changes.length > 0 ? `replaces playlist: ${changes.join(', ')}` : 'playlist already matches')
    : `creates playlist (${preview.tracks_matched} tracks)`;
  const unmatched = preview.unmatched ?? [];
  return (
    <span className="target-plan">
      {membership}
      {' · '}
      overwrites data for {preview.tracks_matched} track{preview.tracks_matched === 1 ? '' : 's'}
      {unmatched.length > 0 && (
        <span className="plan-unmatched" title={unmatched.join('\n')}>
          {' · '}{unmatched.length} unmatched
        </span>
      )}
    </span>
  );
}

export function PlaylistFullExportModal({ playlistName, onClose }: PlaylistFullExportModalProps) {
  const [rekordbox, setRekordbox] = useState(true);
  const [engine, setEngine] = useState(true);
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['playlistSync', 'exportPreview', playlistName],
    queryFn: () => api.playlistSync.previewExportPerformance(playlistName),
  });
  const previewFor = (target: PlaylistExportTarget) => (
    preview.data?.previews.find(p => p.target === target)
  );
  const mutation = useMutation({
    mutationFn: (targets: PlaylistExportTarget[]) => (
      api.playlistSync.exportPerformance(playlistName, targets)
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlistSync'] }),
  });
  const targets: PlaylistExportTarget[] = [
    ...(rekordbox ? ['rekordbox' as const] : []),
    ...(engine ? ['engine' as const] : []),
  ];

  return (
    <div className="playlist-export-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="playlist-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-export-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header>
          <div>
            <div className="playlist-export-kicker">FULL PLAYLIST EXPORT</div>
            <h2 id="playlist-export-title">{playlistName}</h2>
          </div>
          <button className="playlist-export-close" onClick={onClose} aria-label="Close">x</button>
        </header>

        <p className="playlist-export-warning">
          Replaces playlist order, hot cues, beatgrid, key, Main cue, tags, and energy for
          this playlist's tracks. Quit each selected destination before exporting.
        </p>

        <fieldset className="playlist-export-targets">
          <legend>Destinations</legend>
          <label>
            <input
              type="checkbox"
              value="rekordbox"
              checked={rekordbox}
              onChange={event => setRekordbox(event.target.checked)}
            />
            <span className="target-mark target-mark-rb" />
            <span className="target-info">
              Rekordbox
              <TargetPlan preview={previewFor('rekordbox')} loading={preview.isPending} />
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              value="engine"
              checked={engine}
              onChange={event => setEngine(event.target.checked)}
            />
            <span className="target-mark target-mark-engine" />
            <span className="target-info">
              Engine DJ
              <TargetPlan preview={previewFor('engine')} loading={preview.isPending} />
            </span>
          </label>
        </fieldset>

        {mutation.error && (
          <div className="playlist-export-error">{mutation.error.message}</div>
        )}

        {mutation.data && (
          <div className="playlist-export-report">
            {mutation.data.results.map(result => (
              <section key={result.target} className={`playlist-export-result result-${result.status}`}>
                <h3>
                  {result.target === 'rekordbox' ? 'Rekordbox' : 'Engine DJ'}: {' '}
                  {result.tracks_exported} exported, {result.tracks_failed} failed
                  {result.tracks_skipped > 0 && `, ${result.tracks_skipped} skipped`}
                </h3>
                {result.error && <p>{result.error}</p>}
                {result.tracks.filter(track => track.status !== 'exported').map(track => (
                  <details key={track.track_id} open={track.status === 'failed'}>
                    <summary>{track.title || `Track ${track.track_id}`} - {track.status}</summary>
                    {track.reason && <p>{track.reason}</p>}
                    <dl>
                      {Object.entries(track.fields).map(([field, status]) => (
                        <div key={field}><dt>{field}</dt><dd>{status}</dd></div>
                      ))}
                    </dl>
                  </details>
                ))}
              </section>
            ))}
          </div>
        )}

        <footer>
          <button className="playlist-export-cancel" onClick={onClose}>Close</button>
          <button
            className="playlist-export-submit"
            disabled={targets.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate(targets)}
          >
            {mutation.isPending ? 'Exporting...' : 'Export all data'}
          </button>
        </footer>
      </section>
    </div>
  );
}
