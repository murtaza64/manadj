/**
 * Playlist ↔ Set copy flows (sets 11): order preservation and one-time
 * copy semantics, with the API mocked at the client seam. Both flows are
 * plain copies — the assertions pin the wire calls, not UI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    playlists: {
      get: vi.fn(),
      create: vi.fn(),
      addTrack: vi.fn(),
    },
    sets: {
      get: vi.fn(),
      create: vi.fn(),
      replaceEntries: vi.fn(),
    },
  },
}));

import { api } from '../api/client';
import { createPlaylistFromSet, createSetFromPlaylist } from './playlistFlows';
import { _resetSetStoreForTests, getSetEntries } from './setStore';

const mocked = api as unknown as {
  playlists: {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    addTrack: ReturnType<typeof vi.fn>;
  };
  sets: {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    replaceEntries: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetSetStoreForTests();
});

describe('createSetFromPlaylist — Play order into a new Set', () => {
  it('copies the tracks in Play order, unpinned, with name and color', async () => {
    mocked.playlists.get.mockResolvedValue({
      id: 3,
      name: 'Warmup',
      color: '#ff0000',
      tracks: [{ id: 5 }, { id: 3 }, { id: 9 }],
    });
    mocked.sets.create.mockResolvedValue({ id: 42, name: 'Warmup', color: '#ff0000', display_order: 0 });
    mocked.sets.get.mockResolvedValue({ id: 42, entries: [] });
    mocked.sets.replaceEntries.mockResolvedValue({});

    const created = await createSetFromPlaylist(3);

    expect(created.id).toBe(42);
    expect(mocked.sets.create).toHaveBeenCalledWith({ name: 'Warmup', color: '#ff0000' });
    // Store (client-authoritative) holds the copy in Play order, unpinned.
    expect(getSetEntries(42)).toEqual([
      { trackId: 5, pin: null },
      { trackId: 3, pin: null },
      { trackId: 9, pin: null },
    ]);
    expect(mocked.sets.replaceEntries).toHaveBeenCalledWith(42, [
      { track_id: 5, pin_kind: null, pin_uuid: null },
      { track_id: 3, pin_kind: null, pin_uuid: null },
      { track_id: 9, pin_kind: null, pin_uuid: null },
    ]);
  });

  it('omits color when the playlist has none', async () => {
    mocked.playlists.get.mockResolvedValue({ id: 3, name: 'P', tracks: [] });
    mocked.sets.create.mockResolvedValue({ id: 1, name: 'P', color: null, display_order: 0 });
    mocked.sets.get.mockResolvedValue({ id: 1, entries: [] });

    await createSetFromPlaylist(3);
    expect(mocked.sets.create).toHaveBeenCalledWith({ name: 'P' });
  });
});

describe('createPlaylistFromSet — track order into an ordinary Playlist', () => {
  it('appends the tracks in Set order (pins are not copied — they have no playlist meaning)', async () => {
    mocked.sets.get.mockResolvedValue({
      id: 7,
      entries: [
        { track_id: 9, position: 0, pin_kind: 'transition', pin_uuid: 'u-1' },
        { track_id: 4, position: 1, pin_kind: null, pin_uuid: null },
        { track_id: 2, position: 2, pin_kind: 'take', pin_uuid: 'u-2' },
      ],
    });
    mocked.playlists.create.mockResolvedValue({ id: 11, name: 'My set', display_order: 0 });
    mocked.playlists.addTrack.mockResolvedValue({ skipped: false, playlist: {} });

    const playlist = await createPlaylistFromSet({
      id: 7,
      name: 'My set',
      color: '#00d0ff',
      display_order: 0,
      tempo_policy: 'riding',
      set_tempo_bpm: null,
      has_archived_tracks: false,
    });

    expect(playlist.id).toBe(11);
    expect(mocked.playlists.create).toHaveBeenCalledWith({ name: 'My set', color: '#00d0ff' });
    // Appended sequentially in Set order (position omitted = append).
    expect(mocked.playlists.addTrack.mock.calls).toEqual([
      [11, { track_id: 9 }],
      [11, { track_id: 4 }],
      [11, { track_id: 2 }],
    ]);
  });
});
