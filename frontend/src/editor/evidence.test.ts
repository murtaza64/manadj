/**
 * Unified evidence cycle (gh#167) — pure ordering, dedupe, and pin-follow
 * rules under vitest. No DOM.
 */
import { describe, expect, it } from 'vitest';
import { defaultMix } from './mixModel';
import type { SavedTransition } from './pairStore';
import {
  activeEvidenceRef,
  buildEvidenceCycle,
  findEvidenceIndex,
  pinFollowUpdate,
} from './evidence';
import type { EvidenceItem, SetEditContext } from './evidence';

const saved = (uuid: string, name: string, favorite = false): SavedTransition => ({
  uuid,
  name,
  favorite,
  transition: { ...defaultMix().transition, durationSec: 8 },
});

/** Untouched default shape + default name — pairStore's isPristine. */
const pristine = (uuid: string, n = 1): SavedTransition => ({
  uuid,
  name: `Transition ${n}`,
  transition: defaultMix().transition,
});

const take = (uuid: string, detectedAt: string, promoted: string | null = null) => ({
  uuid,
  detectedAt,
  promotedTransitionUuid: promoted,
});

const ids = (items: EvidenceItem[]) => items.map((it) => `${it.kind}:${it.uuid}`);

describe('buildEvidenceCycle ordering', () => {
  it('saved first with favorites leading, then takes recent-first', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one'), saved('t2', 'two', true), saved('t3', 'three')],
      takes: [take('k-old', '2026-08-01T10:00:00'), take('k-new', '2026-08-20T10:00:00')],
      takeDraft: null,
    });
    expect(ids(cycle)).toEqual([
      'transition:t2', // favorite leads
      'transition:t1',
      'transition:t3',
      'take:k-new', // recent-first
      'take:k-old',
    ]);
  });

  it('promoted takes are excluded (their transition is the saved entry)', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one')],
      takes: [take('k1', '2026-08-01T10:00:00', 't1'), take('k2', '2026-08-02T10:00:00')],
      takeDraft: null,
    });
    expect(ids(cycle)).toEqual(['transition:t1', 'take:k2']);
  });

  it('the under-review draft rides as its take, never doubled as a session item', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one'), { ...saved('item-x', 'Take'), favorite: false }],
      takes: [take('k1', '2026-08-01T10:00:00')],
      takeDraft: { takeUuid: 'k1', itemUuid: 'item-x' },
    });
    expect(ids(cycle)).toEqual(['transition:t1', 'take:k1']);
  });

  it('an under-review take is cyclable even before the takes query resolves', () => {
    const cycle = buildEvidenceCycle({
      saved: [{ ...saved('item-x', 'Take') }],
      takes: [],
      takeDraft: { takeUuid: 'k1', itemUuid: 'item-x' },
    });
    expect(ids(cycle)).toEqual(['take:k1']);
  });

  it('set context: the anchor sorts first; pinned tracks the live pin independently', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one'), saved('t2', 'two', true)],
      takes: [take('k1', '2026-08-01T10:00:00')],
      takeDraft: null,
      anchor: { kind: 'take', uuid: 'k1' },
      livePin: { kind: 'transition', uuid: 't1' },
    });
    expect(ids(cycle)).toEqual(['take:k1', 'transition:t2', 'transition:t1']);
    expect(cycle.map((it) => it.pinned)).toEqual([false, false, true]);
  });

  it('pristine sketches cycle but are never pinnable', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one'), pristine('p1', 2)],
      takes: [],
      takeDraft: null,
    });
    expect(cycle.find((it) => it.uuid === 'p1')?.pinnable).toBe(false);
    expect(cycle.find((it) => it.uuid === 't1')?.pinnable).toBe(true);
  });
});

describe('active evidence resolution', () => {
  it('reads the active session item, as its take when it IS the draft', () => {
    const items = [saved('t1', 'one'), saved('item-x', 'Take')];
    expect(activeEvidenceRef({ items, active: 0 }, null)).toEqual({
      kind: 'transition',
      uuid: 't1',
    });
    expect(
      activeEvidenceRef({ items, active: 1 }, { takeUuid: 'k1', itemUuid: 'item-x' })
    ).toEqual({ kind: 'take', uuid: 'k1' });
  });

  it('findEvidenceIndex matches kind + uuid', () => {
    const cycle = buildEvidenceCycle({
      saved: [saved('t1', 'one')],
      takes: [take('t1', '2026-08-01T10:00:00')], // same uuid, other kind
      takeDraft: null,
    });
    expect(findEvidenceIndex(cycle, { kind: 'take', uuid: 't1' })).toBe(1);
    expect(findEvidenceIndex(cycle, { kind: 'transition', uuid: 't1' })).toBe(0);
    expect(findEvidenceIndex(cycle, null)).toBe(-1);
  });
});

describe('pin-follow (gh#167)', () => {
  const ctx: SetEditContext = { setId: 5, headTrackId: 11, pairKey: '11:12', anchor: null };
  const item: EvidenceItem = {
    kind: 'take',
    uuid: 'k1',
    favorite: false,
    pinned: false,
    pinnable: true,
  };

  it('in set context, switching returns the pin update for the head track', () => {
    expect(pinFollowUpdate(ctx, '11:12', item)).toEqual({
      setId: 5,
      headTrackId: 11,
      pin: { kind: 'take', uuid: 'k1' },
    });
    expect(
      pinFollowUpdate(ctx, '11:12', { ...item, kind: 'transition', uuid: 't1' })
    ).toEqual({ setId: 5, headTrackId: 11, pin: { kind: 'transition', uuid: 't1' } });
  });

  it('outside set context, switching never touches a Set', () => {
    expect(pinFollowUpdate(null, '11:12', item)).toBeNull();
  });

  it('a re-assigned or swapped pair deactivates the context (pairKey guard)', () => {
    expect(pinFollowUpdate(ctx, '12:11', item)).toBeNull();
    expect(pinFollowUpdate(ctx, null, item)).toBeNull();
  });

  it('unpinnable targets (pristine sketches) never move the pin', () => {
    expect(pinFollowUpdate(ctx, '11:12', { ...item, pinnable: false })).toBeNull();
  });
});
