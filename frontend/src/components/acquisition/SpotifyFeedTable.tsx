// A Spotify feed (Liked Songs or a playlist) as an acquisition table (#347 /
// gh#342). Spotify is browse-only: a row is either already in the library,
// already a Source Item (live status cell), or wantable — "want" creates a
// Source Item and the normal Soulseek chain takes over. Sort, filter and
// paging run server-side over the whole cached feed, so "latest" means the
// latest of all 3k rows, not of the first page.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { SpotifyFeed, SpotifyFeedRow, SpotifyFeedStatus } from '../../setup/spotify/spotifyApi';
import type { SourceItem } from '../../types';
import { FEED_PAGE, spotifyItemFor, useSpotifyFeedPages, useSpotifyItemIndex, useWant } from './spotifyFeeds';
import { StatusCell } from './StatusCell';
import type { Panel } from './panels';
import { FulfilledPanel, MatchPanel, SoulseekPanel } from './InlinePanels';
import { formatDuration, likedLabel } from './format';
import { type SortState, sortGlyph, type SortKey } from './sortFilter';

/** One Spotify feed row (+ its inline panel) — shared with the union view. */
export function SpotifyRow({
  row: r,
  item: it,
  panel,
  onToggle,
  soulseekAvailable,
  onWant,
  onWantAnyway,
  wantBusy,
  leading,
  colSpan,
}: {
  row: SpotifyFeedRow;
  item: SourceItem | null;
  panel: Panel | null;
  onToggle: (p: Panel) => void;
  soulseekAvailable: boolean;
  onWant: () => void;
  /** "that match is wrong": want with the library match rejected */
  onWantAnyway: () => void;
  wantBusy: boolean;
  /** extra leading cell (the union table has a checkbox column) */
  leading?: boolean;
  colSpan: number;
}) {
  return (
    <Fragment>
      <tr className={`acq-tr acq-tr-${it ? it.stage : r.library ? 'fulfilled' : 'feed'}${panel ? ' open' : ''}`}>
        {leading && <td />}
        <td>
          <span className="acq-origin acq-origin-spotify" title="Spotify — open ↗">
            <a href={r.url} target="_blank" rel="noreferrer">SP</a>
          </span>
        </td>
        <td className="acq-td-title" title={r.title}>{r.title}</td>
        <td className="acq-sub acq-td-sub" title={`${r.artists.join(', ')}${r.album ? ` · ${r.album}` : ''}`}>
          {r.artists.join(', ')}
        </td>
        <td className="acq-sub">{formatDuration(r.duration_ms)}</td>
        <td />
        <td className="acq-td-status">
          {it ? (
            <StatusCell item={it} panel={panel} onToggle={onToggle} soulseekAvailable={soulseekAvailable} />
          ) : r.library ? (
            <>
              <span
                className="acq-cell-done"
                title={`${r.library.artist ?? ''} - ${r.library.title ?? ''}${r.library.score != null ? ` · ${Math.round(r.library.score * 100)}%` : ''}`}
              >
                ✓ in library{r.library.confidence === 'probable' ? ' (probable)' : ''}
              </span>
              <span className="acq-sub acq-cell-matchname" title={`${r.library.artist ?? ''} - ${r.library.title ?? ''}`}>
                ≈ {r.library.artist ? `${r.library.artist} - ` : ''}{r.library.title}
              </span>
              <button className="acq-cell-x acq-cell-notit" disabled={wantBusy} onClick={onWantAnyway} title="not this track — want it anyway (the match is rejected and never re-proposed)">
                ✕ not it · want
              </button>
            </>
          ) : (
            <button className="btn btn-mini btn-primary" disabled={wantBusy} onClick={onWant} title="mark wanted: becomes a Source Item; Soulseek candidates are searched automatically">
              + want
            </button>
          )}
        </td>
        <td className="acq-sub">{likedLabel(r.added_at)}</td>
      </tr>
      {it && panel && (
        <tr className={`acq-tr-inline acq-tr-${it.stage}`}>
          <td colSpan={colSpan}>
            {panel === 'soulseek' && <SoulseekPanel key={it.id} item={it} soulseekAvailable={soulseekAvailable} />}
            {panel === 'match' && <MatchPanel key={it.id} item={it} />}
            {panel === 'fulfilled' && <FulfilledPanel key={it.id} item={it} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function SpotifyFeedTable({
  feed,
  items,
  soulseekAvailable,
  sort,
  onSort,
  filter,
  status,
  onCounts,
}: {
  feed: SpotifyFeed;
  /** the live Source Item list — feed rows that are Source Items render from here */
  items: SourceItem[];
  soulseekAvailable: boolean;
  sort: SortState;
  onSort: (k: SortKey) => void;
  filter: string;
  status: SpotifyFeedStatus;
  /** category sizes, once a page has loaded (the rail shows them) */
  onCounts?: (counts: Record<SpotifyFeedStatus, number>) => void;
}) {
  const [opened, setOpened] = useState<Map<string, Panel>>(new Map());
  const q = useSpotifyFeedPages(feed, sort, filter, status);
  const counts = q.data?.pages[0]?.counts;
  useEffect(() => {
    if (counts) onCounts?.(counts);
  }, [counts, onCounts]);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap(p => p.rows), [q.data]);
  const bySpotify = useSpotifyItemIndex(items);
  const want = useWant([feed.id]);
  const total = q.data?.pages[0]?.total ?? feed.track_count;
  const wantable = rows.filter(r => !spotifyItemFor(r, bySpotify) && !r.library);

  const togglePanel = (id: string, p: Panel) =>
    setOpened(prev => {
      const n = new Map(prev);
      if (n.get(id) === p) n.delete(id);
      else n.set(id, p);
      return n;
    });

  if (!feed.readable) {
    return (
      <div className="acq-empty">
        Spotify will not return the contents of “{feed.name}” — in Dev Mode only playlists you own or collaborate on are readable.
        {feed.url && (
          <>
            {' '}
            <a href={feed.url} target="_blank" rel="noreferrer">open in Spotify ↗</a>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="acq-tabletool">
        <span className="acq-sub">
          {rows.length < total ? `${rows.length} of ` : ''}
          {total}
          {filter ? ' matching' : ''} in {feed.name}
          {feed.owner && feed.kind === 'playlist' ? ` · ${feed.owner}` : ''}
          {status !== 'all' && ` · ${status}`}
        </span>
        <span className="acq-spacer" />
        {q.hasNextPage && (
          <button className="btn btn-mini" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? 'loading…' : `load ${Math.min(FEED_PAGE, total - rows.length)} more`}
          </button>
        )}
        {wantable.length > 0 && (
          <button className="btn btn-mini btn-primary" disabled={want.isPending} onClick={() => want.mutate(wantable.map(r => ({ id: r.spotify_id })))} title="create Source Items for every loaded row not already in the library">
            + want all {wantable.length}
          </button>
        )}
      </div>
      {q.isLoading && <div className="acq-empty">loading {feed.name} ({feed.track_count} tracks — the first load fetches the whole feed)…</div>}
      {q.isError && <div className="acq-inline-error acq-empty">{(q.error as Error).message}</div>}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <div className="acq-empty">{filter ? 'no rows match the filter' : status === 'open' ? 'nothing open — everything here is in the library or already wanted' : 'empty feed'}</div>
      )}
      {rows.length > 0 && (
        <table className="acq-table">
          <thead>
            <tr>
              <th />
              <th className="acq-th-sort" onClick={() => onSort('title')}>title{sortGlyph(sort, 'title')}</th>
              <th className="acq-th-sort" onClick={() => onSort('artist')}>artist{sortGlyph(sort, 'artist')}</th>
              <th className="acq-th-sort" onClick={() => onSort('length')}>len{sortGlyph(sort, 'length')}</th>
              <th />
              <th>status</th>
              <th className="acq-th-sort" onClick={() => onSort('added')}>added{sortGlyph(sort, 'added')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const it = spotifyItemFor(r, bySpotify);
              return (
                <SpotifyRow
                  key={r.spotify_id}
                  row={r}
                  item={it}
                  panel={it ? opened.get(r.spotify_id) ?? null : null}
                  onToggle={p => togglePanel(r.spotify_id, p)}
                  soulseekAvailable={soulseekAvailable}
                  onWant={() => want.mutate([{ id: r.spotify_id }])}
                  onWantAnyway={() => want.mutate([{ id: r.spotify_id, rejectTrackId: r.library?.track_id }])}
                  wantBusy={want.isPending}
                  colSpan={7}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
