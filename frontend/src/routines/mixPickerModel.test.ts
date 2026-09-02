/**
 * Mix-picker model (#205): page group builders, deck surfacing, scoped
 * sibling cycling, and the chip typeahead filter.
 */
import { describe, expect, it } from 'vitest';
import {
  castIncluding,
  castThroughPair,
  deckSurfacing,
  filterTracks,
  pairCameos,
  pairTakes,
  pairTransitions,
  refKey,
  routinesThroughPair,
  siblingCycle,
  trackLabel,
  trackPage,
  trackTitleShort,
  type TransitionRowLike,
} from './mixPickerModel';
import type { CameoRowWire, RoutineRowWire, TakeRowWire } from '../api/client';

const tr = (
  a: number,
  b: number,
  uuid: string,
  position = 0,
  favorite = false
): TransitionRowLike => ({
  a_track_id: a,
  b_track_id: b,
  uuid,
  position,
  name: uuid,
  favorite,
});

const routine = (uuid: string, cast: number[]): RoutineRowWire => ({
  uuid,
  name: null,
  cast,
  entry_offsets_beats: cast.map((_, i) => i * 16),
  entry_positions: cast.map(() => 0),
  duration_beats: 64,
  origin_take_uuid: null,
  created_at: null,
});

const cameo = (host: number, guest: number, uuid: string, favorite = false): CameoRowWire => ({
  host_track_id: host,
  guest_track_id: guest,
  uuid,
  position: 0,
  name: uuid,
  favorite,
  data: {},
  updated_at: null,
});

const take = (a: number, b: number, uuid: string, at: string, kind = 'handover'): TakeRowWire =>
  ({
    uuid,
    a_track_id: a,
    b_track_id: b,
    detected_at: at,
    window_start_s: 0,
    window_end_s: 20,
    confidence: 1,
    detector_version: 'v',
    promoted_transition_uuid: null,
    session_uuid: 's',
    origin: 'live',
    kind,
    engagement_uuid: null,
  }) as unknown as TakeRowWire;

describe('mixPickerModel — move page groups', () => {
  it('pairTransitions: ordered pair only, favorite-first then position', () => {
    const rows = [
      tr(1, 2, 'plain', 1),
      tr(1, 2, 'fav', 2, true),
      tr(2, 1, 'reverse', 0),
      tr(1, 3, 'other', 0),
    ];
    expect(pairTransitions(rows, 1, 2).map((r) => r.uuid)).toEqual(['fav', 'plain']);
    expect(pairTransitions(rows, 2, 1).map((r) => r.uuid)).toEqual(['reverse']);
  });

  it('pairTakes: pair-scoped, handover kind only, newest-first', () => {
    const takes = [
      take(1, 2, 'old', '2026-01-01T00:00:00'),
      take(1, 2, 'new', '2026-02-01T00:00:00'),
      take(1, 2, 'guest', '2026-03-01T00:00:00', 'guest'),
      take(2, 1, 'reverse', '2026-01-15T00:00:00'),
    ];
    expect(pairTakes(takes, 1, 2).map((t) => t.uuid)).toEqual(['new', 'old']);
  });

  it('pairCameos: ordered (host, guest)', () => {
    const cams = [cameo(1, 2, 'c1'), cameo(2, 1, 'c2'), cameo(1, 1, 'self')];
    expect(pairCameos(cams, 1, 2).map((c) => c.uuid)).toEqual(['c1']);
    expect(pairCameos(cams, 1, 1).map((c) => c.uuid)).toEqual(['self']);
  });

  it('routinesThroughPair: cast contains a immediately followed by b', () => {
    const rs = [
      routine('adjacent', [5, 1, 2, 9]),
      routine('gap', [1, 5, 2]),
      routine('reversed', [2, 1, 5]),
    ];
    expect(routinesThroughPair(rs, 1, 2).map((r) => r.uuid)).toEqual(['adjacent']);
  });

  it('castThroughPair/castIncluding: cast-generic (takes + candidates surface too)', () => {
    const rows = [
      { uuid: 'x', cast: [3, 1, 2] },
      { uuid: 'y', cast: [2, 1] },
      { uuid: 'z', cast: [4, 5] },
    ];
    expect(castThroughPair(rows, 1, 2).map((r) => r.uuid)).toEqual(['x']);
    expect(castIncluding(rows, 1).map((r) => r.uuid)).toEqual(['x', 'y']);
  });
});

