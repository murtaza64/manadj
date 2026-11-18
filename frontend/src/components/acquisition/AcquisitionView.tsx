// The Acquisition view (gh#342, "Dig" layout chosen via UI prototype) —
// now a wishlist (gh#487):
//
//   rail        ─ feeds, scopes (open = not yet in the library) (SoundCloud likes; Spotify Liked Songs +
//                 playlists, browse-only: "want" makes a Source Item), class toggles
//   sort/filter ─ one bar over whichever table is showing
//   table       ─ one row per Source Item at track-table density; the STATUS
//                 CELL is the whole lifecycle (find on Beatport ↗ / ignore →
//                 ≈ match ▾ → ✓ via). Rows never vanish on action: ordering is
//                 by liked date, filters are scopes.
//   drawer      ─ landed recently
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Classification, SourceItem } from '../../types';
import { useToast } from '../Toast';
import { SPOTIFY_FEEDS_KEY, SPOTIFY_STATUS_KEY, type SpotifyFeed, type SpotifyFeedRow, type SpotifyFeedStatus, spotifyApi, spotifyFeedsApi } from '../../setup/spotify/spotifyApi';
import { SOUNDCLOUD_STATUS_KEY, soundcloudApi } from '../../setup/soundcloud/soundcloudApi';
import { FulfilledPanel, MatchPanel } from './InlinePanels';
import { ITEMS_KEY, useInvalidateItems } from './useItems';
import { SpotifyFeedTable, SpotifyRow } from './SpotifyFeedTable';
import { spotifyItemFor, useSpotifyItemIndex, useWant } from './spotifyFeeds';
import { isFavoriteFeed, toggleFavoriteFeed, useFavoriteFeeds } from './favoriteFeeds';
import { OPEN_ACQUISITION_EVENT, takePendingAcquisition } from './openAcquisition';
import { StatusCell } from './StatusCell';
import { defaultPanel, type Panel } from './panels';
import { type Sortable, type SortKey, compareRows, matchesFilter, serverSort, sortGlyph, useSortFilter, useSortedFiltered } from './sortFilter';
import { formatDuration, landedRecently, likedLabel, statusRank } from './format';
import './AcquisitionView.css';

type Scope = 'open' | 'attention' | 'new' | 'library' | 'ignored' | 'all';

const SCOPES: Array<{ id: Scope; label: string; test: (i: SourceItem) => boolean }> = [
  { id: 'open', label: 'open', test: i => i.stage !== 'ignored' && i.stage !== 'fulfilled' },
  { id: 'attention', label: 'needs you', test: i => i.stage === 'new' && i.correspondence?.status === 'proposed' },
  { id: 'new', label: 'new', test: i => i.stage === 'new' },
  { id: 'library', label: 'in library', test: i => i.stage === 'fulfilled' },
  { id: 'ignored', label: 'ignored', test: i => i.stage === 'ignored' },
  { id: 'all', label: 'all', test: () => true },
];

/** Scope membership for a Spotify feed row that is not (yet) a Source Item. */
function feedRowInScope(scope: Scope, r: SpotifyFeedRow): boolean {
  switch (scope) {
    case 'open':
    case 'new':
      return r.library == null;
    case 'library':
      return r.library != null;
    case 'all':
      return true;
    default:
      return false;
  }
}

/** Categories of a Spotify feed page (server-side; counts come back with the page). */
const FEED_SCOPES: Array<{ id: SpotifyFeedStatus; label: string }> = [
  { id: 'open', label: 'open' },
  { id: 'wanted', label: 'wanted' },
  { id: 'library', label: 'in library' },
  { id: 'all', label: 'all' },
];

/** A row of the "all sources" table. */
type UnionRow = { kind: 'item'; item: SourceItem } | { kind: 'spotify'; row: SpotifyFeedRow };

const CLASSIFICATIONS: Classification[] = ['track', 'mix', 'clip', 'other'];
// Suspected mixes/clips are hidden by default; a Classification never
// auto-ignores anything (CONTEXT.md: Classification).
const DEFAULT_CLASS_FILTER: Record<Classification, boolean> = { track: true, mix: false, clip: false, other: true };


