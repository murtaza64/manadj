/**
 * Adjacency model (sets 02, revised by sets 26): plan-time resolution,
 * Hard-cut pins, badges, evidence. Expected values are independent
 * literals — never recomputed through the code under test.
 */
import { describe, expect, it } from 'vitest';
import { adjacencyView, resolvePlanPins, resolveTransition } from './adjacency';
import type { AdjacencyPin, TakeEvidence, TransitionEvidence } from './adjacency';

function tr(uuid: string, over: Partial<TransitionEvidence> = {}): TransitionEvidence {
  return { uuid, name: `Transition ${uuid}`, favorite: false, ...over };
}

function tk(uuid: string): TakeEvidence {
  return { uuid, detectedAt: '2026-07-05T12:00:00' };
}

describe('resolveTransition (sets 26: favorite first, else most recently edited)', () => {
  it('picks the favorite when one exists', () => {
    const picked = resolveTransition([tr('a'), tr('b', { favorite: true })]);
    expect(picked?.uuid).toBe('b');
  });

  it('picks the most recently edited favorite among several', () => {
    const picked = resolveTransition([
      tr('a', { favorite: true, updatedAtMs: 1000 }),
      tr('b', { favorite: true, updatedAtMs: 3000 }),
      tr('c', { updatedAtMs: 9000 }),
    ]);
    expect(picked?.uuid).toBe('b');
  });

  it('picks the most recently edited when no favorite exists', () => {
    const picked = resolveTransition([
      tr('a', { updatedAtMs: 2000 }),
      tr('b', { updatedAtMs: 5000 }),
      tr('c', { updatedAtMs: 1000 }),
    ]);
    expect(picked?.uuid).toBe('b');
  });

  it('resolves the sole Transition (no longer ambiguous-averse: several unfavorited siblings still resolve)', () => {
    expect(resolveTransition([tr('only')])?.uuid).toBe('only');
    // Two unfavorited siblings: most recently edited wins — the sets 02
    // "ambiguous → nothing" rule is retired by 26.
    const picked = resolveTransition([tr('a', { updatedAtMs: 1 }), tr('b', { updatedAtMs: 2 })]);
    expect(picked?.uuid).toBe('b');
  });

  it('breaks recency ties toward the later sibling (append order = creation order)', () => {
    expect(resolveTransition([tr('a'), tr('b')])?.uuid).toBe('b');
    expect(resolveTransition([tr('a', { updatedAtMs: 7 }), tr('b', { updatedAtMs: 7 })])?.uuid).toBe('b');
  });

  it('treats a missing edit stamp as oldest', () => {
    const picked = resolveTransition([tr('a', { updatedAtMs: 5 }), tr('unstamped')]);
    expect(picked?.uuid).toBe('a');
  });

  it('resolves nothing when the pair has no Transitions (the only remaining cut-by-default)', () => {
    expect(resolveTransition([])).toBeNull();
  });
});

