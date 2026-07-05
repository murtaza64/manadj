/**
 * Adjacency model (sets 02): pin resolution, auto-fill, badges, evidence.
 * Expected values are independent literals — never recomputed through the
 * code under test.
 */
import { describe, expect, it } from 'vitest';
import { adjacencyView, autoFillProposal } from './adjacency';
import type { TakeEvidence, TransitionEvidence } from './adjacency';

function tr(uuid: string, over: Partial<TransitionEvidence> = {}): TransitionEvidence {
  return { uuid, name: `Transition ${uuid}`, favorite: false, ...over };
}

function tk(uuid: string): TakeEvidence {
  return { uuid, detectedAt: '2026-07-05T12:00:00' };
}

describe('autoFillProposal', () => {
  it('proposes the first favorite when any exist', () => {
    const proposal = autoFillProposal([tr('a'), tr('b', { favorite: true }), tr('c', { favorite: true })]);
    expect(proposal?.uuid).toBe('b');
  });

  it('proposes the sole Transition when there is exactly one', () => {
    expect(autoFillProposal([tr('only')])?.uuid).toBe('only');
  });

  it('proposes nothing for multiple unfavorited Transitions (ambiguous)', () => {
    expect(autoFillProposal([tr('a'), tr('b')])).toBeNull();
  });

  it('proposes nothing when the pair has no Transitions', () => {
    // Takes are never auto-filled — the function does not even see them
    // (pinning a Take is always a manual act, PRD).
    expect(autoFillProposal([])).toBeNull();
  });
});

describe('adjacencyView', () => {
  it('is unresolved and unpracticed with no pin and no evidence', () => {
    const v = adjacencyView(null, [], []);
    expect(v.status).toBe('unresolved');
    expect(v.unpracticed).toBe(true);
    expect(v.counts).toEqual({ transitions: 0, takes: 0 });
  });

  it('unresolved and unpracticed are orthogonal: evidence without a pin', () => {
    const v = adjacencyView(null, [tr('a')], [tk('t1')]);
    expect(v.status).toBe('unresolved');
    expect(v.unpracticed).toBe(false);
    expect(v.counts).toEqual({ transitions: 1, takes: 1 });
  });

  it('resolves a Transition pin to its evidence row', () => {
    const v = adjacencyView({ kind: 'transition', uuid: 'b' }, [tr('a'), tr('b', { favorite: true })], []);
    expect(v.status).toBe('transition');
    expect(v.transition?.uuid).toBe('b');
    expect(v.transition?.favorite).toBe(true);
    expect(v.unpracticed).toBe(false);
  });

  it('resolves a Take pin (manual act) distinctly from unresolved', () => {
    const v = adjacencyView({ kind: 'take', uuid: 't1' }, [], [tk('t1')]);
    expect(v.status).toBe('take');
    expect(v.take?.uuid).toBe('t1');
    // A pinned Take means the pair was mixed at least once.
    expect(v.unpracticed).toBe(false);
  });

  it('a dangling Transition pin degrades to unresolved (never breaks)', () => {
    const v = adjacencyView({ kind: 'transition', uuid: 'deleted' }, [tr('other')], []);
    expect(v.status).toBe('unresolved');
    expect(v.transition).toBeUndefined();
  });

  it('a dangling Take pin degrades to unresolved', () => {
    const v = adjacencyView({ kind: 'take', uuid: 'deleted' }, [], [tk('t1')]);
    expect(v.status).toBe('unresolved');
  });

  it('unpracticed appears exactly when zero Transitions AND zero Takes', () => {
    expect(adjacencyView(null, [tr('a')], []).unpracticed).toBe(false);
    expect(adjacencyView(null, [], [tk('t1')]).unpracticed).toBe(false);
    expect(adjacencyView(null, [], []).unpracticed).toBe(true);
  });

  it('evidence counts mirror the pair evidence lists', () => {
    const v = adjacencyView(null, [tr('a'), tr('b')], [tk('t1'), tk('t2'), tk('t3')]);
    expect(v.counts).toEqual({ transitions: 2, takes: 3 });
  });
});
