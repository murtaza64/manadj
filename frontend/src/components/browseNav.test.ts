import { describe, expect, it } from 'vitest';

import {
  browseAreas,
  cursorEnd,
  endTargetId,
  entryKey,
  moveBrowseArea,
  moveCursor,
  pageTargetId,
  selectionEntryKey,
  sidebarEntries,
} from './browseNav';

describe('browseAreas ring', () => {
  it('is sidebar+main normally and sidebar+two panes in split view', () => {
    expect(browseAreas(false)).toEqual(['sidebar', 'main']);
    expect(browseAreas(true)).toEqual(['sidebar', 'playlist', 'library']);
  });

  it('moves one step and clamps at both ends', () => {
    const areas = browseAreas(true);
    expect(moveBrowseArea(areas, 'sidebar', 1)).toBe('playlist');
    expect(moveBrowseArea(areas, 'playlist', 1)).toBe('library');
    expect(moveBrowseArea(areas, 'library', 1)).toBe('library');
    expect(moveBrowseArea(areas, 'playlist', -1)).toBe('sidebar');
    expect(moveBrowseArea(areas, 'sidebar', -1)).toBe('sidebar');
  });

  it('re-enters at the near end when the current area left the ring', () => {
    const areas = browseAreas(false); // 'library' pane focus, split just closed
    expect(moveBrowseArea(areas, 'library', 1)).toBe('sidebar');
    expect(moveBrowseArea(areas, 'library', -1)).toBe('main');
  });
});

describe('sidebar entries and cursor', () => {
  const entries = sidebarEntries([10, 11], [7]);

  it('mirrors the sidebar visual order: views (incl. Sessions), playlists, sets', () => {
    expect(entries.map(entryKey)).toEqual([
      'view:all',
      'view:unprocessed',
      'view:needs-attention',
      'view:archived',
      'view:session',
      'playlist:10',
      'playlist:11',
      'set:7',
    ]);
  });

  it('drops a collapsed section from the walk; pinned All tracks stays (gh#174)', () => {
    expect(sidebarEntries([10, 11], [7], { playlists: true }).map(entryKey)).toEqual([
      'view:all',
      'view:unprocessed',
      'view:needs-attention',
      'view:archived',
      'view:session',
      'set:7',
    ]);
    expect(
      sidebarEntries([10, 11], [7], { tracks: true, playlists: true, sets: true }).map(entryKey)
    ).toEqual(['view:all']);
  });

  it('walks straight across a collapsed section boundary', () => {
    const collapsed = sidebarEntries([10, 11], [7], { playlists: true });
    expect(entryKey(moveCursor(collapsed, 'view:session', 1)!)).toBe('set:7');
    // Cursor keys from a now-collapsed section are stale → re-enter at the end.
    expect(entryKey(moveCursor(collapsed, 'playlist:10', 1)!)).toBe('view:all');
  });

  it('walks rows and clamps at the ends', () => {
    expect(entryKey(moveCursor(entries, 'view:archived', 1)!)).toBe('view:session');
    expect(entryKey(moveCursor(entries, 'set:7', 1)!)).toBe('set:7');
    expect(entryKey(moveCursor(entries, 'view:all', -1)!)).toBe('view:all');
  });

  it('enters at the end the motion comes from when the cursor is unset or stale', () => {
    expect(entryKey(moveCursor(entries, null, 1)!)).toBe('view:all');
    expect(entryKey(moveCursor(entries, null, -1)!)).toBe('set:7');
    expect(entryKey(moveCursor(entries, 'playlist:99', 1)!)).toBe('view:all');
    expect(moveCursor([], null, 1)).toBeNull();
  });

  it('jumps to first/last', () => {
    expect(entryKey(cursorEnd(entries, -1)!)).toBe('view:all');
    expect(entryKey(cursorEnd(entries, 1)!)).toBe('set:7');
  });

  it('seeds from the current Library selection', () => {
    expect(selectionEntryKey('all', null, null)).toBe('view:all');
    expect(selectionEntryKey('playlist', 11, null)).toBe('playlist:11');
    expect(selectionEntryKey('playlist', null, null)).toBeNull();
    expect(selectionEntryKey('set', null, 7)).toBe('set:7');
    // Sessions are ONE view entry (sessions 04): the list is the target.
    expect(selectionEntryKey('session', null, null)).toBe('view:session');
  });
});

describe('track-pane paged navigation targets', () => {
  const ids = Array.from({ length: 40 }, (_, i) => i + 1);

  it('pages by the row constant and clamps', () => {
    expect(pageTargetId(ids, 1, 1, 15)).toBe(16);
    expect(pageTargetId(ids, 30, 1, 15)).toBe(40);
    expect(pageTargetId(ids, 16, -1, 15)).toBe(1);
    expect(pageTargetId(ids, 3, -1, 15)).toBe(1);
  });

  it('enters at the near end without an anchor and handles empty lists', () => {
    expect(pageTargetId(ids, null, 1, 15)).toBe(1);
    expect(pageTargetId(ids, null, -1, 15)).toBe(40);
    expect(pageTargetId([], 1, 1, 15)).toBeNull();
  });

  it('end targets are the list extremes', () => {
    expect(endTargetId(ids, 1)).toBe(40);
    expect(endTargetId(ids, -1)).toBe(1);
    expect(endTargetId([], 1)).toBeNull();
  });
});
