import type { PlaylistExportPlan, PlaylistFullExportReport } from '../types';

export const exportPlanFixture: PlaylistExportPlan = {
  playlist_name: 'Night Shift', playlist_id: 1, source: 'Library', target: 'rekordbox', scope: 'full',
  destination: '/fixture/Rekordbox', executable: true, token: 'fixture-plan-token',
  membership: { create: false, before: ['/fixture/b.flac', '/fixture/a.flac', '/fixture/old.flac'],
    after: ['/fixture/a.flac', '/fixture/b.flac', '/fixture/c.flac'],
    added: ['/fixture/c.flac'], removed: ['/fixture/old.flac'], moved: 2 },
  tracks: [
    { track_id: 1, title: 'Eyes Cut Deeper', filename: '/fixture/a.flac', duration: 180, record_action: 'existing', fields: [
      { field: 'hotcues', before_known: true, before: [{ slot: 1, time: 1.1 }, { slot: 4, time: 14.5 }], after: [], action: 'clear', reason: 'Replace cue set with the empty Library set' },
      { field: 'maincue', before_known: false, before: null, after: null, action: 'clear', reason: 'Prior Main cue is not observed by this reader' },
      { field: 'energy', before_known: true, before: 4, after: null, action: 'clear', reason: null },
      { field: 'key', before_known: true, before: 7, after: 8, action: 'replace', reason: null },
      { field: 'tags', before_known: true, before: ['Deep', 'Old'], after: ['Peak'], action: 'replace', reason: null },
      { field: 'beatgrid', before_known: true, before: { tempo_changes: [{ start_time: 0.32, bpm: 173.98, bar_position: 1 }] }, after: { tempo_changes: [{ start_time: 0.36, bpm: 174, bar_position: 1 }] }, action: 'replace', reason: 'Writer checks native prerequisites' },
    ] },
    { track_id: 2, title: 'Afterimage', filename: '/fixture/b.flac', duration: 220, record_action: 'existing', fields: [
      { field: 'hotcues', before_known: true, before: [{ slot: 1, time: 2 }], after: [{ slot: 1, time: 2.6 }, { slot: 2, time: 24 }], action: 'replace', reason: null },
      { field: 'beatgrid', before_known: false, before: null, after: null, action: 'skip', reason: 'Library has no saved grid' },
    ] },
    { track_id: 3, title: 'Pressure Drop', filename: '/fixture/c.flac', duration: 240, record_action: 'existing', fields: [] },
  ], tag_structure: [{ id: 1, name: 'Mood', tags: [{ id: 1, name: 'Peak' }] }], warnings: ['Track fields are shared by other destination playlists.'],
};

export const exportReportFixture: PlaylistFullExportReport = { playlist_name: 'Night Shift', results: [{
  target: 'rekordbox', status: 'exported', playlist_created: false, tracks_total: 3,
  tracks_exported: 3, tracks_failed: 0, tracks_skipped: 0,
  tracks: [
    { track_id: 1, title: 'Eyes Cut Deeper', status: 'exported', reason: null, fields: { playlist: 'exported', hotcues: 'exported', maincue: 'exported: cleared', energy: 'exported: cleared', key: 'exported', tags: 'exported', beatgrid: 'exported' } },
    { track_id: 2, title: 'Afterimage', status: 'exported', reason: null, fields: { playlist: 'exported', hotcues: 'exported', beatgrid: 'skipped: Library has no saved grid' } },
    { track_id: 3, title: 'Pressure Drop', status: 'exported', reason: null, fields: { playlist: 'exported', key: 'exported' } },
  ],
}] };
