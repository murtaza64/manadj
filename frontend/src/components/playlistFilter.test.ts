/**
 * Client-side filter matcher (playlist-editing 09) — parity pins against
 * the server semantics it mirrors (backend crud.get_tracks): search
 * fields, the full-energy-range null admission, tag ANY/ALL, the BPM
 * half/double fold, and OpenKey → Engine key matching.
 */
import { describe, expect, it } from 'vitest';
import { trackMatchesFilters } from './playlistFilter';
import { DEFAULT_FILTERS, type FilterState } from '../contexts/FilterContext';
import type { Track } from '../types';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: 'amen_break.wav',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: [],
    ...overrides,
  };
}

function filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTERS, ...overrides };
}

const tag = (id: number) => ({
  id,
  name: `tag${id}`,
  category_id: 1,
  display_order: 0,
  category: { id: 1, name: 'genre', display_order: 0 },
});

describe('trackMatchesFilters', () => {
  it('default filters match everything, null fields included', () => {
    expect(trackMatchesFilters(track(), filters())).toBe(true);
    expect(
      trackMatchesFilters(track({ energy: undefined, bpm: undefined, key: undefined }), filters())
    ).toBe(true);
  });

  it('search hits filename, title, or artist, case-insensitively', () => {
    const f = filters({ search: 'AMEN' });
    expect(trackMatchesFilters(track({ filename: 'the_amen.wav' }), f)).toBe(true);
    expect(trackMatchesFilters(track({ filename: 'x.wav', title: 'Amen Bro' }), f)).toBe(true);
    expect(trackMatchesFilters(track({ filename: 'x.wav', artist: 'amenra' }), f)).toBe(true);
    expect(trackMatchesFilters(track({ filename: 'x.wav', title: 'other' }), f)).toBe(false);
  });

  it('full energy range admits null energy; a narrowed range does not', () => {
    expect(trackMatchesFilters(track({ energy: undefined }), filters())).toBe(true);
    const narrowed = filters({ energyMin: 2, energyMax: 4 });
    expect(trackMatchesFilters(track({ energy: undefined }), narrowed)).toBe(false);
    expect(trackMatchesFilters(track({ energy: 1 }), narrowed)).toBe(false);
    expect(trackMatchesFilters(track({ energy: 3 }), narrowed)).toBe(true);
    expect(trackMatchesFilters(track({ energy: 5 }), narrowed)).toBe(false);
  });

  it('tag ANY admits any selected tag; ALL requires every one', () => {
    const t = track({ tags: [tag(1), tag(2)] });
    expect(trackMatchesFilters(t, filters({ selectedTagIds: [2, 9] }))).toBe(true);
    expect(trackMatchesFilters(t, filters({ selectedTagIds: [9] }))).toBe(false);
    expect(
      trackMatchesFilters(t, filters({ selectedTagIds: [1, 2], tagMatchMode: 'ALL' }))
    ).toBe(true);
    expect(
      trackMatchesFilters(t, filters({ selectedTagIds: [1, 9], tagMatchMode: 'ALL' }))
    ).toBe(false);
  });

  it('BPM gate folds at half and double time; null BPM never passes', () => {
    const f = filters({ bpmCenter: 170, bpmThresholdPercent: 5 });
    expect(trackMatchesFilters(track({ bpm: 172 }), f)).toBe(true);
    expect(trackMatchesFilters(track({ bpm: 85 }), f)).toBe(true); // half-time fold
    expect(trackMatchesFilters(track({ bpm: 340 }), f)).toBe(true); // double-time fold
    expect(trackMatchesFilters(track({ bpm: 120 }), f)).toBe(false);
    expect(trackMatchesFilters(track({ bpm: undefined }), f)).toBe(false);
  });

  it('key filter matches OpenKey selections against Engine ids (ANY)', () => {
    // '1d' = engine 0 (C), '1m' = engine 1 (Am)
    const f = filters({ selectedKeyCamelotIds: ['1d', '1m'] });
    expect(trackMatchesFilters(track({ key: 0 }), f)).toBe(true);
    expect(trackMatchesFilters(track({ key: 1 }), f)).toBe(true);
    expect(trackMatchesFilters(track({ key: 5 }), f)).toBe(false);
    expect(trackMatchesFilters(track({ key: undefined }), f)).toBe(false);
  });

  it('axes conjoin: every active filter must pass', () => {
    const f = filters({ search: 'amen', energyMin: 3, energyMax: 5 });
    expect(trackMatchesFilters(track({ energy: 4 }), f)).toBe(true);
    expect(trackMatchesFilters(track({ energy: 2 }), f)).toBe(false);
    expect(trackMatchesFilters(track({ filename: 'other.wav', energy: 4 }), f)).toBe(false);
  });
});
