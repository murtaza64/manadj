/**
 * Dormant pins (sets 07) — pure functions under vitest.
 *
 * Reordering (or removal) never destroys a pin: `reconcileOrderChange`
 * is the single rule for what happens to pins when a Set's track order
 * changes. Kept exported and pure on purpose — issue 18's multi-row
 * blocks reuse the same restore/degrade logic.
 */
import { describe, expect, it } from 'vitest';
import type { AdjacencyPin } from './adjacency';
import {
  previewAdjacencyFutures,
  reconcileOrderChange,
  type DormantPin,
  type OrderedEntry,
} from './dormancy';

const tr = (uuid: string): AdjacencyPin => ({ kind: 'transition', uuid });
const tk = (uuid: string): AdjacencyPin => ({ kind: 'take', uuid });
const en = (trackId: number, pin: AdjacencyPin | null = null): OrderedEntry => ({ trackId, pin });
const dp = (aTrackId: number, bTrackId: number, pin: AdjacencyPin): DormantPin => ({
  aTrackId,
  bTrackId,
  pin,
});

describe('reconcileOrderChange', () => {
  it('keeps a pin whose ordered pair stays adjacent through a reorder', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, tr('tr-1')), en(2), en(3)],
      [],
      [3, 1, 2]
    );
    expect(entries).toEqual([en(3), en(1, tr('tr-1')), en(2)]);
    expect(dormant).toEqual([]);
  });

  it('breaks pins into Dormant pins and restores them when reordered back (Transitions and Takes)', () => {
    const original = [en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)];

    const away = reconcileOrderChange(original, [], [2, 1, 3]);
    expect(away.entries).toEqual([en(2), en(1), en(3)]);
    expect(away.dormant).toEqual([dp(1, 2, tr('tr-1')), dp(2, 3, tk('tk-1'))]);

    const back = reconcileOrderChange(away.entries, away.dormant, [1, 2, 3]);
    expect(back.entries).toEqual([en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)]);
    expect(back.dormant).toEqual([]);
  });

  it('round-trips a Hard-cut pin like any pin (sets 26): breaks Dormant, restores on re-adjacency', () => {
    const hardcut: AdjacencyPin = { kind: 'hardcut' };
    const original = [en(1, hardcut), en(2), en(3)];

    const away = reconcileOrderChange(original, [], [2, 1, 3]);
    expect(away.entries).toEqual([en(2), en(1), en(3)]);
    expect(away.dormant).toEqual([dp(1, 2, hardcut)]);

    const back = reconcileOrderChange(away.entries, away.dormant, [1, 2, 3]);
    expect(back.entries).toEqual([en(1, hardcut), en(2), en(3)]);
    expect(back.dormant).toEqual([]);
  });

  it('is strictly per ordered pair: the reversed pair does not restore', () => {
    const { entries, dormant } = reconcileOrderChange([en(1), en(2)], [dp(2, 1, tr('tr-1'))], [1, 2]);
    expect(entries).toEqual([en(1), en(2)]);
    expect(dormant).toEqual([dp(2, 1, tr('tr-1'))]);
  });

  it('removal breaks both adjacencies around the removed track; re-adding restores', () => {
    const original = [en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)];

    const removed = reconcileOrderChange(original, [], [1, 3]);
    expect(removed.entries).toEqual([en(1), en(3)]);
    expect(removed.dormant).toEqual([dp(1, 2, tr('tr-1')), dp(2, 3, tk('tk-1'))]);

    const restored = reconcileOrderChange(removed.entries, removed.dormant, [1, 2, 3]);
    expect(restored.entries).toEqual([en(1, tr('tr-1')), en(2, tk('tk-1')), en(3)]);
    expect(restored.dormant).toEqual([]);
  });

  it('insert between a pinned pair sends the pin Dormant instead of riding the new adjacency', () => {
    const { entries, dormant } = reconcileOrderChange([en(1, tr('tr-1')), en(2)], [], [1, 9, 2]);
    expect(entries).toEqual([en(1), en(9), en(2)]);
    expect(dormant).toEqual([dp(1, 2, tr('tr-1'))]);
  });

  it('a fresh break overwrites an older Dormant memory for the same pair', () => {
    const { dormant } = reconcileOrderChange(
      [en(1, tr('tr-new')), en(2)],
      [dp(1, 2, tr('tr-old'))],
      [2, 1]
    );
    expect(dormant).toEqual([dp(1, 2, tr('tr-new'))]);
  });

  it('keeps Dormant memories whose tracks left the Set entirely', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(2)],
      [dp(7, 8, tk('tk-7'))],
      [1, 2]
    );
    expect(entries).toEqual([en(1), en(2)]);
    expect(dormant).toEqual([dp(7, 8, tk('tk-7'))]);
  });

  it('ignores a (meaningless) pin on the last entry instead of stashing it', () => {
    const { entries, dormant } = reconcileOrderChange([en(1), en(2, tr('tr-x'))], [], [2, 1]);
    expect(entries).toEqual([en(2), en(1)]);
    expect(dormant).toEqual([]);
  });

  it('restores onto a newly added track (manual pin memory honored on re-add)', () => {
    // Track 2 was removed earlier; its Take pin waits as a Dormant pin.
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(3)],
      [dp(1, 2, tk('tk-1'))],
      [1, 2, 3]
    );
    expect(entries).toEqual([en(1, tk('tk-1')), en(2), en(3)]);
    expect(dormant).toEqual([]);
  });

  it('an active pin on a still-adjacent pair wins over a stale Dormant memory', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, tr('tr-active')), en(2)],
      [dp(1, 2, tr('tr-stale'))],
      [1, 2]
    );
    expect(entries).toEqual([en(1, tr('tr-active')), en(2)]);
    // The stale memory is dropped — a pair never carries two pins.
    expect(dormant).toEqual([]);
  });
});

