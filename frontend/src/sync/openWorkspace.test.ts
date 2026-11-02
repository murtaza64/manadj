// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { openSyncWorkspace, peekSyncWorkspace, takeSyncWorkspace, setSyncWorkspaceBusy } from './openWorkspace';

afterEach(() => { setSyncWorkspaceBusy(false); takeSyncWorkspace(); });

it('captures IDs and field choices instead of retaining mutable entry context', () => {
  const ids = [2, 4];
  const fields = ['key'] as const;
  expect(openSyncWorkspace({ kind: 'fields', trackIds: ids, scope: 'selected', label: 'Library selection', fields: [...fields] })).toBe(true);
  ids.push(6);
  expect(peekSyncWorkspace()).toMatchObject({ trackIds: [2, 4], fields: ['key'] });
  expect(takeSyncWorkspace()).toMatchObject({ trackIds: [2, 4] });
  expect(peekSyncWorkspace()).toBeNull();
});

it('does not retarget a pending operation or replace its captured request', () => {
  openSyncWorkspace({ kind: 'playlist', playlistName: 'First' });
  setSyncWorkspaceBusy(true);
  expect(openSyncWorkspace({ kind: 'playlist', playlistName: 'Second' })).toBe(false);
  expect(peekSyncWorkspace()).toMatchObject({ playlistName: 'First' });
});

it('rejects empty/invalid implicit field scopes', () => {
  expect(() => openSyncWorkspace({ kind: 'fields', trackIds: [], scope: 'all', label: 'Empty' })).toThrow();
  expect(() => openSyncWorkspace({ kind: 'fields', trackIds: [NaN], scope: 'selected', label: 'Invalid' })).toThrow();
});
