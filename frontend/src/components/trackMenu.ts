/**
 * Universal track menu (sets 17): the operations that always make sense
 * on a track, regardless of surface, in one stable order — Load to
 * Deck A / B · Add to playlist ▸ · Add to set ▸ · [surface items] ·
 * Archive|Unarchive. New universal operations get one home here.
 *
 * Pure core: callers supply the target tracks (1..n), container lists,
 * and action callbacks; `useTrackMenuItems` wraps it with the queries
 * and mutations. Multi-aware from day one (issue 18 rides the same
 * targeting rule): container adds act on every target, Load is single-
 * track only, and Archive↔Unarchive is per-track (`archived_at`) — a
 * mixed multi-selection shows both verdicts, each acting on its subset.
 */
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';
import type { MenuItem } from './ContextMenu';

/** A playlist or set as a submenu target. */
export interface ContainerRef {
  id: number;
  name: string;
}

export interface TrackMenuInput {
  /** The menu's targets: the selection if the clicked row is in it,
   * else the clicked row (the Library targeting rule). */
  tracks: Track[];
  playlists: ContainerRef[];
  sets: ContainerRef[];
  /** The current container never lists itself in its Add ▸ submenu. */
  excludeSetId?: number;
  excludePlaylistId?: number;
  /** Absent ⇒ no Load items (surfaces without a load affordance). */
  loadToDeck?: (deck: ChannelId, track: Track) => void;
  /** Surface-specific items (Remove from set / playlist — danger-styled),
   * inserted between Add to set and the archive verdicts. */
  surfaceItems?: MenuItem[];
  addToPlaylist: (playlistId: number, trackIds: number[]) => void;
  addToSet: (setId: number, trackIds: number[]) => void;
  /** Verdict callbacks receive the per-track subset, not all targets. */
  archive: (trackIds: number[]) => void;
  unarchive: (trackIds: number[]) => void;
}

const plural = (n: number) => (n === 1 ? 'track' : 'tracks');

/** The Add to playlist ▸ / Add to set ▸ items share one shape: exclude
 * the current container, counted multi label, disabled with a tooltip
 * when nothing (else) exists to add to. */
function addToContainerItem(opts: {
  noun: 'playlist' | 'set';
  containers: ContainerRef[];
  excludeId: number | undefined;
  targetIds: number[];
  separatorBefore: boolean;
  onAdd: (containerId: number, trackIds: number[]) => void;
}): MenuItem {
  const { noun, targetIds } = opts;
  const listed = opts.containers.filter((c) => c.id !== opts.excludeId);
  return {
    label: targetIds.length > 1 ? `Add ${targetIds.length} to ${noun}` : `Add to ${noun}`,
    separatorBefore: opts.separatorBefore,
    disabled: listed.length === 0,
    title:
      listed.length === 0
        ? opts.containers.length === 0
          ? `No ${noun}s yet`
          : `No other ${noun}s`
        : undefined,
    submenu: listed.map((c) => ({
      label: c.name,
      onSelect: () => opts.onAdd(c.id, targetIds),
    })),
  };
}

export function trackMenuItems(input: TrackMenuInput): MenuItem[] {
  const { tracks, loadToDeck } = input;
  if (tracks.length === 0) return [];
  const targetIds = tracks.map((t) => t.id);
  const multi = targetIds.length > 1;
  const items: MenuItem[] = [];

  if (loadToDeck) {
    // Loads tracks[0]: disabled on multi, so the one enabled case is a
    // single target — necessarily the clicked row under the targeting
    // rule. Revisit if issue 18 ever changes target resolution.
    const loadDisabledTitle = multi ? 'Load acts on a single track' : undefined;
    for (const deck of ['A', 'B'] as const) {
      items.push({
        label: `Load to Deck ${deck}`,
        disabled: multi,
        title: loadDisabledTitle,
        onSelect: () => loadToDeck(deck, tracks[0]),
      });
    }
  }

  items.push(
    addToContainerItem({
      noun: 'playlist',
      containers: input.playlists,
      excludeId: input.excludePlaylistId,
      targetIds,
      separatorBefore: items.length > 0,
      onAdd: input.addToPlaylist,
    }),
    addToContainerItem({
      noun: 'set',
      containers: input.sets,
      excludeId: input.excludeSetId,
      targetIds,
      separatorBefore: false,
      onAdd: input.addToSet,
    })
  );

  items.push(...(input.surfaceItems ?? []));

  // Archived (CONTEXT.md): per-track verdict, replacing Library's old
  // view-level switch. Stable order beats state-dependent reordering:
  // Archive (when any target is live), then Unarchive (when any is
  // archived); only the first carries the separator.
  const toArchive = tracks.filter((t) => t.archived_at == null).map((t) => t.id);
  const toUnarchive = tracks.filter((t) => t.archived_at != null).map((t) => t.id);
  if (toArchive.length > 0) {
    items.push({
      label: multi ? `Archive ${toArchive.length} ${plural(toArchive.length)}` : 'Archive track',
      danger: true,
      separatorBefore: true,
      onSelect: () => input.archive(toArchive),
    });
  }
  if (toUnarchive.length > 0) {
    items.push({
      label: multi ? `Unarchive ${toUnarchive.length} ${plural(toUnarchive.length)}` : 'Unarchive',
      separatorBefore: toArchive.length === 0,
      onSelect: () => input.unarchive(toUnarchive),
    });
  }

  return items;
}
