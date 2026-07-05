/**
 * Universal track menu (sets 17) — pure-core tests in the suite's style
 * (adjacency.test.ts / suggest.test.ts): expected labels/order are
 * independent literals from the issue's spec, never recomputed through
 * the code under test.
 *
 * Universal items, stable order: Load to Deck A / B · Add to playlist ▸ ·
 * Add to set ▸ · [surface items] · Archive|Unarchive. Archive↔Unarchive
 * is per-track (archived_at): a mixed multi-selection shows both, each
 * acting on its own subset.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Track } from '../types';
import { trackMenuItems, type TrackMenuInput } from './trackMenu';

function track(fields: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/t/1.mp3',
    tags: [],
    ...fields,
  } as unknown as Track;
}

const live = (id: number) => track({ id, archived_at: null });
const archived = (id: number) => track({ id, archived_at: '2026-01-01T00:00:00Z' });

function input(overrides: Partial<TrackMenuInput> = {}): TrackMenuInput {
  return {
    tracks: [live(1)],
    playlists: [
      { id: 10, name: 'Warmup' },
      { id: 11, name: 'Peak' },
    ],
    sets: [
      { id: 20, name: 'Friday' },
      { id: 21, name: 'Saturday' },
    ],
    loadToDeck: vi.fn(),
    addToPlaylist: vi.fn(),
    addToSet: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    ...overrides,
  };
}

const labels = (items: ReturnType<typeof trackMenuItems>) => items.map((i) => i.label);

describe('stable order', () => {
  it('single live track: Load A/B · Add to playlist · Add to set · Archive', () => {
    expect(labels(trackMenuItems(input()))).toEqual([
      'Load to Deck A',
      'Load to Deck B',
      'Add to playlist',
      'Add to set',
      'Archive track',
    ]);
  });

  it('no targets yields no items', () => {
    expect(trackMenuItems(input({ tracks: [] }))).toEqual([]);
  });

  it('without loadToDeck there are no Load items and no leading separator', () => {
    const items = trackMenuItems(input({ loadToDeck: undefined }));
    expect(labels(items)).toEqual(['Add to playlist', 'Add to set', 'Archive track']);
    expect(items[0].separatorBefore).toBeFalsy();
  });

  it('with Load items, Add to playlist is separated from them', () => {
    const items = trackMenuItems(input());
    expect(items[2].label).toBe('Add to playlist');
    expect(items[2].separatorBefore).toBe(true);
  });
});

describe('Load to Deck', () => {
  it('loads the single target', () => {
    const loadToDeck = vi.fn();
    const items = trackMenuItems(input({ tracks: [live(7)], loadToDeck }));
    items[1].onSelect!();
    expect(loadToDeck).toHaveBeenCalledWith('B', expect.objectContaining({ id: 7 }));
  });

  it('is disabled on multi, with the explanatory title', () => {
    const items = trackMenuItems(input({ tracks: [live(1), live(2)] }));
    expect(items[0].disabled).toBe(true);
    expect(items[0].title).toBe('Load acts on a single track');
    expect(items[1].disabled).toBe(true);
  });
});

describe('Add to playlist / Add to set submenus', () => {
  it('submenu entries add all target ids to the chosen container', () => {
    const addToPlaylist = vi.fn();
    const addToSet = vi.fn();
    const items = trackMenuItems(
      input({ tracks: [live(1), live(2)], addToPlaylist, addToSet })
    );
    items[2].submenu![1].onSelect!();
    expect(addToPlaylist).toHaveBeenCalledWith(11, [1, 2]);
    items[3].submenu![0].onSelect!();
    expect(addToSet).toHaveBeenCalledWith(20, [1, 2]);
  });

  it('multi labels carry the target count', () => {
    const items = trackMenuItems(input({ tracks: [live(1), live(2), live(3)] }));
    expect(items[2].label).toBe('Add 3 to playlist');
    expect(items[3].label).toBe('Add 3 to set');
  });

  it('excludeSetId / excludePlaylistId: the current container never lists itself', () => {
    const items = trackMenuItems(input({ excludeSetId: 20, excludePlaylistId: 11 }));
    expect(items[2].submenu!.map((i) => i.label)).toEqual(['Warmup']);
    expect(items[3].submenu!.map((i) => i.label)).toEqual(['Saturday']);
  });

  it('empty container lists disable the item with a tooltip', () => {
    const items = trackMenuItems(input({ playlists: [], sets: [] }));
    expect(items[2].disabled).toBe(true);
    expect(items[2].title).toBe('No playlists yet');
    expect(items[3].disabled).toBe(true);
    expect(items[3].title).toBe('No sets yet');
  });

  it('a list emptied by exclusion disables with the "no other" tooltip', () => {
    const items = trackMenuItems(
      input({ sets: [{ id: 20, name: 'Friday' }], excludeSetId: 20 })
    );
    expect(items[3].disabled).toBe(true);
    expect(items[3].title).toBe('No other sets');
  });
});

describe('Archive|Unarchive is per-track (archived_at)', () => {
  it('a live track offers Archive (danger, separated), acting on its id', () => {
    const archive = vi.fn();
    const items = trackMenuItems(input({ tracks: [live(5)], archive }));
    const item = items[items.length - 1];
    expect(item.label).toBe('Archive track');
    expect(item.danger).toBe(true);
    expect(item.separatorBefore).toBe(true);
    item.onSelect!();
    expect(archive).toHaveBeenCalledWith([5]);
  });

  it('an archived track offers Unarchive instead', () => {
    const unarchive = vi.fn();
    const items = trackMenuItems(input({ tracks: [archived(5)], unarchive }));
    const item = items[items.length - 1];
    expect(item.label).toBe('Unarchive');
    expect(item.danger).toBeFalsy();
    expect(item.separatorBefore).toBe(true);
    item.onSelect!();
    expect(unarchive).toHaveBeenCalledWith([5]);
    expect(labels(items)).not.toContain('Archive track');
  });

  it('a mixed multi-selection shows both, each acting on its subset', () => {
    const archive = vi.fn();
    const unarchive = vi.fn();
    const items = trackMenuItems(
      input({ tracks: [live(1), archived(2), live(3)], archive, unarchive })
    );
    const archiveItem = items.find((i) => i.label === 'Archive 2 tracks')!;
    const unarchiveItem = items.find((i) => i.label === 'Unarchive 1 track')!;
    expect(archiveItem.separatorBefore).toBe(true);
    expect(unarchiveItem.separatorBefore).toBeFalsy();
    archiveItem.onSelect!();
    expect(archive).toHaveBeenCalledWith([1, 3]);
    unarchiveItem.onSelect!();
    expect(unarchive).toHaveBeenCalledWith([2]);
  });

  it('uniform multi-selections use counted labels', () => {
    expect(labels(trackMenuItems(input({ tracks: [live(1), live(2)] })))).toContain(
      'Archive 2 tracks'
    );
    expect(labels(trackMenuItems(input({ tracks: [archived(1), archived(2)] })))).toContain(
      'Unarchive 2 tracks'
    );
  });
});

describe('surface-append point', () => {
  it('surface items land between Add to set and the archive verdicts', () => {
    const items = trackMenuItems(
      input({
        tracks: [live(1), archived(2)],
        surfaceItems: [{ label: 'Remove from set', danger: true, onSelect: () => {} }],
      })
    );
    expect(labels(items)).toEqual([
      'Load to Deck A',
      'Load to Deck B',
      'Add 2 to playlist',
      'Add 2 to set',
      'Remove from set',
      'Archive 1 track',
      'Unarchive 1 track',
    ]);
  });
});
