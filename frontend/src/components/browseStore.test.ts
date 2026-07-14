import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_SELECTION } from '../selection/selectionModel';
import {
  _resetBrowseSessionForTests,
  browseSession,
  restoredView,
  updateBrowseSession,
} from './browseStore';

afterEach(_resetBrowseSessionForTests);

describe('browse session store', () => {
  it('starts at All tracks with nothing restored', () => {
    expect(browseSession()).toMatchObject({
      view: 'all',
      playlistId: null,
      splitViewOpen: false,
      focusedArea: 'main',
      sidebarCursor: null,
      mainSelection: EMPTY_SELECTION,
      scrollTop: 0,
    });
  });

  it('patches survive across reads (the next mount seeds from them)', () => {
    updateBrowseSession({ view: 'playlist', playlistId: 12 });
    updateBrowseSession({ scrollTop: 480 });
    expect(browseSession()).toMatchObject({ view: 'playlist', playlistId: 12, scrollTop: 480 });
  });
});

describe('restoredView precedence', () => {
  it('a selected Set wins over anything stored', () => {
    updateBrowseSession({ view: 'playlist', playlistId: 12 });
    expect(restoredView(true)).toBe('set');
  });

  it('restores the stored view otherwise', () => {
    updateBrowseSession({ view: 'unprocessed' });
    expect(restoredView(false)).toBe('unprocessed');
    updateBrowseSession({ view: 'playlist', playlistId: 3 });
    expect(restoredView(false)).toBe('playlist');
  });

  it('falls back to All tracks when the stored view cannot be addressed', () => {
    updateBrowseSession({ view: 'set' }); // stored set-view, but no Set selected
    expect(restoredView(false)).toBe('all');
    updateBrowseSession({ view: 'playlist', playlistId: null });
    expect(restoredView(false)).toBe('all');
  });
});
