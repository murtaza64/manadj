import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, BACKEND_URL } from '../api/client';
import { useFitColumns } from './FitColumnHeaders';
import { ConstructionNotice } from './ConstructionNotice';
import { FieldReviewInspector } from './FieldReviewInspector';
import { supportedFields } from '../api/fieldReview';
import type { PlaylistCoverage } from '../types';
import './DesktopSourceBrowser.css';

type Source = 'engine' | 'rekordbox';
export type SourceTrack = { id: string; path: string | null; title: string | null; artist: string | null; bpm: number | null; key: number | null; library_track_id: number | null; library_title: string | null; match: 'same-path' | 'ambiguous-path' | 'not-in-library' };
export type SourceInventory = { source: Source; status: 'read' | 'not_configured' | 'failed'; reason: string | null; read_at: string; tracks: SourceTrack[]; match_basis: string };
const norm = (path: string) => path.replaceAll('\\', '/');
const short = (text: string) => text.length > 66 ? `${text.slice(0, 63)}…` : text;
const IDS = ['selected', 'title', 'artist', 'state', 'diff'];
const SHARES = [6, 33, 22, 23, 16];

export function DesktopSourceBrowser({ source, onPendingChange }: { source: Source; onPendingChange?: (pending: boolean) => void }) {
  const label = source === 'engine' ? 'Engine DJ' : 'Rekordbox';
  const fit = useFitColumns(IDS, SHARES);
  const [playlist, setPlaylist] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<number[]>([]);
  const [direction, setDirection] = useState<'import' | 'export'>('import');
  const [busy, setBusy] = useState(false);
  useEffect(() => { onPendingChange?.(busy); }, [busy, onPendingChange]);
  const [search, setSearch] = useState('');
  const inventory = useQuery<SourceInventory>({ queryKey: ['sync-source-inventory', source], queryFn: async () => {
    const res = await fetch(`${BACKEND_URL}/api/sync/sources/${source}/tracks`);
    if (!res.ok) throw new Error('Desktop library inventory unavailable');
    const value = await res.json();
    if (value.source !== source || !['read', 'not_configured', 'failed'].includes(value.status) || !Array.isArray(value.tracks) || value.tracks.some((row: SourceTrack) => typeof row.id !== 'string' || !['same-path','ambiguous-path','not-in-library'].includes(row.match) || row.library_track_id !== null && (!Number.isSafeInteger(row.library_track_id) || row.library_track_id <= 0)) || new Set(value.tracks.map((row: SourceTrack) => row.id)).size !== value.tracks.length) throw new Error('Incomplete desktop inventory');
    return value;
  } });
  const coverage = useQuery<PlaylistCoverage>({ queryKey: ['playlist-coverage'], queryFn: api.playlistSync.getCoverage });
  useEffect(() => { if (!busy) { setSelected(new Set()); setReviewIds([]); } }, [playlist, search, source]);
  useEffect(() => { if (!busy) setSelected(new Set()); }, [inventory.data]);
  const lists = coverage.data?.playlists.filter(item => item.entries[source].length > 0) ?? [];
  const picked = lists.find(item => JSON.stringify(item.path) === playlist);
  const paths = picked?.entries[source].length === 1 ? new Set(picked.entries[source][0].tracks.map(track => norm(track.filename))) : null;
  const rows = useMemo(() => (inventory.data?.tracks ?? []).filter(track => (!playlist || paths?.has(norm(track.path ?? ''))) && `${track.title ?? ''} ${track.artist ?? ''} ${track.path ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [inventory.data, playlist, paths, search]);
  const selectedRows = rows.filter(track => selected.has(track.id));
  const matched = selectedRows.filter(track => track.match === 'same-path' && track.library_track_id !== null);
  const exactIds = [...new Set(matched.map(track => track.library_track_id!))];
  const excluded = selectedRows.length - matched.length;
  const toggleExpand = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const review = (ids: number[], value: 'import' | 'export') => { setDirection(value); setReviewIds(ids); };
  const state = inventory.data?.status;
  const sourceReady = state === 'read';
  return <div className="pg-browser ds-browser" aria-label={`${label} desktop`}>
    <header className="pg-bar"><b>{label} desktop</b><span className="pg-chip">This computer · not USB</span><span className="pg-read">{inventory.isFetching ? 'Reading…' : sourceReady ? `${inventory.data!.tracks.length} source tracks` : 'Not read'}</span><button className="btn" disabled={busy || inventory.isFetching} onClick={() => { setReviewIds([]); void inventory.refetch(); void coverage.refetch(); }}>Recheck</button></header>
    <aside className="pg-left" aria-label={`${label} playlists`}><button className={`pg-pl${playlist === null ? ' on' : ''}`} disabled={busy} onClick={() => setPlaylist(null)}>All tracks <span className="pg-n">{sourceReady ? inventory.data!.tracks.length : ''}</span></button>
      {coverage.isError && <p className="pg-empty">Playlist list unavailable. All tracks is independent.</p>}
      {lists.map(item => <button className={`pg-pl${playlist === JSON.stringify(item.path) ? ' on' : ''}`} key={JSON.stringify(item.path)} disabled={busy} onClick={() => setPlaylist(JSON.stringify(item.path))}><span className="pg-plname">{item.name}</span><span className="pg-n">{item.entries[source].length === 1 ? item.entries[source][0].tracks.length : 'ambiguous'}</span></button>)}
    </aside>
    <main className="pg-main"><div className="pg-title"><b>{picked?.name ?? 'All tracks'}</b><span>{rows.length} tracks</span><input className="ds-search" aria-label={`Filter ${label} tracks`} placeholder="Filter this view…" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></div>
      {inventory.isLoading && <p className="pg-empty" role="status">Reading {label} desktop…</p>}
      {(inventory.isError || state === 'failed') && <p className="pg-empty" role="alert">Could not read {label} desktop. Nothing is inferred about missing tracks.{inventory.data?.reason ? ` (${inventory.data.reason})` : ''}</p>}
      {state === 'not_configured' && <p className="pg-empty">{label} desktop is not configured. Choose its library folder in Settings. This is separate from USB discovery.</p>}
      {picked && picked.entries[source].length !== 1 && <p className="pg-empty" role="alert">More than one source playlist has this name. No scope is inferred.</p>}
      {selectedRows.length > 0 && <div className="pg-selection-bar"><b>{selectedRows.length} selected</b><span>{matched.length} same-path matches · {excluded} excluded</span><button className="btn" disabled={busy || !exactIds.length} onClick={() => review(exactIds, 'import')}>Review {label} → Library fields</button><button className="btn" disabled={busy || !exactIds.length} onClick={() => review(exactIds, 'export')}>Review Library → {label} fields</button></div>}
      {sourceReady && <><table className="pg-tracks" ref={fit.tableRef} style={fit.variables}><thead>{fit.headers(['', 'Title', 'Artist', 'Library match', 'Differences'])}</thead><tbody>{rows.map(track => <TrackEntry key={track.id} track={track} sourceLabel={label} expanded={expanded.has(track.id)} selected={selected.has(track.id)} busy={busy} toggleExpand={() => toggleExpand(track.id)} toggleSelected={() => { setReviewIds([]); setSelected(previous => { const next = new Set(previous); if (next.has(track.id)) next.delete(track.id); else next.add(track.id); return next; }); }} review={() => review([track.library_track_id!], 'import')} />)}</tbody></table>{rows.length === 0 && <p className="pg-empty">No source tracks in this view.</p>}</>}
    </main>
    <aside className="pg-right ds-plan" aria-label={`${label} field review`}>
      {reviewIds.length > 0 ? <FieldReviewInspector key={`${source}:${direction}:${reviewIds.join(',')}`} embedded scopes={{ selected: async () => reviewIds }} scopeRevision={JSON.stringify([source, playlist, search, reviewIds, inventory.dataUpdatedAt, selectedRows.map(row => row.id)])} initialScope="selected" initialSurface={source} initialDirection={direction} initialFields={supportedFields(source, direction).filter(field => ['title', 'artist', 'key'].includes(field))} onPendingChange={setBusy} onClose={() => setReviewIds([])} /> : <><h3>Plan</h3><span className="pg-tag">Nothing chosen</span><ConstructionNotice label="More operations" detail="The existing field review is wired for exact selected Library IDs. Combining audio imports, cross-copy links and playlist membership changes into one shared plan is under construction. No operation is selected here by default." /></>}
    </aside>
  </div>;
}

function TrackEntry({ track, sourceLabel, expanded, selected, busy, toggleExpand, toggleSelected, review }: { track: SourceTrack; sourceLabel: string; expanded: boolean; selected: boolean; busy: boolean; toggleExpand: () => void; toggleSelected: () => void; review: () => void }) {
  const titleDiffers = track.library_track_id !== null && track.title !== track.library_title;
  return <><tr className={selected ? 'ds-selected' : ''} onClick={event => { if (!(event.target as HTMLElement).closest('button,input,a,summary')) toggleExpand(); }}><td><input type="checkbox" aria-label={`Select ${track.title ?? track.path}`} checked={selected} disabled={busy} onChange={toggleSelected} /></td><td><button className="ds-row-open" aria-expanded={expanded} disabled={busy} onClick={toggleExpand} title={track.title ?? track.path ?? ''}>{expanded ? '▾' : '▸'} {short(track.title ?? track.path ?? 'Untitled')}</button></td><td>{track.artist}</td><td><span className="pg-tag tone-unknown">{track.match === 'same-path' ? 'Same path' : track.match === 'ambiguous-path' ? 'Ambiguous path' : 'No path match'}</span></td><td>{titleDiffers ? <button className="pg-diff-toggle" aria-expanded={expanded} onClick={toggleExpand}>Title ▾</button> : 'Not reviewed'}</td></tr>
    {expanded && <tr className="pg-context"><td /><td colSpan={4}><b>{track.title ?? 'Untitled'}</b><details className="pg-exact"><summary>Path</summary><span>{sourceLabel}: {track.path ?? 'Path unavailable'}</span></details>{track.library_track_id !== null ? <><p>Library title: {track.library_title ?? 'empty'}</p><span className="pg-tag tone-unknown">Path only · audio unverified</span><button className="btn" disabled={busy} onClick={review}>Review fields</button></> : <ConstructionNotice label="Import or link this source track" detail="No unique Library path match. Per-track desktop audio import and alternate-copy linking are not wired in this row flow; nothing will be imported automatically." />}</td></tr>}
  </>;
}
