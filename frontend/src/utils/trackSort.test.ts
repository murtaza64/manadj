import { describe, expect, it } from 'vitest';

import type { Track } from '../types';
import {
  PLAY_ORDER_SORT,
  isPlayOrderSort,
  nextPlaylistSort,
  sortPlaylistTracks,
} from './trackSort';

function track(id: number, fields: Partial<Track> = {}): Track {
  return {
    id,
    filename: `/t/${id}.mp3`,
    title: null,
    artist: null,
    tags: [],
    ...fields,
  } as unknown as Track;
}

const PLAYLIST = [
  track(1, { bpm: 174, title: 'c' }),
  track(2, { bpm: 140, title: 'a' }),
  track(3, { bpm: undefined, title: 'b' }),
];

describe('sortPlaylistTracks', () => {
  it('position asc is play order; desc is its reverse', () => {
    expect(sortPlaylistTracks(PLAYLIST, PLAY_ORDER_SORT).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(
      sortPlaylistTracks(PLAYLIST, { column: 'position', direction: 'desc' }).map((t) => t.id)
    ).toEqual([3, 2, 1]);
  });

  it('sorts by a value column without mutating the input', () => {
    const input = [...PLAYLIST];
    const sorted = sortPlaylistTracks(input, { column: 'bpm', direction: 'asc' });
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3]);
    expect(input.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('nulls sort last in either direction; ties keep play order', () => {
    expect(
      sortPlaylistTracks(PLAYLIST, { column: 'bpm', direction: 'desc' }).map((t) => t.id)
    ).toEqual([1, 2, 3]);
    const tied = [track(5, { bpm: 140 }), track(6, { bpm: 140 })];
    expect(sortPlaylistTracks(tied, { column: 'bpm', direction: 'asc' }).map((t) => t.id)).toEqual([
      5, 6,
    ]);
  });

  it('strings compare case-insensitively', () => {
    const tracks = [track(1, { title: 'Zeta' }), track(2, { title: 'alpha' })];
    expect(
      sortPlaylistTracks(tracks, { column: 'title', direction: 'asc' }).map((t) => t.id)
    ).toEqual([2, 1]);
  });
});

describe('nextPlaylistSort', () => {
  it('toggles direction on the same column', () => {
    expect(nextPlaylistSort(PLAY_ORDER_SORT, 'position')).toEqual({
      column: 'position',
      direction: 'desc',
    });
  });

  it('fresh value column starts desc; fresh # starts asc (play order)', () => {
    expect(nextPlaylistSort(PLAY_ORDER_SORT, 'bpm')).toEqual({ column: 'bpm', direction: 'desc' });
    expect(nextPlaylistSort({ column: 'bpm', direction: 'desc' }, 'position')).toEqual(
      PLAY_ORDER_SORT
    );
  });
});

describe('isPlayOrderSort', () => {
  it('only # ascending counts as play order', () => {
    expect(isPlayOrderSort(PLAY_ORDER_SORT)).toBe(true);
    expect(isPlayOrderSort({ column: 'position', direction: 'desc' })).toBe(false);
    expect(isPlayOrderSort({ column: 'bpm', direction: 'asc' })).toBe(false);
  });
});