describe('previewAdjacencyFutures', () => {
  const noTransitions = () => false;

  it('marks unchanged adjacencies null (unaffected by the hypothetical order)', () => {
    const futures = previewAdjacencyFutures(
      [en(1, tr('tr-1')), en(2), en(3)],
      [],
      [1, 2, 3],
      noTransitions
    );
    expect(futures).toEqual([null, null]);
  });

  it('marks a pair with a Dormant pin will-restore', () => {
    const futures = previewAdjacencyFutures(
      [en(2), en(1), en(3)],
      [dp(1, 2, tr('tr-1'))],
      [1, 2, 3],
      noTransitions
    );
    // (2,3) was not adjacent in [2,1,3] either — it is affected too.
    expect(futures).toEqual(['will-restore', 'unresolved']);
  });

  it('marks a new pair with a library Transition auto-resolves, else unresolved', () => {
    const futures = previewAdjacencyFutures(
      [en(1), en(2), en(3)],
      [],
      [2, 1, 3],
      (a, b) => a === 2 && b === 1
    );
    expect(futures).toEqual(['auto-resolves', 'unresolved']);
  });

  it('a Dormant pin outranks an available library Transition (will-restore)', () => {
    const futures = previewAdjacencyFutures(
      [en(1), en(2)],
      [dp(2, 1, tk('tk-1'))],
      [2, 1],
      () => true
    );
    expect(futures).toEqual(['will-restore']);
  });
});

// ── Routine pins (sets 160, ADR 0035) ──────────────────────────────────
// Dormancy keys on the BOUNDARY tracks + cast membership only: interior
// reorder is free; breaking a boundary or the membership sends the pin
// Dormant (keyed entry→exit), restoring when the cast is the next n
// entries again. The head pair's Dormant memory is the SHADOW of the
// pin the routine displaced — kept while the routine rides, woken on
// unpin/Dormant.

const rt = (uuid: string): AdjacencyPin => ({ kind: 'routine', uuid });

