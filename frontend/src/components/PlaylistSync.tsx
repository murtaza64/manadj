import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { PlaylistSyncHeader } from './PlaylistSyncHeader';
import { PlaylistSyncTable } from './PlaylistSyncTable';
import { requestLibraryPlaylist } from '../library/openPlaylist';
import type { UnifiedPlaylist } from '../types';
import './PlaylistSync.css';

export function PlaylistSync() {
  const [externalPlaylist, setExternalPlaylist] = useState<UnifiedPlaylist | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const navigationBusy = useRef(false);
  const client = useQueryClient();
  async function openLibrary(name: string) {
    const matches = (await api.playlists.list()).filter((p: { name: string }) => p.name === name);
    if (matches.length !== 1) throw new Error('Library playlist is missing or its name is ambiguous. Resolve the Library name before opening export.');
    requestLibraryPlaylist({ id: matches[0].id, name, openExport: true });
  }
  const importOrder = useMutation({
    mutationFn: async ({ name, source }: { name: string; source: 'engine' | 'rekordbox' }) => {
      if ((await api.playlists.list()).some((p: { name: string }) => p.name === name)) throw new Error('A Library playlist with this name now exists. Refresh and open it in Library; no import started.');
      return api.playlistSync.sync(name, { source, target: 'manadj', ignore_missing_tracks: false, dry_run: false });
    },
    onSuccess: async (_result, request) => {
      await client.invalidateQueries({ queryKey: ['playlistSync'] });
      await client.invalidateQueries({ queryKey: ['playlists'] });
      setExternalPlaylist(null);
      try { await openLibrary(request.name); } catch (error) { setNotice(`Order imported, but Library navigation failed: ${error instanceof Error ? error.message : String(error)}`); }
    },
    onError: (error: Error) => setNotice(error.message),
  });
  async function choose(name: string) {
    if (navigationBusy.current || importOrder.isPending) return;
    const playlist = playlists?.find(p => p.name === name);
    if (!playlist) return;
    setNotice(null);
    if (playlist.manadj === null) { setExternalPlaylist(playlist); return; }
    navigationBusy.current = true;
    setOpening(true);
    try { await openLibrary(name); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { navigationBusy.current = false; setOpening(false); }
  }
  const { data: playlists, isLoading, error } = useQuery({
    queryKey: ['playlistSync'],
    queryFn: api.playlistSync.getUnified,
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const { data: stats } = useQuery({
    queryKey: ['playlistSyncStats'],
    queryFn: api.playlistSync.getStats,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-stats-bar">
          <PlaylistSyncHeader stats={undefined} />
        </div>
        <div className="playlist-sync-table-container">
          <div className="playlist-sync-loading">Loading playlist sync data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-error">
          Error loading playlists: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!playlists) {
    return (
      <div className="playlist-sync-content">
        <div className="playlist-sync-loading">No playlist data available</div>
      </div>
    );
  }

  return (
    <div className="playlist-sync-content">
      <div className="playlist-sync-stats-bar">
        <PlaylistSyncHeader stats={stats} />
      </div>
      <p className="playlist-library-routing">Open a playlist in Library to review/export it. The old three-column playlist detail is superseded.</p>
      {opening && <p role="status">Opening playlist in Library…</p>}
      {notice && <p role="alert">{notice}</p>}
      {externalPlaylist && <section className="playlist-external-import">
        <h3>{externalPlaylist.name} · not in Library</h3><p>Import playlist membership/order into Library first. This does not import performance data or copy audio. Unmatched tracks stop this existing import operation.</p>
        {(['engine', 'rekordbox'] as const).filter(source => externalPlaylist[source] !== null).map(source => <button className="btn" disabled={importOrder.isPending} key={source} onClick={() => importOrder.mutate({ name: externalPlaylist.name, source })}>Import {externalPlaylist[source]?.length} entries from {source === 'engine' ? 'Engine DJ' : 'Rekordbox'} → Library</button>)}
        <button className="btn btn-secondary" disabled={importOrder.isPending} onClick={() => setExternalPlaylist(null)}>Dismiss</button>
        {importOrder.isPending && <p role="status">Importing playlist membership/order into Library…</p>}
      </section>}
      <PlaylistSyncTable
        playlists={playlists}
        onPlaylistClick={name => void choose(name)}
      />
    </div>
  );
}
