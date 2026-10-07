// Spotify feed hooks shared by the feed table and the "all sources" view (gh#342).
import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../Toast';
import { type SpotifyFeed, type SpotifyFeedRow, type SpotifyFeedStatus, spotifyFeedsApi } from '../../setup/spotify/spotifyApi';
import type { SourceItem } from '../../types';
import { type SortState, serverSort } from './sortFilter';
import { ITEMS_KEY } from './useItems';

export const FEED_PAGE = 100;

/** Live Source Item for a feed row: the item list wins over the page's snapshot. */
export function spotifyItemFor(row: SpotifyFeedRow, bySpotify: Map<string, SourceItem>): SourceItem | null {
  return bySpotify.get(row.spotify_id) ?? row.source_item ?? null;
}

export function useSpotifyItemIndex(items: SourceItem[]): Map<string, SourceItem> {
  return useMemo(() => {
    const m = new Map<string, SourceItem>();
    for (const i of items) if (i.source === 'spotify') m.set(i.external_id, i);
    return m;
  }, [items]);
}

export function useWant(feedIds: string[]) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (wants: Array<{ id: string; rejectTrackId?: number }>) =>
      Promise.all(wants.map(w => spotifyFeedsApi.want(w.id, w.rejectTrackId))),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      for (const id of feedIds) qc.invalidateQueries({ queryKey: ['spotifyFeed', id] });
      const created = res.filter(r => r.created).length;
      toast(`wanted ${created}${res.length - created ? ` (${res.length - created} already wanted)` : ''}`);
    },
    onError: e => toast((e as Error).message),
  });
}

export function useSpotifyFeedPages(feed: SpotifyFeed | null, sort: SortState, filter: string, status: SpotifyFeedStatus = 'all', pageSize = FEED_PAGE) {
  const { key, dir } = serverSort(sort);
  return useInfiniteQuery({
    queryKey: ['spotifyFeed', feed?.id, key, dir, filter.trim(), status],
    queryFn: ({ pageParam }) => spotifyFeedsApi.page(feed!.id, pageParam, pageSize, key, dir, filter.trim(), status),
    initialPageParam: 0,
    getNextPageParam: last => last.next_offset ?? undefined,
    enabled: feed != null && feed.readable,
    staleTime: 60_000,
  });
}