// feed ids: Source Item feeds are "items:<source>" ("items:*" = every
// Source); Spotify feeds are "spotify:<feed id>"
type FeedId = string;
const FEED_ALL: FeedId = 'items:*';
const FEED_SC: FeedId = 'items:soundcloud';
const FEED_SP_ITEMS: FeedId = 'items:spotify';

export function AcquisitionView() {
  const invalidate = useInvalidateItems();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>('open');
  const [feed, setFeed] = useState<FeedId>(FEED_ALL);
  const [classFilter, setClassFilter] = useState(DEFAULT_CLASS_FILTER);
  const [sel, setSel] = useState<Set<number>>(new Set());
  // inline panels: rows whose default panel the user closed, and rows opened on demand
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [opened, setOpened] = useState<Map<number, Panel>>(new Map());
  const [drawer, setDrawer] = useState(true);
  const { sort, toggleSort, filter, setFilter } = useSortFilter();
  // a task worklist deep link (gh#342): show that one item, whatever its stage
  useEffect(() => {
    const apply = () => {
      const p = takePendingAcquisition();
      if (!p) return;
      setFeed(FEED_ALL);
      setScope('all');
      setFilter(p.search);
      setClosed(new Set());
    };
    apply();
    window.addEventListener(OPEN_ACQUISITION_EVENT, apply);
    return () => window.removeEventListener(OPEN_ACQUISITION_EVENT, apply);
  }, [setFilter]);

  const { data: items, isLoading, error } = useQuery({
    queryKey: ITEMS_KEY,
    queryFn: api.acquisition.getItems,
  });
  const { data: soundcloudStatus } = useQuery({
    queryKey: SOUNDCLOUD_STATUS_KEY,
    queryFn: () => soundcloudApi.status(),
    staleTime: 5 * 60 * 1000,
  });
  const soundcloudAvailable = soundcloudStatus?.connected ?? false;

  // Spotify (#347): feeds appear once connected
  const { data: spotifyStatus } = useQuery({ queryKey: SPOTIFY_STATUS_KEY, queryFn: () => spotifyApi.status(), staleTime: 5 * 60 * 1000 });
  const spotifyConnected = spotifyStatus?.state === 'connected';
  const { data: spotifyFeeds, isError: spotifyFeedsError } = useQuery({
    queryKey: SPOTIFY_FEEDS_KEY,
    queryFn: () => spotifyFeedsApi.feeds(),
    enabled: spotifyConnected,
    staleTime: 120_000,
  });
  const [showAllPlaylists, setShowAllPlaylists] = useState(false);
  // Spotify feed category: open by default — detected library matches hidden
  const [feedStatus, setFeedStatus] = useState<SpotifyFeedStatus>('open');
  const [feedCounts, setFeedCounts] = useState<Record<SpotifyFeedStatus, number> | null>(null);
  const onFeedCounts = useCallback((c: Record<SpotifyFeedStatus, number>) => setFeedCounts(c), []);
  const spotifyFeed: SpotifyFeed | null = feed.startsWith('spotify:')
    ? (spotifyFeeds ?? []).find(f => f.id === feed.slice('spotify:'.length)) ?? null
    : null;

  // favorites: which feeds pour into "all sources" (SC likes by default)
  const favorites = useFavoriteFeeds();
  const favoriteSpotifyFeeds = useMemo(
    () => (spotifyFeeds ?? []).filter(f => f.readable && favorites.includes(`spotify:${f.id}`)),
    [spotifyFeeds, favorites],
  );
  const { key: srvKey, dir: srvDir } = serverSort(sort);
  const unionQueries = useQueries({
    queries:
      feed === FEED_ALL && spotifyConnected
        ? favoriteSpotifyFeeds.map(f => ({
            queryKey: ['spotifyFeed', f.id, srvKey, srvDir, filter.trim(), 'union'],
            queryFn: () => spotifyFeedsApi.page(f.id, 0, 500, srvKey, srvDir, filter.trim()),
            staleTime: 60_000,
          }))
        : [],
  });
  const unionLoading = unionQueries.some(q => q.isLoading);
  const unionRows = useMemo(() => unionQueries.flatMap(q => q.data?.rows ?? []), [unionQueries]);
  const bySpotify = useSpotifyItemIndex(items ?? []);
  const want = useWant(favoriteSpotifyFeeds.map(f => f.id));

  const refresh = useMutation({
    mutationFn: api.acquisition.refresh,
    onSuccess: r => {
      invalidate();
      toast(`refreshed likes: +${r.added} new · ${r.total_local} total`);
    },
    onError: e => toast((e as Error).message),
  });

  const all = useMemo(() => items ?? [], [items]);
  const feedItems = useMemo(() => {
    if (feed === FEED_ALL) return all.filter(i => i.source !== 'soundcloud' || favorites.includes(FEED_SC));
    if (feed.startsWith('items:')) return all.filter(i => i.source === feed.slice('items:'.length));
    return all;
  }, [all, feed, favorites]);
  const scopeDef = SCOPES.find(s => s.id === scope)!;
  const scoped = useMemo(
    () => feedItems.filter(i => scopeDef.test(i) && (i.classification === null || classFilter[i.classification])),
    [feedItems, scopeDef, classFilter],
  );
  const project = useCallback(
    (i: SourceItem): Sortable => ({ title: i.title, artist: i.uploader, durationMs: i.duration_ms, addedAt: i.liked_at, statusRank: statusRank(i) }),
    [],
  );
  const rows = useSortedFiltered(scoped, project, sort, filter);
  // "all sources": Source Items ∪ favorited Spotify feed rows that aren't Source Items yet
  const union: UnionRow[] = useMemo(() => {
    if (feed !== FEED_ALL) return rows.map(item => ({ kind: 'item', item }));
    const seen = new Set<string>();
    const extra: UnionRow[] = [];
    for (const r of unionRows) {
      if (seen.has(r.spotify_id) || spotifyItemFor(r, bySpotify) || !feedRowInScope(scope, r)) continue;
      seen.add(r.spotify_id);
      extra.push({ kind: 'spotify', row: r });
    }
    const proj = (u: UnionRow): Sortable =>
      u.kind === 'item'
        ? project(u.item)
        : { title: u.row.title, artist: u.row.artists.join(', '), durationMs: u.row.duration_ms, addedAt: u.row.added_at, statusRank: u.row.library ? 6 : 5 };
    return [...rows.map(item => ({ kind: 'item', item }) as UnionRow), ...extra.filter(u => matchesFilter(proj(u), filter))].sort((a, b) => compareRows(proj(a), proj(b), sort));
  }, [feed, rows, unionRows, bySpotify, scope, project, filter, sort]);
  const unionSpotifyCount = union.filter(u => u.kind === 'spotify').length;
  const counts = useMemo(() => {
    const feedRows = feed === FEED_ALL ? unionRows.filter(r => !spotifyItemFor(r, bySpotify)) : [];
    return Object.fromEntries(
      SCOPES.map(s => [
        s.id,
        feedItems.filter(i => s.test(i) && (i.classification === null || classFilter[i.classification])).length + feedRows.filter(r => feedRowInScope(s.id, r)).length,
      ]),
    ) as Record<Scope, number>;
  }, [feedItems, classFilter, feed, unionRows, bySpotify]);
  const sourceCount = (source: string) => all.filter(i => i.source === source).length;
  const landed = useMemo(
    () => all.filter(landedRecently).sort((a, b) => (b.provenance?.acquired_at ?? '').localeCompare(a.provenance?.acquired_at ?? '')).slice(0, 8),
    [all],
  );

  const panelFor = (i: SourceItem): Panel | null => {
    const d = defaultPanel(i);
    if (d) return closed.has(i.id) ? null : d;
    return opened.get(i.id) ?? null;
  };
  const togglePanel = (i: SourceItem, p: Panel) => {
    if (defaultPanel(i) === p) {
      setClosed(prev => {
        const n = new Set(prev);
        if (n.has(i.id)) n.delete(i.id);
        else n.add(i.id);
        return n;
      });
    } else {
      setOpened(prev => {
        const n = new Map(prev);
        if (n.get(i.id) === p) n.delete(i.id);
        else n.set(i.id, p);
        return n;
      });
    }
  };

  const selected = rows.filter(i => sel.has(i.id));
  const toggleSel = (id: number) =>
    setSel(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearSel = () => setSel(new Set());

  // batch verbs — each reports what it did and what it skipped
  const acceptBulk = useMutation({
    mutationFn: (ids: number[]) => api.acquisition.acceptMatchBulk(ids),
    onSuccess: r => {
      invalidate();
      clearSel();
      toast(`accepted ${r.done} matches${r.skipped ? ` · skipped ${r.skipped}` : ''}`);
    },
  });
  const ignoreBulk = useMutation({
    mutationFn: (ids: number[]) => api.acquisition.ignoreBulk(ids),
    onSuccess: r => {
      invalidate();
      clearSel();
      toast(`ignored ${r.done}${r.skipped ? ` · skipped ${r.skipped}` : ''}`);
    },
  });

  const selMatches = selected.filter(i => i.stage === 'new' && i.correspondence?.status === 'proposed');
  const selIgnorable = selected.filter(i => i.stage === 'new');

  const feedLabel =
    feed === FEED_ALL ? 'all sources' : feed === FEED_SC ? 'SoundCloud likes' : feed === FEED_SP_ITEMS ? 'wanted from Spotify' : spotifyFeed?.name ?? 'feed';

  // only playlists you own or collaborate on (Dev Mode returns nothing for
  // the rest); favorites first, then most recently added-to
  const playlists = (spotifyFeeds ?? [])
    .filter(f => f.kind === 'playlist' && f.readable)
    .sort(
      (a, b) =>
        Number(isFavoriteFeed(`spotify:${b.id}`)) - Number(isFavoriteFeed(`spotify:${a.id}`)) ||
        (b.last_added_at ?? '').localeCompare(a.last_added_at ?? '') ||
        a.name.localeCompare(b.name),
    );
  const visiblePlaylists = showAllPlaylists ? playlists : playlists.slice(0, 8);

  return (
    <div className="acq">
      <div className="acq-body">
        <div className="acq-rail">
          <div className="acq-rail-sub">feeds</div>
          <button className={`acq-feed${feed === FEED_ALL ? ' active' : ''}`} onClick={() => setFeed(FEED_ALL)}>
            all sources <span className="acq-feed-n">{all.length}</span>
          </button>
          <div className="acq-feedrow">
            <button className={`acq-feed${feed === FEED_SC ? ' active' : ''}`} onClick={() => setFeed(FEED_SC)}>
              <span className="acq-origin acq-origin-soundcloud">SC</span> likes <span className="acq-feed-n">{sourceCount('soundcloud')}</span>
            </button>
            <FavoriteStar id={FEED_SC} />
          </div>
          <button
            className="acq-feed-action"
            disabled={refresh.isPending || !soundcloudAvailable}
            onClick={() => refresh.mutate()}
            title={soundcloudAvailable ? 'fetch new likes' : 'connect SoundCloud in Settings → Accounts'}
          >
            {refresh.isPending ? 'refreshing…' : '↻ refresh'}
          </button>
          {spotifyConnected ? (
            <>
              {sourceCount('spotify') > 0 && (
                <button className={`acq-feed${feed === FEED_SP_ITEMS ? ' active' : ''}`} onClick={() => setFeed(FEED_SP_ITEMS)}>
                  <span className="acq-origin acq-origin-spotify">SP</span> wanted <span className="acq-feed-n">{sourceCount('spotify')}</span>
                </button>
              )}
              {(spotifyFeeds ?? [])
                .filter(f => f.kind === 'liked')
                .map(f => (
                  <div key={f.id} className="acq-feedrow">
                    <button className={`acq-feed${feed === `spotify:${f.id}` ? ' active' : ''}`} onClick={() => setFeed(`spotify:${f.id}`)}>
                      <span className="acq-origin acq-origin-spotify">SP</span> {f.name} <span className="acq-feed-n">{f.track_count}</span>
                    </button>
                    <FavoriteStar id={`spotify:${f.id}`} />
                  </div>
                ))}
              {playlists.length > 0 && <div className="acq-rail-sub">spotify playlists</div>}
              {visiblePlaylists.map(f => (
                <div key={f.id} className="acq-feedrow">
                  <button
                    className={`acq-feed${feed === `spotify:${f.id}` ? ' active' : ''}`}
                    onClick={() => setFeed(`spotify:${f.id}`)}
                    title={`${f.name}${f.last_added_at ? ` · last added ${likedLabel(f.last_added_at)}` : ''}`}
                  >
                    <span className="acq-feed-name">{f.name}</span> <span className="acq-feed-n">{f.track_count}</span>
                  </button>
                  <FavoriteStar id={`spotify:${f.id}`} />
                </div>
              ))}
              {playlists.length > 8 && (
                <button className="acq-feed-action" onClick={() => setShowAllPlaylists(!showAllPlaylists)}>
                  {showAllPlaylists ? 'fewer playlists' : `+${playlists.length - 8} more playlists`}
                </button>
              )}
              {(spotifyFeeds ?? []).some(f => f.kind === 'playlist' && !f.readable) && (
                <div className="acq-rail-hint">{(spotifyFeeds ?? []).filter(f => f.kind === 'playlist' && !f.readable).length} followed playlists hidden (Spotify only serves playlists you own)</div>
              )}
              {spotifyFeedsError && <div className="acq-inline-error">could not load Spotify feeds</div>}
            </>
          ) : (
            <div className="acq-rail-hint">
              <span className="acq-origin acq-origin-spotify">SP</span> Spotify: {spotifyStatus?.state === 'reconnect' ? 'reconnect in Settings → Accounts' : 'connect in Settings → Accounts to browse likes + playlists'}
            </div>
          )}

          {spotifyFeed && (
            <>
              <div className="acq-rail-sub">scope</div>
              {FEED_SCOPES.map(sc => (
                <button key={sc.id} className={`acq-feed${feedStatus === sc.id ? ' active' : ''}`} onClick={() => setFeedStatus(sc.id)}>
                  {sc.label} <span className="acq-feed-n">{feedCounts?.[sc.id] ?? ''}</span>
                </button>
              ))}
            </>
          )}
          {!spotifyFeed && (
            <>
              <div className="acq-rail-sub">scope</div>
              {SCOPES.map(s => (
                <button
                  key={s.id}
                  className={`acq-feed${scope === s.id ? ' active' : ''}${s.id === 'attention' && counts.attention > 0 ? ' hot' : ''}`}
                  onClick={() => setScope(s.id)}
                >
                  {s.label} <span className="acq-feed-n">{counts[s.id]}</span>
                </button>
              ))}
              <div className="acq-rail-sub">classification</div>
              {CLASSIFICATIONS.map(c => (
                <label key={c} className={`acq-classtoggle${classFilter[c] ? ' on' : ''}`}>
                  <input type="checkbox" checked={classFilter[c]} onChange={e => setClassFilter({ ...classFilter, [c]: e.target.checked })} />
                  <span className={`acq-class acq-class-${c}`}>{c}</span>
                  <span className="acq-feed-n">{feedItems.filter(i => i.classification === c).length}</span>
                </label>
              ))}
            </>
          )}
        </div>

        <div className="acq-main">
          <div className="acq-filterbar">
            <input
              className="acq-filter-input"
              placeholder={`filter ${feedLabel}…`}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setFilter('');
              }}
            />
            {filter && <button className="acq-cell-x" onClick={() => setFilter('')} title="clear filter">✕</button>}
            <span className="acq-sub">sort</span>
            {(['added', 'title', 'artist', 'length', 'status'] as SortKey[]).map(k => (
              <button key={k} className={`acq-sortbtn${sort.key === k ? ' active' : ''}`} onClick={() => toggleSort(k)}>
                {k}
                {sortGlyph(sort, k)}
              </button>
            ))}
          </div>

          {spotifyFeed ? (
            <SpotifyFeedTable
              key={spotifyFeed.id}
              feed={spotifyFeed}
              items={all}
              sort={sort}
              onSort={toggleSort}
              filter={filter}
              status={feedStatus}
              onCounts={onFeedCounts}
            />
          ) : (
            <>
              {selected.length > 0 ? (
                <div className="acq-seltool">
                  <b>{selected.length} selected</b>
                  <button className="btn btn-mini" disabled={selMatches.length === 0 || acceptBulk.isPending} onClick={() => acceptBulk.mutate(selMatches.map(i => i.id))}>
                    ✓ accept {selMatches.length} matches
                  </button>
                  <button className="btn btn-mini" disabled={selIgnorable.length === 0 || ignoreBulk.isPending} onClick={() => ignoreBulk.mutate(selIgnorable.map(i => i.id))}>
                    ignore {selIgnorable.length}
                  </button>
                  <span className="acq-spacer" />
                  <button className="btn btn-mini" onClick={clearSel}>clear</button>
                </div>
              ) : (
                <div className="acq-tabletool">
                  <span className="acq-sub">
                    {union.length}
                    {filter ? ' matching' : ''} in {scopeDef.label} · {feedLabel}
                    {feed === FEED_ALL && favoriteSpotifyFeeds.length > 0 && ` · ${unionLoading ? 'loading Spotify…' : `${unionSpotifyCount} from ${favoriteSpotifyFeeds.length} Spotify feed${favoriteSpotifyFeeds.length === 1 ? '' : 's'}`}`}
                  </span>
                  <span className="acq-spacer" />
                  {unionSpotifyCount > 0 && union.some(u => u.kind === 'spotify' && !u.row.library) && (
                    <button className="btn btn-mini" disabled={want.isPending} onClick={() => want.mutate(union.flatMap(u => (u.kind === 'spotify' && !u.row.library ? [{ id: u.row.spotify_id }] : [])))}>
                      + want all {union.filter(u => u.kind === 'spotify' && !u.row.library).length}
                    </button>
                  )}
                </div>
              )}

              {isLoading && <div className="acq-empty">Loading…</div>}
              {error != null && <div className="acq-inline-error acq-empty">{(error as Error).message}</div>}
              {!isLoading && !error && union.length === 0 && !unionLoading && (
                <div className="acq-empty">
                  {all.length === 0
                    ? soundcloudAvailable
                      ? 'no source items — hit ↻ refresh to fetch your likes'
                      : 'nothing here yet — connect SoundCloud or Spotify (Settings → Accounts)'
                    : filter
                      ? 'no rows match the filter'
                      : 'nothing in this scope'}
                </div>
              )}

              {union.length > 0 && (
                <table className="acq-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selected.length === rows.length}
                          ref={el => {
                            if (el) el.indeterminate = selected.length > 0 && selected.length < rows.length;
                          }}
                          onChange={() => (selected.length === rows.length ? clearSel() : setSel(new Set(rows.map(i => i.id))))}
                        />
                      </th>
                      <th />
                      <th className="acq-th-sort" onClick={() => toggleSort('title')}>title{sortGlyph(sort, 'title')}</th>
                      <th className="acq-th-sort" onClick={() => toggleSort('artist')}>{feed === FEED_ALL ? 'artist' : 'uploader'}{sortGlyph(sort, 'artist')}</th>
                      <th className="acq-th-sort" onClick={() => toggleSort('length')}>len{sortGlyph(sort, 'length')}</th>
                      <th />
                      <th className="acq-th-sort" onClick={() => toggleSort('status')}>status{sortGlyph(sort, 'status')}</th>
                      <th className="acq-th-sort" onClick={() => toggleSort('added')}>liked{sortGlyph(sort, 'added')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {union.map(u => {
                      if (u.kind === 'spotify') {
                        return (
                          <SpotifyRow
                            key={`sp-${u.row.spotify_id}`}
                            row={u.row}
                            item={null}
                            panel={null}
                            onToggle={() => {}}
                            onWant={() => want.mutate([{ id: u.row.spotify_id }])}
                            onWantAnyway={() => want.mutate([{ id: u.row.spotify_id, rejectTrackId: u.row.library?.track_id }])}
                            wantBusy={want.isPending}
                            leading
                            colSpan={8}
                          />
                        );
                      }
                      const i = u.item;
                      const panel = panelFor(i);
                      return (
                        <Fragment key={i.id}>
                          <tr className={`acq-tr acq-tr-${i.stage}${sel.has(i.id) ? ' selected' : ''}${panel ? ' open' : ''}`} data-item={i.id}>
                            <td>
                              <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggleSel(i.id)} />
                            </td>
                            <td>
                              <span className={`acq-origin acq-origin-${i.source}`} title={`${i.source} — open ↗`}>
                                <a href={i.permalink_url} target="_blank" rel="noreferrer">{i.source === 'spotify' ? 'SP' : 'SC'}</a>
                              </span>
                            </td>
                            <td className="acq-td-title" title={i.title}>{i.title}</td>
                            <td className="acq-sub acq-td-sub" title={i.uploader}>{i.uploader}</td>
                            <td className="acq-sub">{formatDuration(i.duration_ms)}</td>
                            <td>
                              <ClassChip item={i} />
                            </td>
                            <td className="acq-td-status">
                              <StatusCell item={i} panel={panel} onToggle={p => togglePanel(i, p)} />
                            </td>
                            <td className="acq-sub">{likedLabel(i.liked_at)}</td>
                          </tr>
                          {panel && (
                            <tr className={`acq-tr-inline acq-tr-${i.stage}`}>
                              <td colSpan={8}>
                                {panel === 'match' && <MatchPanel key={i.id} item={i} />}
                                {panel === 'fulfilled' && <FulfilledPanel key={i.id} item={i} />}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className={`acq-drawer${drawer ? '' : ' closed'}`}>
          <button className="acq-drawer-toggle" onClick={() => setDrawer(!drawer)}>
            {drawer ? '▸' : '◂'} landed {landed.length}
          </button>
          {drawer && (
            <div className="acq-drawer-body">
              <div className="acq-drawer-sec">
                <div className="acq-drawer-head">landed recently</div>
                {landed.map(i => (
                  <div key={i.id} className="acq-drawer-row">
                    <span className="acq-drawer-title" title={i.title}>{i.title}</span>
                    <span className="acq-sub">via {i.provenance?.label}</span>
                  </div>
                ))}
                {landed.length === 0 && <div className="acq-sub">—</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** ★ = this feed pours into "all sources". */
function FavoriteStar({ id }: { id: string }) {
  const favorites = useFavoriteFeeds();
  const on = favorites.includes(id);
  return (
    <button
      className={`acq-star${on ? ' on' : ''}`}
      onClick={() => toggleFavoriteFeed(id)}
      title={on ? 'in "all sources" — click to remove' : 'add to "all sources"'}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

function ClassChip({ item }: { item: SourceItem }) {
  const invalidate = useInvalidateItems();
  const mutation = useMutation({
    mutationFn: (c: Classification) => api.acquisition.setClassification(item.id, c),
    onSuccess: invalidate,
  });
  const current = item.classification ?? 'track';
  const next = CLASSIFICATIONS[(CLASSIFICATIONS.indexOf(current) + 1) % CLASSIFICATIONS.length];
  return (
    <button
      className={`acq-class acq-class-${item.classification ?? 'none'}`}
      title={`classification: ${item.classification ?? '?'} — click → ${next}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate(next)}
    >
      {item.classification ?? '?'}
    </button>
  );
}