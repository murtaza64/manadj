// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { appReaders } from './appReaders';
import { captureDiagnostics } from './diagnostics';
import { DEFAULT_FILTERS } from '../contexts/FilterContext';
import type { DeckContextValue } from '../hooks/useDeck';
import type { ChannelId, Mixer } from '../playback/mixer';

it('selects primitives from real state interfaces, excluding Track metadata, search text, buffers, and device IDs', () => {
  const decks = Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, {
    loadedTrack: { id: 42, title: 'PRIVATE_TITLE', path: 'PRIVATE_PATH', source_url: 'PRIVATE_URL' },
    engine: { getPlayhead: () => 12, getSnapshot: () => ({ trackId: 42, playing: true, loadState: 'ready',
      loadError: 'https://example.com/decode?private=SECRET_QUERY', loop: { start: 1, end: 2, SECRET_FIELD: true },
      buffer: 'SECRET_AUDIO', cache: 'SECRET_CACHE' }) },
  }])) as unknown as Record<ChannelId, DeckContextValue>;
  const mixer = {
    getMaster: () => 0.8, getCrossfader: () => 0.5, getCrossfaderEnabled: () => true,
    getCueLevel: () => 1, getCueMix: () => 0, getAutomation: () => null,
    getCrossfaderAssignment: () => 'left', getCueSinkId: () => 'SECRET_DEVICE',
    getChannelState: () => ({ fader: 1, trim: 0.5, filter: 0, pfl: true, eq: { low: 1, mid: 1, high: 1 }, device: 'SECRET_DEVICE' }),
  } as unknown as Mixer;
  const captured = captureDiagnostics(appReaders('performance', decks, mixer, {
    ...DEFAULT_FILTERS, search: 'SECRET_SEARCH', selectedTagIds: Array.from({ length: 100 }, (_, i) => i),
  }));
  expect(JSON.stringify(captured.snapshot)).not.toMatch(/PRIVATE_|SECRET_/);
  expect(captured.snapshot.decks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'A', track_id: 42, playhead: 12, playing: true })]));
  expect(captured.snapshot.filters).toMatchObject({ search_length: 13, tag_ids: expect.any(Array) });
  expect(captured.warnings).toEqual([]);
});
