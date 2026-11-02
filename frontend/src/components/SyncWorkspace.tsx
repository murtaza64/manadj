import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { FieldName, FieldScope } from '../api/fieldReview';
import type { Track, Playlist, PlaylistWithTracks } from '../types';
import { setSyncWorkspaceBusy, type WorkspaceEnvelope } from '../sync/openWorkspace';
import { useExportEnabled } from '../settings/useAppConfig';
import { FieldReviewInspector, type FieldScopes, type ReviewObservation } from './FieldReviewInspector';
import { PlaylistExportInspector } from './PlaylistExportInspector';
import TrackRow from './TrackRow';
import { COLUMN_CONFIG } from './columnConfig';
import './SyncWorkspace.css';

const DEFAULT_FIELDS: FieldName[] = ['key', 'hotcues', 'maincue'];
const COLUMNS = ['title', 'artist', 'key', 'bpm', 'energy'].map(id => ({ ...COLUMN_CONFIG.find(column => column.id === id)!, sticky: false, showShadow: false }));
const validTracks = (value: unknown): value is Track[] => Array.isArray(value) && value.every(track => Number.isSafeInteger(track?.id) && track.id > 0 && typeof track.filename === 'string' && Array.isArray(track.tags));

export function SyncWorkspace({ request, onPendingChange }: { request: WorkspaceEnvelope | null; onPendingChange: (pending: boolean) => void }) {
  const capture = request?.kind === 'fields' ? request : null;
  const [kind, setKind] = useState<'fields' | 'playlist'>(request?.kind || 'fields');
  const [surface, setSurface] = useState<'engine' | 'rekordbox'>(capture?.surface || 'engine');
  const [direction, setDirection] = useState<'import' | 'export'>(capture?.direction || 'export');
  const [scope, setScope] = useState<FieldScope | 'captured'>(capture ? 'captured' : 'filtered');
  const [fields, setFields] = useState<FieldName[]>(capture?.fields ?? DEFAULT_FIELDS);
  const [playlistName, setPlaylistName] = useState(request?.kind === 'playlist' ? request.playlistName : '');
  const [playlistScope, setPlaylistScope] = useState<'full' | 'order'>('full');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(capture?.trackIds || []));
  const [focused, setFocused] = useState<number | null>(capture?.trackIds[0] ?? null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const table = useRef<HTMLDivElement>(null);
  const [observation, setObservation] = useState<ReviewObservation>('not checked');
  const enabled = useExportEnabled();
  const library = useQuery<{ items: Track[]; total: number }>({ queryKey: ['tracks', 'sync-workspace'], queryFn: async () => {
    const data = await api.tracks.list(1, 10000);
    if (!validTracks(data?.items) || !Number.isSafeInteger(data.total) || data.total < data.items.length
      || new Set(data.items.map((track: Track) => track.id)).size !== data.items.length) throw new Error('Incomplete Library scope response');
    return data;
  } });
  const playlists = useQuery<Playlist[]>({ queryKey: ['playlists'], queryFn: async () => {
    const data = await api.playlists.list();
    if (!Array.isArray(data) || data.some((item: Playlist) => !Number.isSafeInteger(item?.id) || typeof item.name !== 'string')) throw new Error('Incomplete playlist response');
    return data;
  } });
  const matches = playlists.data?.filter(playlist => playlist.name === playlistName) || [];
  const playlist = useQuery<PlaylistWithTracks>({ queryKey: ['playlist', 'sync-workspace', matches[0]?.id], queryFn: async () => {
    const data = await api.playlists.get(matches[0].id);
    if (data?.id !== matches[0].id || data.name !== playlistName || !validTracks(data.tracks)) throw new Error('Incomplete playlist tracks response');
    return data;
  }, enabled: kind === 'playlist' && matches.length === 1 });
  const items: Track[] = useMemo(() => library.data?.items || [], [library.data?.items]);
  const complete = typeof library.data?.total === 'number' && library.data.total <= items.length;
  const filtered = useMemo(() => items.filter(track => `${track.title || ''} ${track.artist || ''} ${track.filename}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [items, search]);
  const rows = kind === 'playlist' ? playlist.data?.tracks || [] : filtered;
  const shown = rows.slice(0, 1000);
  const focusedShown = shown.some(track => track.id === focused);
  const pending = useCallback((value: boolean) => {
    busyRef.current = value; setSyncWorkspaceBusy(value); setBusy(value); onPendingChange(value);
  }, [onPendingChange]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('beforeunload', unload); setSyncWorkspaceBusy(false); };
  }, []);
  function change(action: () => void) {
    if (busyRef.current) return;
    setObservation('not checked'); setOpen(true); setGeneration(value => value + 1); action();
  }
  function choose(track: Track, toggle = false) {
    change(() => {
      setFocused(track.id); setScope('selected');
      setSelected(previous => { const next = toggle ? new Set(previous) : new Set<number>(); if (toggle && next.has(track.id)) next.delete(track.id); else next.add(track.id); return next; });
    });
  }
  function rowKey(event: KeyboardEvent<HTMLTableRowElement>, track: Track) {
    if (busyRef.current) return;
    const index = shown.findIndex(row => row.id === track.id);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      if (shown[next]) { choose(shown[next]); const row = table.current?.querySelector<HTMLElement>(`[data-track-id="${shown[next].id}"]`); row?.focus(); row?.scrollIntoView?.({ block: 'nearest' }); }
    } else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choose(track, event.key === ' '); }
  }
  const ids = scope === 'captured' ? capture?.trackIds || [] : scope === 'selected' ? [...selected] : (scope === 'filtered' ? filtered : items).map(track => track.id);
  const normalizedScope = scope === 'captured' ? capture?.scope || 'selected' : scope;
  const scopes: FieldScopes = { [normalizedScope]: async () => {
    if ((scope === 'all' || scope === 'filtered') && !complete) throw new Error('Library scope is incomplete (maximum10000). Capture an exact selection instead.');
    return [...ids];
  } };
  // Only explicit context transitions replace the operation owner. Live query
  // results may invalidate a plan, never unmount its pending request/receipt.
  const contextKey = JSON.stringify([request?.sequence, generation, kind, surface, direction, normalizedScope, playlistName, playlistScope]);
  const clear = () => { if (!busyRef.current) { setOpen(false); setObservation('not checked'); setGeneration(value => value + 1); } };

  return <section className="sync-workspace" aria-label="Sync workspace">
    <aside className="sw-rail" aria-label="Destination and scope">
      <h2>Sync workspace</h2><p className="sw-muted">Library ↔ desktop libraries</p>
      <fieldset disabled={busy}><legend>Library surface</legend>
        <button className={`btn ${surface === 'engine' ? 'btn-selected' : ''}`} aria-pressed={surface === 'engine'} onClick={() => change(() => setSurface('engine'))}>Engine DJ</button>
        <button className={`btn ${surface === 'rekordbox' ? 'btn-selected' : ''}`} aria-pressed={surface === 'rekordbox'} onClick={() => change(() => setSurface('rekordbox'))}>Rekordbox desktop</button>
        <button className="btn" disabled aria-describedby="sw-usb-limit">USB · unavailable</button>
      </fieldset>
      <p id="sw-usb-limit" className="sw-muted">USB export is not wired here. Desktop library writes do not update a USB; its existing pipeline stays separate.</p>
      <div className="sw-readiness" role="status"><b>Readiness: {observation}</b><small>{enabled ? 'External export enabled' : 'External export off · imports remain available'}</small><small>Plan/writer evidence, not native app or player verification.</small></div>
      <fieldset disabled={busy}><legend>Operation</legend>
        <label>Review <select aria-label="Review operation" value={kind} onChange={event => change(() => { setKind(event.target.value as typeof kind); setDirection('export'); })}><option value="fields">Track fields</option><option value="playlist">Playlist export</option></select></label>
        <label>Direction <select aria-label="Sync direction" value={kind === 'playlist' ? 'export' : direction} disabled={kind === 'playlist'} onChange={event => change(() => setDirection(event.target.value as typeof direction))}><option value="export">Library → {surface === 'engine' ? 'Engine DJ' : 'Rekordbox'}</option><option value="import">{surface === 'engine' ? 'Engine DJ' : 'Rekordbox'} → Library</option></select></label>
        {kind === 'fields' ? <label>Scope <select aria-label="Review scope" value={scope} onChange={event => change(() => setScope(event.target.value as typeof scope))}>{capture && <option value="captured">Captured {capture.scope} · {capture.trackIds.length} tracks</option>}<option value="selected">Selected · {selected.size}</option><option value="filtered">Filtered · {filtered.length}</option><option value="all">All active Library · {library.data?.total ?? '…'}</option></select></label> : <>
          <label>Playlist <select aria-label="Library playlist" value={playlistName} onChange={event => change(() => setPlaylistName(event.target.value))}><option value="">Choose playlist…</option>{(playlists.data || []).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label>Scope <select aria-label="Playlist export scope" value={playlistScope} onChange={event => change(() => setPlaylistScope(event.target.value as typeof playlistScope))}><option value="full">Playlist + track data</option><option value="order">Membership / order only</option></select></label>
        </>}
      </fieldset>
      {capture && <p className="sw-captured">Captured from: {capture.label}. Exact IDs: {capture.trackIds.join(', ')}.</p>}
      <button className="btn" disabled={busy} onClick={() => change(() => { setOpen(true); setGeneration(value => value + 1); })}>Review this scope</button>
      <p className="sw-muted">Phone and peer exchange stay in Settings; this workspace does not replace their setup.</p>
      <a href={'?view=settings&section=phone-sync'} aria-disabled={busy} onClick={event => { if (busyRef.current) event.preventDefault(); }}>Phone sync settings</a>
    </aside>
    <section className="sw-tracks" aria-label="Scoped Library tracks">
      <header><h2>{kind === 'playlist' ? playlistName || 'Choose a Library playlist' : 'Library tracks'}</h2><span>{kind === 'fields' ? `${selected.size} selected · ${filtered.length} filtered` : `${rows.length} entries`}</span></header>
      {kind === 'fields' && <label className="sw-search">Filter tracks <input aria-label="Filter workspace tracks" type="search" value={search} disabled={busy} onChange={event => change(() => setSearch(event.target.value))} /></label>}
      {(library.isLoading || (kind === 'playlist' && playlist.isFetching)) && <p>Reading Library tracks…</p>}
      {(library.error || playlists.error || playlist.error) && <p role="alert">Library data unavailable; no scope is inferred.</p>}
      {!complete && !library.isLoading && <p className="sw-warning">The returned Library list is incomplete. Filtered/all review is blocked; exact selected/captured IDs remain explicit.</p>}
      {rows.length > shown.length && <p>Showing first1000 rows; complete filtered/all scope still includes {rows.length} tracks. Filter to inspect another row.</p>}
      <p className="sw-muted">Click inspects one track; Ctrl/Cmd-click or Space toggles selection. Arrow keys move through rows. No playback or curation sidebar.</p>
      <div className="sw-table-scroll" ref={table}>
        <table className="sw-track-table" aria-label="Workspace Library tracks"><thead><tr>{COLUMNS.map(column => <th key={column.id}>{column.id}</th>)}</tr></thead><tbody>
          {shown.map((track, index) => <TrackRow key={`${track.id}:${index}`} track={track} columns={COLUMNS} isSelected={selected.has(track.id)} loadedOn="none" getDragIds={() => []} onSelect={(item, mods) => choose(item, mods.toggle)} onLoad={item => choose(item)} rowId={`sw-track-${track.id}`} rowTabIndex={busy ? -1 : (focused === track.id || !focusedShown && index === 0) ? 0 : -1} onRowKeyDown={event => rowKey(event, track)} />)}
        </tbody></table>
        {!rows.length && !library.isLoading && <p>No tracks in this view. No empty scope becomes the whole Library.</p>}
      </div>
    </section>
    <div className="sw-detail" aria-label="Review and receipt">
      {busy && <p className="sw-warning" role="status">Operation pending. Scope/navigation controls are locked until its receipt arrives.</p>}
      {!open ? <p>Review cleared. Choose a scope and select “Review this scope”.</p> : kind === 'fields' ? <FieldReviewInspector key={contextKey} embedded scopes={scopes} scopeRevision={JSON.stringify(ids)} initialScope={normalizedScope} initialFields={fields} initialSurface={surface} initialDirection={direction} onFieldsChange={setFields} onPendingChange={pending} onObservationChange={setObservation} onClose={clear} />
        : !playlistName ? <p>Choose a Library playlist. This export can add missing records; field-only review cannot.</p>
          : <PlaylistExportInspector key={contextKey} embedded playlistName={playlistName} initialTarget={surface} initialScope={playlistScope} onPendingChange={pending} onObservationChange={setObservation} onClose={clear} />}
    </div>
  </section>;
}
