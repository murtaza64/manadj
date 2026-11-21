// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { ExternalDrivePreviewPlaylist } from '../api/client';
import { classifyPlaylist } from './UnifiedSync';

afterEach(() => { vi.restoreAllMocks(); });
const member = (over: object = {}) => ({
  counterpart_status: 'unique-name-match' as const, counterpart_id: 7, target_token: 'tok', common: 2,
  adds_in_library: 0, adds_new: 0, removes: 0, removes_provisional: false, uncertain_members: 0, order_differs: false, ...over,
});
const pl = (over: Partial<ExternalDrivePreviewPlaylist> = {}): ExternalDrivePreviewPlaylist => ({
  id: 1, name: 'Warm Up', folder_path: '', track_count: 2, new_count: 0, present_count: 2, uncertain_count: 0,
  other_count: 0, folder_not_representable: false, track_ordinals: [0, 1], membership: member(), ...over,
});
it('green needs tracks and order verified; unknown order is not green; name-only is never green', () => {
  expect(classifyPlaylist(pl(), true).kind).toBe('match');
  expect(classifyPlaylist(pl({ membership: member({ order_differs: null }) }), true).kind).toBe('unknown');
  expect(classifyPlaylist(pl({ membership: member({ uncertain_members: 1 }) }), true).kind).toBe('unknown');
  expect(classifyPlaylist(pl({ membership: member({ order_differs: true }) }), true).kind).toBe('work');
  expect(classifyPlaylist(pl({ membership: member({ removes: 1 }) }), true).kind).toBe('unknown');
  expect(classifyPlaylist(pl({ membership: null }), true).kind).toBe('unknown');
  expect(classifyPlaylist(pl({ membership: member({ counterpart_status: 'ambiguous-name', counterpart_id: null }) }), true).kind).toBe('blocked');
  expect(classifyPlaylist(pl({ folder_not_representable: true, membership: member({ counterpart_status: 'no-local-playlist', counterpart_id: null }) }), true).label).toContain('folder not kept');
  expect(classifyPlaylist(pl(), false).kind).toBe('blocked');
});


it('describes results as the actual change, not just an import count', async () => {
  const { describeResult } = await import('./UnifiedSync');
  const base = { destination: '', imported: 0, skipped_present: 0, skipped_uncertain: 0, skipped_duplicate: 0, skipped_missing_file: 0, skipped_unselected: 0, errors: [], track_ids: [] };
  expect(describeResult('copy', { ...base, playlist: { playlist_id: 1, name: 'RIG New', member_count: 2, imported: 0, already_in_library: 2, skipped_uncertain: 0, skipped_other: 0 } } as never)).toBe('Created playlist "RIG New" in your library with 2 tracks, all already in your library.');
  expect(describeResult('tracks', { ...base } as never)).toBe('Nothing needed copying.');
  expect(describeResult('copy', { ...base, errors: ['x'] } as never)).toContain('Stopped with 1 error');
});


const candidate = (over: object = {}) => member({ counterpart_status: 'candidate-name-match', counterpart_id: null, candidate_id: 9, candidate_name: 'Peak', target_token: 't9', order_differs: true, ...over });

it('a drive playlist in a folder is only a candidate: never green, never auto-targeted', () => {
  const folderIdentical = pl({ folder_path: 'RIG', name: 'Peak', membership: candidate({ order_differs: false }) });
  expect(classifyPlaylist(folderIdentical, true).kind).toBe('unknown');
  expect(classifyPlaylist(folderIdentical, true).label).toContain('not paired');
  const withChange = classifyPlaylist(pl({ folder_path: 'RIG', name: 'Peak', membership: candidate() }), true);
  expect(withChange).toMatchObject({ kind: 'work', action: 'pair' });
});

