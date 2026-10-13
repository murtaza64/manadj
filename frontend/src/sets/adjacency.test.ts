/**
 * Adjacency model (sets 02, revised by sets 26): plan-time resolution,
 * Hard-cut pins, badges, evidence. Expected values are independent
 * literals — never recomputed through the code under test.
 */
import { describe, expect, it } from 'vitest';
import {
  adjacencyView,
  isChopTake,
  resolveFromEvidence,
  resolvePlanPins,
  resolveTake,
  resolveTransition,
  routineCoverage,
  routineOfferable,
} from './adjacency';
import type { AdjacencyPin, TakeEvidence, TransitionEvidence } from './adjacency';

function tr(uuid: string, over: Partial<TransitionEvidence> = {}): TransitionEvidence {
  return { uuid, name: `Transition ${uuid}`, favorite: false, ...over };
}

function tk(uuid: string, over: Partial<TakeEvidence> = {}): TakeEvidence {
  return { uuid, detectedAt: '2026-07-05T12:00:00', ...over };
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

describe('isChopTake (sets #163: sub-2s windows are fader chops)', () => {
  it('flags a sub-2s window', () => {
    expect(isChopTake(tk('a', { windowS: 0.4 }))).toBe(true);
    expect(isChopTake(tk('a', { windowS: 1.99 }))).toBe(true);
  });

  it('does not flag a 2s-or-longer window', () => {
    expect(isChopTake(tk('a', { windowS: 2 }))).toBe(false);
    expect(isChopTake(tk('a', { windowS: 32 }))).toBe(false);
  });

  it('never flags an unknown window (treated as full-length)', () => {
    expect(isChopTake(tk('a'))).toBe(false);
  });
});

describe('resolveTake (sets #163: best Take for the bulk gesture)', () => {
  it('picks the most recent detection', () => {
    const picked = resolveTake([
      tk('a', { detectedAt: '2026-07-01T12:00:00', windowS: 10 }),
      tk('b', { detectedAt: '2026-07-03T12:00:00', windowS: 10 }),
      tk('c', { detectedAt: '2026-07-02T12:00:00', windowS: 10 }),
    ]);
    expect(picked?.uuid).toBe('b');
  });

  it('full-length Takes outrank chop-Takes, even more recent ones', () => {
    const picked = resolveTake([
      tk('full', { detectedAt: '2026-07-01T12:00:00', windowS: 12 }),
      tk('chop', { detectedAt: '2026-07-09T12:00:00', windowS: 0.4 }),
    ]);
    expect(picked?.uuid).toBe('full');
  });

  it('resolves the best chop-Take when only chops exist', () => {
    const picked = resolveTake([
      tk('c1', { detectedAt: '2026-07-01T12:00:00', windowS: 0.3 }),
      tk('c2', { detectedAt: '2026-07-02T12:00:00', windowS: 0.5 }),
    ]);
    expect(picked?.uuid).toBe('c2');
  });

  it('breaks detection-time ties toward the later sibling (append order = capture order)', () => {
    expect(resolveTake([tk('a'), tk('b')])?.uuid).toBe('b');
  });

  it('resolves nothing when the pair has no Takes', () => {
    expect(resolveTake([])).toBeNull();
  });
});

describe('resolveFromEvidence (sets #163: the previewed bulk gesture)', () => {
  const NONE = { transitions: [], takes: [] };

  it('proposes the best Take on an Unresolved adjacency with Takes and no Transitions', () => {
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      () => ({ transitions: [], takes: [tk('t1', { windowS: 10 })] })
    );
    expect(out.pins.get(1)).toEqual({ kind: 'take', uuid: 't1' });
    expect(out.rows).toEqual([
      {
        headTrackId: 1,
        aTrackId: 1,
        bTrackId: 2,
        take: tk('t1', { windowS: 10 }),
        chop: false,
      },
    ]);
    expect(out.hardCuts).toEqual([]);
  });

  it('skips a pair whose Transitions auto-resolve (saved Transitions win — auto-fill unchanged)', () => {
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      () => ({ transitions: [tr('x')], takes: [tk('t1', { windowS: 10 })] })
    );
    expect(out.pins.size).toBe(0);
    expect(out.rows).toEqual([]);
    expect(out.hardCuts).toEqual([]);
  });

  it('never touches an existing pin — any kind, even dangling', () => {
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: { kind: 'take', uuid: 'kept' } as AdjacencyPin },
        { trackId: 2, pin: { kind: 'hardcut' } as AdjacencyPin },
        { trackId: 3, pin: { kind: 'transition', uuid: 'dangling' } as AdjacencyPin },
        { trackId: 4, pin: null },
      ],
      () => ({ transitions: [], takes: [tk('t1', { windowS: 10 })] })
    );
    expect(out.pins.size).toBe(0);
    expect(out.rows).toEqual([]);
  });

  it('flags a chop-Take proposal (pinned but marked)', () => {
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      () => ({ transitions: [], takes: [tk('c1', { windowS: 0.4 })] })
    );
    expect(out.pins.get(1)).toEqual({ kind: 'take', uuid: 'c1' });
    expect(out.rows[0].chop).toBe(true);
  });

  it('lists an evidence-less Unresolved adjacency as a remaining hard-cut', () => {
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: null },
        { trackId: 2, pin: null },
      ],
      () => NONE
    );
    expect(out.pins.size).toBe(0);
    expect(out.hardCuts).toEqual([{ aTrackId: 1, bTrackId: 2 }]);
  });

  it('walks adjacencies in Set order and keys pins by head track id', () => {
    const evidence: Record<string, { transitions: TransitionEvidence[]; takes: TakeEvidence[] }> = {
      '1:2': { transitions: [], takes: [tk('t12', { windowS: 8 })] },
      '2:3': { transitions: [tr('x')], takes: [] },
      '3:4': { transitions: [], takes: [tk('t34', { windowS: 0.5 })] },
      '4:5': { transitions: [], takes: [] },
    };
    const out = resolveFromEvidence(
      [1, 2, 3, 4, 5].map((trackId) => ({ trackId, pin: null })),
      (a, b) => evidence[`${a}:${b}`] ?? NONE
    );
    expect([...out.pins.keys()]).toEqual([1, 3]);
    expect(out.rows.map((r) => r.take.uuid)).toEqual(['t12', 't34']);
    expect(out.rows.map((r) => r.chop)).toEqual([false, true]);
    expect(out.hardCuts).toEqual([{ aTrackId: 4, bTrackId: 5 }]);
  });

  it('an empty or single-entry Set proposes nothing (no adjacencies)', () => {
    expect(resolveFromEvidence([], () => NONE).rows).toEqual([]);
    expect(resolveFromEvidence([{ trackId: 1, pin: null }], () => NONE).hardCuts).toEqual([]);
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

// ── Routine pins (sets 160, ADR 0035) ──────────────────────────────────

describe('routineOfferable (sets 160)', () => {
  it('offers exactly when the cast is the next n entries: membership + both boundaries', () => {
    expect(routineOfferable([1, 2, 3, 4], 0, [1, 2, 3])).toBe(true);
    // Interior order is presentational — membership decides.
    expect(routineOfferable([1, 3, 2, 4, 5], 0, [1, 2, 3, 4])).toBe(true);
  });

  it('rejects a wrong entry or exit boundary', () => {
    expect(routineOfferable([2, 1, 3], 0, [1, 2, 3])).toBe(false); // enters on 2
    expect(routineOfferable([1, 3, 2, 4], 0, [1, 2, 3])).toBe(false); // exits mid-run
  });

  it('rejects wrong membership, a short tail, and n < 3', () => {
    expect(routineOfferable([1, 2, 9, 3], 0, [1, 2, 3])).toBe(false);
    expect(routineOfferable([1, 2], 0, [1, 2, 3])).toBe(false);
    expect(routineOfferable([1, 2, 3], 0, [1, 2])).toBe(false);
  });

  it('offers at a non-zero head index', () => {
    expect(routineOfferable([9, 1, 2, 3], 1, [1, 2, 3])).toBe(true);
  });
});

describe('routineCoverage (sets 160)', () => {
  const castOf = (uuid: string) =>
    uuid === 'r1' ? [1, 2, 3] : uuid === 'rB' ? [3, 4, 5] : null;
  const rentry = (trackId: number, pin: AdjacencyPin | null = null) => ({ trackId, pin });

  it('a live routine covers its adjacencies; others stay null', () => {
    const cov = routineCoverage(
      [rentry(1, { kind: 'routine', uuid: 'r1' }), rentry(2), rentry(3), rentry(4)],
      castOf
    );
    expect(cov[0]?.uuid).toBe('r1');
    expect(cov[1]?.uuid).toBe('r1');
    expect(cov[2]).toBe(null);
    expect(cov[0]?.headIndex).toBe(0);
    expect(cov[0]?.lastEntryIndex).toBe(2);
  });

  it('an unknown or non-matching cast covers nothing', () => {
    const cov = routineCoverage(
      [rentry(1, { kind: 'routine', uuid: 'r-unknown' }), rentry(2), rentry(3)],
      castOf
    );
    expect(cov).toEqual([null, null]);
    const stale = routineCoverage(
      [rentry(1, { kind: 'routine', uuid: 'r1' }), rentry(9), rentry(3)],
      castOf
    );
    expect(stale).toEqual([null, null]);
  });

  it('chained routines cover disjoint adjacencies through the shared boundary track', () => {
    const cov = routineCoverage(
      [
        rentry(1, { kind: 'routine', uuid: 'r1' }),
        rentry(2),
        rentry(3, { kind: 'routine', uuid: 'rB' }),
        rentry(4),
        rentry(5),
      ],
      castOf
    );
    expect(cov.map((c) => c?.uuid ?? null)).toEqual(['r1', 'r1', 'rB', 'rB']);
  });
});

describe('resolvePlanPins — routine pins (sets 160)', () => {
  const castOf = (uuid: string) => (uuid === 'r1' ? [1, 2, 3] : null);
  const noEvidence = () => [];

  it('the head passes through (hard-cut placeholder) and covered interiors become hard cuts', () => {
    const out = resolvePlanPins(
      [
        { trackId: 1, pin: { kind: 'routine' as const, uuid: 'r1' } },
        { trackId: 2, pin: { kind: 'transition' as const, uuid: 'tr-shadowed' } },
        { trackId: 3, pin: null },
        { trackId: 4, pin: null },
      ],
      noEvidence,
      castOf
    );
    expect(out[0].pin).toEqual({ kind: 'routine', uuid: 'r1' });
    expect(out[1].pin).toEqual({ kind: 'hardcut' }); // shadowed pin inert
    expect(out[2].pin).toBe(null); // past the span: untouched
  });

  it('covered interiors never auto-resolve from the library', () => {
    const out = resolvePlanPins(
      [
        { trackId: 1, pin: { kind: 'routine' as const, uuid: 'r1' } },
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
      ],
      () => [{ uuid: 'tr-lib', name: 'lib' }],
      castOf
    );
    expect(out[1].pin).toEqual({ kind: 'hardcut' });
  });

  it('a routine pin with an unknown cast covers nothing and still passes through', () => {
    const out = resolvePlanPins(
      [
        { trackId: 1, pin: { kind: 'routine' as const, uuid: 'r-unknown' } },
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
      ],
      () => [{ uuid: 'tr-lib', name: 'lib' }],
      castOf
    );
    expect(out[0].pin).toEqual({ kind: 'routine', uuid: 'r-unknown' });
    expect(out[1].pin).toEqual({ kind: 'transition', uuid: 'tr-lib' });
  });
});

describe('resolveFromEvidence — routine coverage (sets 160)', () => {
  it('skips covered adjacencies outright (no pins, no hard-cut listing)', () => {
    const castOf = (uuid: string) => (uuid === 'r1' ? [1, 2, 3] : null);
    const takesFor = () => ({
      transitions: [],
      takes: [{ uuid: 'tk-1', detectedAt: '2026-08-01T00:00:00Z', windowS: 10 }],
    });
    const out = resolveFromEvidence(
      [
        { trackId: 1, pin: { kind: 'routine' as const, uuid: 'r1' } },
        { trackId: 2, pin: null },
        { trackId: 3, pin: null },
        { trackId: 4, pin: null },
      ],
      takesFor,
      castOf
    );
    // Only the uncovered (3 → 4) adjacency proposes its Take.
    expect([...out.pins.keys()]).toEqual([3]);
    expect(out.hardCuts).toEqual([]);
  });
});

describe('adjacencyView — routine pins (sets 160)', () => {
  it('a routine pin reports status routine', () => {
    const view = adjacencyView({ kind: 'routine', uuid: 'r1' }, [], []);
    expect(view.status).toBe('routine');
  });
});