describe('reconcileOrderChange — routine pins (sets 160)', () => {
  // Routine r1: cast [1, 2, 3] (enters on 1, exits with 3).
  const castOf = (uuid: string) => (uuid === 'r1' ? [1, 2, 3] : null);

  it('interior reorder is free: the pin rides on its head entry', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('r1')), en(2), en(3), en(4)],
      [],
      [1, 2, 3, 4],
      castOf
    );
    expect(entries[0].pin).toEqual(rt('r1'));
    expect(dormant).toEqual([]);
    // Interior order is presentational — [1,2,3] and [1,2,3] with 2↔…
    // n=3 has one interior member; use a 4-cast routine for the swap:
  });

  it('interior swap keeps a 4-cast routine live (membership + boundaries hold)', () => {
    const castOf4 = (uuid: string) => (uuid === 'r4' ? [1, 2, 3, 4] : null);
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('r4')), en(2), en(3), en(4), en(5)],
      [],
      [1, 3, 2, 4, 5],
      castOf4
    );
    expect(entries[0].pin).toEqual(rt('r4'));
    expect(dormant).toEqual([]);
  });

  it('breaking the exit boundary sends the pin Dormant keyed entry→exit', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('r1')), en(2), en(3), en(4)],
      [],
      [1, 3, 2, 4], // exit (3) no longer last of the run
      castOf
    );
    expect(entries.every((e) => e.pin === null)).toBe(true);
    expect(dormant).toEqual([dp(1, 3, rt('r1'))]);
  });

  it('removing a cast member breaks membership → Dormant; re-adding restores', () => {
    const original = [en(1, rt('r1')), en(2), en(3), en(4)];
    const removed = reconcileOrderChange(original, [], [1, 3, 4], castOf);
    expect(removed.entries.every((e) => e.pin === null)).toBe(true);
    expect(removed.dormant).toEqual([dp(1, 3, rt('r1'))]);

    const restored = reconcileOrderChange(removed.entries, removed.dormant, [1, 2, 3, 4], castOf);
    expect(restored.entries[0].pin).toEqual(rt('r1'));
    expect(restored.dormant).toEqual([]);
  });

  it('a Dormant routine memory never wakes on plain entry/exit adjacency', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(3), en(2)],
      [dp(1, 3, rt('r1'))],
      [1, 3, 2], // 1 and 3 adjacent — but the interior (2) is not between them
      castOf
    );
    expect(entries.every((e) => e.pin === null)).toBe(true);
    expect(dormant).toEqual([dp(1, 3, rt('r1'))]);
  });

  it('keeps the head pair shadow while the routine rides; wakes it when the routine goes Dormant', () => {
    // Shadow: the transition the routine displaced on (1, 2).
    const shadow = dp(1, 2, tr('tr-old'));
    const riding = reconcileOrderChange(
      [en(1, rt('r1')), en(2), en(3), en(4)],
      [shadow],
      [1, 2, 3, 4],
      castOf
    );
    expect(riding.entries[0].pin).toEqual(rt('r1'));
    expect(riding.dormant).toEqual([shadow]); // shadow kept, not dropped

    // Break the routine (remove 3): the routine goes Dormant and the
    // still-adjacent (1, 2) pair wakes its shadowed pin.
    const broken = reconcileOrderChange(riding.entries, riding.dormant, [1, 2, 4], castOf);
    expect(broken.entries[0].pin).toEqual(tr('tr-old'));
    expect(broken.dormant).toEqual([dp(1, 3, rt('r1'))]);
  });

  it('a waking routine outranks a pair-memory restore in the same pass and re-shadows it', () => {
    // Both Dormant: the routine and the pin it once displaced. The cast
    // re-forms in one reorder — the routine wakes first (it displaced
    // that pin; waking re-shadows it), the pair memory stays Dormant.
    const { entries, dormant } = reconcileOrderChange(
      [en(1), en(4), en(2), en(3)],
      [dp(1, 3, rt('r1')), dp(1, 2, tr('tr-old'))],
      [1, 2, 3, 4],
      castOf
    );
    expect(entries[0].pin).toEqual(rt('r1'));
    expect(dormant).toEqual([dp(1, 2, tr('tr-old'))]);
  });

  it('a riding pin — including a woken shadow — blocks the routine wake (never displaced)', () => {
    // The routine went Dormant earlier and its shadow woke onto (1, 2).
    // The cast re-forming does NOT displace the now-riding pin: reconcile
    // cannot tell a woken shadow from a fresh explicit act, and explicit
    // acts are never overwritten.
    const { entries, dormant } = reconcileOrderChange(
      [en(1, tr('tr-old')), en(2), en(4), en(3)],
      [dp(1, 3, rt('r1'))],
      [1, 2, 3, 4],
      castOf
    );
    expect(entries[0].pin).toEqual(tr('tr-old'));
    expect(dormant).toEqual([dp(1, 3, rt('r1'))]);
  });

  it('never displaces an explicit pin that arrived while the routine was Dormant', () => {
    const explicit = tk('tk-new');
    const { entries, dormant } = reconcileOrderChange(
      [en(1, explicit), en(2), en(3)],
      [dp(1, 3, rt('r1'))],
      [1, 2, 3],
      castOf
    );
    expect(entries[0].pin).toEqual(explicit);
    expect(dormant).toEqual([dp(1, 3, rt('r1'))]); // stays Dormant
  });

  it('unknown cast (metadata not loaded): the pin rides on its head entry, never guessed Dormant', () => {
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('r-unknown')), en(2), en(3)],
      [],
      [2, 1, 3],
      castOf
    );
    expect(entries[1].pin).toEqual(rt('r-unknown'));
    expect(dormant).toEqual([]);
  });

  it('chained routines share a boundary track and both stay live', () => {
    const castOfChained = (uuid: string) =>
      uuid === 'rA' ? [1, 2, 3] : uuid === 'rB' ? [3, 4, 5] : null;
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('rA')), en(2), en(3, rt('rB')), en(4), en(5)],
      [],
      [1, 2, 3, 4, 5],
      castOfChained
    );
    expect(entries[0].pin).toEqual(rt('rA'));
    expect(entries[2].pin).toEqual(rt('rB'));
    expect(dormant).toEqual([]);
  });

  it('covered interior pins stay in the entries (shadowed at read time), and break/restore by their own pairs', () => {
    // The interior (2, 3) pair carries a shadowed transition pin while
    // the routine covers it; an interior-breaking reorder that ALSO
    // keeps the routine live is impossible for n=3, so use n=4 with a
    // covered interior pin on (2, 3).
    const castOf4 = (uuid: string) => (uuid === 'r4' ? [1, 2, 3, 4] : null);
    const { entries, dormant } = reconcileOrderChange(
      [en(1, rt('r4')), en(2, tr('tr-i')), en(3), en(4), en(5)],
      [],
      [1, 3, 2, 4, 5], // interior swap: routine live, (2,3) pair broken
      castOf4
    );
    expect(entries[0].pin).toEqual(rt('r4'));
    expect(dormant).toEqual([dp(2, 3, tr('tr-i'))]); // interior pin Dormant by its own rule
  });
});

describe('previewAdjacencyFutures — routine memories (sets 160)', () => {
  it('a Dormant routine memory never previews will-restore on pair adjacency', () => {
    const futures = previewAdjacencyFutures(
      [en(1), en(3), en(2)],
      [dp(1, 3, rt('r1'))],
      [1, 3, 2],
      () => false
    );
    expect(futures[0]).toBe(null); // (1,3) was already adjacent
  });
});