describe('resolvePlanPins (sets 26: the plan-input resolution seam)', () => {
  const evidence: Record<string, TransitionEvidence[]> = {
    '1:2': [tr('x', { updatedAtMs: 1 }), tr('y', { updatedAtMs: 2 })],
    '2:3': [],
  };
  const evidenceFor = (a: number, b: number) => evidence[`${a}:${b}`] ?? [];

  it('resolves an unpinned adjacency to the pair’s best Transition', () => {
    const out = resolvePlanPins(
      [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toEqual({ kind: 'transition', uuid: 'y' });
  });

  it('leaves an unpinned adjacency null when the pair has no Transitions (hard cut)', () => {
    const out = resolvePlanPins(
      [
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toBeNull();
  });

  it('never overrides a Transition pin — resolution respects the freeze', () => {
    const pin: AdjacencyPin = { kind: 'transition', uuid: 'x' };
    const out = resolvePlanPins(
      [
        { trackId: 1, pin },
        { trackId: 2, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toEqual({ kind: 'transition', uuid: 'x' });
  });

  it('never overrides a Take pin (Takes never auto-resolve)', () => {
    const pin: AdjacencyPin = { kind: 'take', uuid: 't1' };
    const out = resolvePlanPins(
      [
        { trackId: 1, pin },
        { trackId: 2, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toEqual({ kind: 'take', uuid: 't1' });
  });

  it('passes an explicit Hard-cut pin through untouched (forces the cut past available Transitions)', () => {
    const pin: AdjacencyPin = { kind: 'hardcut' };
    const out = resolvePlanPins(
      [
        { trackId: 1, pin },
        { trackId: 2, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toEqual({ kind: 'hardcut' });
  });

  it('re-resolves a dangling Transition pin like an unpinned adjacency', () => {
    const pin: AdjacencyPin = { kind: 'transition', uuid: 'deleted' };
    const out = resolvePlanPins(
      [
        { trackId: 1, pin },
        { trackId: 2, pin: null },
      ],
      evidenceFor
    );
    expect(out[0].pin).toEqual({ kind: 'transition', uuid: 'y' });
  });

  it('leaves the last entry’s pin alone (it heads no adjacency)', () => {
    const out = resolvePlanPins([{ trackId: 1, pin: null }], evidenceFor);
    expect(out[0].pin).toBeNull();
  });

  it('preserves extra entry fields (generic over the entry shape)', () => {
    const out = resolvePlanPins(
      [
        { trackId: 1, pin: null, extra: 7 },
        { trackId: 2, pin: null, extra: 8 },
      ],
      evidenceFor
    );
    expect(out[0]).toEqual({ trackId: 1, pin: { kind: 'transition', uuid: 'y' }, extra: 7 });
  });
});

describe('adjacencyView', () => {
  it('is unresolved and unpracticed with no pin and no evidence', () => {
    const v = adjacencyView(null, [], []);
    expect(v.status).toBe('unresolved');
    expect(v.unpracticed).toBe(true);
    expect(v.counts).toEqual({ transitions: 0, takes: 0 });
  });

  it('auto-resolves an unpinned adjacency to the pair’s best Transition (sets 26)', () => {
    const v = adjacencyView(null, [tr('a', { updatedAtMs: 1 }), tr('b', { updatedAtMs: 2 })], []);
    expect(v.status).toBe('transition');
    expect(v.auto).toBe(true);
    expect(v.transition?.uuid).toBe('b');
  });

  it('resolves a Transition pin to its evidence row, marked pinned (not auto)', () => {
    const v = adjacencyView({ kind: 'transition', uuid: 'b' }, [tr('a'), tr('b', { favorite: true })], []);
    expect(v.status).toBe('transition');
    expect(v.auto).toBe(false);
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

  it('an explicit Hard-cut pin cuts despite available Transitions', () => {
    const v = adjacencyView({ kind: 'hardcut' }, [tr('a')], [tk('t1')]);
    expect(v.status).toBe('hardcut');
    expect(v.transition).toBeUndefined();
    expect(v.unpracticed).toBe(false);
  });

  it('a dangling Transition pin re-resolves against the remaining evidence', () => {
    const v = adjacencyView({ kind: 'transition', uuid: 'deleted' }, [tr('other')], []);
    expect(v.status).toBe('transition');
    expect(v.auto).toBe(true);
    expect(v.transition?.uuid).toBe('other');
  });

  it('a dangling Transition pin with no evidence degrades to unresolved', () => {
    const v = adjacencyView({ kind: 'transition', uuid: 'deleted' }, [], []);
    expect(v.status).toBe('unresolved');
    expect(v.transition).toBeUndefined();
  });

  it('a dangling Take pin degrades to unresolved (the planner cuts — never auto-swap a manual act)', () => {
    const v = adjacencyView({ kind: 'take', uuid: 'deleted' }, [tr('a')], [tk('t1')]);
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