describe('mixPickerModel — track page (1 chip)', () => {
  it('splits out-of / into / over / guesting / through', () => {
    const transitions = [tr(1, 2, 'out'), tr(3, 1, 'in'), tr(4, 5, 'unrelated')];
    const cams = [cameo(1, 9, 'hosts'), cameo(9, 1, 'guests'), cameo(1, 1, 'self')];
    const rs = [routine('has', [7, 1, 8]), routine('not', [7, 8])];
    const page = trackPage(1, transitions, cams, rs);
    expect(page.outOf.map((r) => r.uuid)).toEqual(['out']);
    expect(page.into.map((r) => r.uuid)).toEqual(['in']);
    expect(page.over.map((c) => c.uuid)).toEqual(['hosts', 'self']);
    expect(page.guesting.map((c) => c.uuid)).toEqual(['guests']);
    expect(page.through.map((r) => r.uuid)).toEqual(['has']);
  });
});

describe('mixPickerModel — cold-open deck surfacing', () => {
  it('transitions between loaded pairs (both roles loaded); routines whose cast intersects', () => {
    const transitions = [tr(1, 2, 'both'), tr(1, 9, 'half'), tr(8, 9, 'neither')];
    const rs = [routine('hit', [9, 2, 7]), routine('miss', [8, 9])];
    const s = deckSurfacing([1, 2, 7], transitions, rs);
    expect(s.transitions.map((r) => r.uuid)).toEqual(['both']);
    expect(s.routines.map((r) => r.uuid)).toEqual(['hit']);
  });
});

describe('mixPickerModel — scoped sibling cycling', () => {
  it('a transition cycles the ordered pair favorite-first, with its own index', () => {
    const rows = [tr(1, 2, 'plain', 1), tr(1, 2, 'fav', 2, true), tr(2, 1, 'reverse', 0)];
    const { refs, index } = siblingCycle(
      { kind: 'transition', aTrackId: 1, bTrackId: 2, uuid: 'plain' },
      rows,
      []
    );
    expect(refs.map(refKey)).toEqual(['transition:fav', 'transition:plain']);
    expect(index).toBe(1);
  });

  it('a routine cycles routines sharing the exact cast', () => {
    const rs = [routine('r1', [1, 2, 3]), routine('r2', [1, 2, 3]), routine('other', [1, 2])];
    const { refs, index } = siblingCycle({ kind: 'routine', uuid: 'r2' }, [], rs);
    expect(refs.map(refKey)).toEqual(['routine:r1', 'routine:r2']);
    expect(index).toBe(1);
  });
});

describe('mixPickerModel — chip typeahead', () => {
  const tracks = [
    { id: 1, artist: 'Nero', title: 'Innocence' },
    { id: 2, artist: 'Sub Focus', title: 'Solar System' },
    { id: 3, filename: 'nero_-_the_thrill.mp3' },
  ];
  it('matches artist/title/filename, case-insensitive, capped', () => {
    expect(filterTracks(tracks, 'nero').map((t) => t.id)).toEqual([1, 3]);
    expect(filterTracks(tracks, 'SOLAR').map((t) => t.id)).toEqual([2]);
    expect(filterTracks(tracks, '')).toEqual([]);
    expect(filterTracks(tracks, 'nero', 1).map((t) => t.id)).toEqual([1]);
  });
  it('labels artist – title, falls back to filename/#id', () => {
    expect(trackLabel(tracks[0])).toBe('Nero – Innocence');
    expect(trackLabel(tracks[2])).toBe('nero_-_the_thrill.mp3');
    expect(trackLabel({ id: 9 })).toBe('#9');
  });
  it('trackTitleShort: title only, 15 chars max with ellipsis', () => {
    expect(trackTitleShort(tracks[0])).toBe('Innocence');
    expect(trackTitleShort({ id: 1, artist: 'X', title: 'A Very Long Track Title Indeed' })).toBe(
      'A Very Long Tra…'
    );
    expect(trackTitleShort({ id: 9 })).toBe('#9');
  });
});
