import { expect, it } from 'vitest';
import type { Track } from '../types';
import { FollowRanking } from './rankedFollow';

const track = (id: number, fields: Partial<Track> = {}) => ({
  id, tags: [], key: 19, artist: '', bpm: 120, energy: 3, ...fields,
}) as Track;

it('shares factual ranks across admission, ordering, grouping and decoration', () => {
  const reference = track(1);
  const strong = track(2);
  const weak = track(3, { key: 17 });
  const known = track(4, { key: 9 });
  const rejected = track(5, { key: 9 });
  const source = [weak, rejected, strong, known, reference];
  const follow = new FollowRanking().derive([
    { track: reference, candidates: source, known: new Map([[4, 1]]) },
  ], { knownOnly: false, bpmThresholdPercent: 5 });
  const ordered = follow.project(source, true, 0, 0);
  expect(ordered.map(t => t.id)).toEqual([1, 4, 2, 3]);
  expect(follow.scoreFor!(strong)).toBe(50);
  expect(follow.scoreFor!(weak)).toBe(40);
  expect(follow.scoreFor!(known)).toBeNull();
  expect(follow.groupLabelFor!(reference)).toBe('Following');
  expect(follow.groupLabelFor!(strong)).toBe('Compatible');
  expect(follow.matchSignalsFor!(strong)).toEqual({ key: true, tagIds: new Set() });
  expect(follow.project(source, true, 0, 0)).toBe(ordered);
  expect(follow.project(source, false, 0, 0).map(t => t.id)).toEqual([1, 4, 3, 2]);
  follow.project(source, true, 1, 12);
  expect(follow.scoreFor!(strong)).toBe(50);
  const signals = follow.matchSignalsFor!(strong);
  const reloaded = source.map(t => ({ ...t, title: 'Fresh row from a column-sort query' }));
  const sorted = follow.project(reloaded, false, 0, 0);
  expect(sorted.map(t => t.id)).toEqual([1, 4, 3, 2]);
  expect(sorted[3]).toBe(reloaded[2]); // Display the new row, not its cached metadata object.
  expect(follow.matchSignalsFor!(reloaded[2])).toBe(signals);
});

it('shares best-reference ranking policy while unioning matching signals', () => {
  const a = track(1, { key: 19, energy: 1 });
  const b = track(2, { key: 17, energy: 3 });
  const candidate = track(3, { key: 17 });
  const follow = new FollowRanking().derive([
    { track: a, candidates: [candidate], known: new Map([[3, 2]]) },
    { track: b, candidates: [candidate], known: new Map([[3, 0]]) },
  ], { knownOnly: false, bpmThresholdPercent: 5 });
  expect(follow.groupLabelFor!(candidate)).toBe('\u2605 Favorited transition');
  expect(follow.matchSignalsFor!(candidate).key).toBe(true);
  const compatible = new FollowRanking().derive([
    { track: a, candidates: [candidate], known: new Map() },
    { track: b, candidates: [candidate], known: new Map() },
  ], { knownOnly: false, bpmThresholdPercent: 5 });
  expect(compatible.scoreFor!(candidate)).toBe(50);
});

it('keeps per-reference gate and affinity together and distinguishes unresolved from empty', () => {
  const a = track(1), b = track(2, { key: 9 });
  const candidate = track(3, { key: 9 });
  const source = [candidate, a, b];
  const ranking = new FollowRanking();
  const params = { knownOnly: false, bpmThresholdPercent: 5 };
  const input = [{ track: a, candidates: [candidate], known: new Map<number, number>() },
    { track: b, candidates: undefined, known: new Map<number, number>() }];
  expect(ranking.derive(input, params).project(source, true, 0, 0).map(t => t.id)).toEqual([1, 2]);
  const unresolved = ranking.derive(input.map(r => ({ ...r, candidates: undefined })), params);
  expect(unresolved.project(source, true, 0, 0).map(t => t.id)).toEqual([1, 2, 3]);
  expect(unresolved.groupLabelFor!(candidate)).toBe('Library');
  const empty = ranking.derive(input.map(r => ({ ...r, candidates: [] })), params);
  expect(empty.project(source, true, 0, 0).map(t => t.id)).toEqual([1, 2]);
});

it('invalidates same-ID metadata and Known changes without changing historical snapshots', () => {
  const reference = track(1), candidate = track(2);
  const cache = new FollowRanking();
  const params = { knownOnly: false, bpmThresholdPercent: 5 };
  const before = cache.derive([{ track: reference, candidates: [candidate], known: new Map() }], params);
  const edited = { ...candidate, key: 9 };
  const after = cache.derive([{ track: reference, candidates: [edited], known: new Map() }], params);
  expect(before.project([candidate], true, 0, 0)).toEqual([candidate]);
  expect(after.project([edited], true, 0, 0)).toEqual([]);
  const linked = cache.derive([{ track: reference, candidates: [], known: new Map([[2, 1]]) }], params);
  expect(linked.project([edited], true, 0, 0)).toEqual([edited]);
  expect(linked.scoreFor!(edited)).toBeNull();
  const editedReference = { ...reference, key: 9 };
  const matched = cache.derive([{ track: editedReference, candidates: [edited], known: new Map() }], params);
  expect(matched.scoreFor!(edited)).toBe(50);
});

it('keeps Known-only independent of query readiness and preserves reference pin order', () => {
  const a = track(1), b = track(2), c = track(3);
  const cache = new FollowRanking();
  const follow = cache.derive([
    { track: b, candidates: undefined, known: new Map([[3, 2]]) },
    { track: a, candidates: undefined, known: new Map() },
    { track: b, candidates: undefined, known: new Map() },
  ], { knownOnly: true, bpmThresholdPercent: 5 });
  expect(follow.project([a, c, b], true, 1, 0).map(t => t.id)).toEqual([2, 1, 3]);
});
