/**
 * Unified evidence cycle (gh#167): the Transition editor's switcher becomes
 * ONE cycler over the loaded pair's evidence — saved Transitions first
 * (favorites lead), then Takes recent-first. Pure functions under vitest.
 *
 * Set context (the from-Set click-through): the evidence the adjacency
 * OPENED WITH anchors the front of the cycle, frozen for the visit — the
 * live pin follows the switch (pinFollowUpdate), and re-sorting the list
 * under the user's feet after every switch would make ◀/▶ bounce between
 * two items forever. The pinned mark tracks the LIVE pin, not the anchor.
 */
import type { AdjacencyPin } from '../sets/adjacency';
import { isPristine } from './pairStore';
import type { SavedTransition } from './pairStore';

/** One evidence identity: a saved Transition or a recorded Take. */
export interface EvidenceRef {
  kind: 'transition' | 'take';
  uuid: string;
}

/** A pair's Take as the cycle needs it (from the ['takes'] query rows). */
export interface PairTake {
  uuid: string;
  detectedAt?: string;
  /** Promoted Takes are represented by their Transition in the saved
   * section — they never appear as Take entries. */
  promotedTransitionUuid: string | null;
}

export interface EvidenceItem {
  kind: 'transition' | 'take';
  /** Transition uuid or Take uuid — the pinnable identity. */
  uuid: string;
  /** Transition entries: the saved name. */
  name?: string;
  favorite: boolean;
  /** Take entries: detection instant (server naive-UTC string). */
  detectedAt?: string;
  /** This item IS the Set's live pin (set context only; surfaced in
   * tooltips, no glyph). */
  pinned: boolean;
  /** Whether switching here may follow with a Set pin: pristine (unsaved)
   * sketches can't be pinned — their uuid never persists. */
  pinnable: boolean;
}

/** The from-Set click-through context the editor holds while the pair
 * stays loaded (pairKey mismatch = context dormant: manual re-assigns and
 * deck swaps leave the Set's adjacency behind). */
export interface SetEditContext {
  setId: number;
  /** The adjacency's head track — setAdjacencyPin's key. */
  headTrackId: number;
  /** The pair the context belongs to (`a:b`). */
  pairKey: string;
  /** The evidence the adjacency opened with — the frozen sort anchor. */
  anchor: EvidenceRef | null;
}

const refMatches = (ref: EvidenceRef | null, item: EvidenceItem): boolean =>
  ref !== null && ref.kind === item.kind && ref.uuid === item.uuid;

const parseInstant = (value?: string): number => {
  if (!value) return -Infinity;
  // Server stamps are naive UTC — pin the zone (pairStore's rule).
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(ms) ? -Infinity : ms;
};

/**
 * Build the pair's evidence cycle: [anchor] + saved Transitions (favorites
 * lead, creation order within each group) + unpromoted Takes recent-first.
 *
 * - `saved` is the editor session's live items; an active Take draft's
 *   session item is REPRESENTED BY its Take entry, never doubled.
 * - Promoted Takes are excluded (their Transition is in the saved section).
 * - `anchor` (set context) moves its match to the front — frozen ordering.
 * - `livePin` marks `pinned` (it usually equals the last switch's pin).
 */
export function buildEvidenceCycle(args: {
  saved: readonly SavedTransition[];
  takes: readonly PairTake[];
  takeDraft: { takeUuid: string; itemUuid: string } | null;
  anchor?: EvidenceRef | null;
  livePin?: AdjacencyPin | null;
}): EvidenceItem[] {
  const { saved, takes, takeDraft } = args;
  const anchor = args.anchor ?? null;
  const livePin = args.livePin ?? null;

  const transitions: EvidenceItem[] = saved
    .filter((it) => it.uuid !== takeDraft?.itemUuid)
    .map((it) => ({
      kind: 'transition' as const,
      uuid: it.uuid,
      name: it.name,
      favorite: !!it.favorite,
      pinned: false,
      pinnable: !isPristine(it),
    }));
  const savedOrdered = [
    ...transitions.filter((t) => t.favorite),
    ...transitions.filter((t) => !t.favorite),
  ];

  const takeEntries: EvidenceItem[] = takes
    .filter((t) => t.promotedTransitionUuid === null)
    .map((t) => ({
      kind: 'take' as const,
      uuid: t.uuid,
      favorite: false,
      detectedAt: t.detectedAt,
      pinned: false,
      pinnable: true,
    }))
    .sort((a, b) => parseInstant(b.detectedAt) - parseInstant(a.detectedAt));
  // An under-review Take must be cyclable even before the takes query
  // resolves (it IS the loaded evidence) — synthesize its entry.
  if (takeDraft && !takeEntries.some((t) => t.uuid === takeDraft.takeUuid)) {
    takeEntries.unshift({
      kind: 'take',
      uuid: takeDraft.takeUuid,
      favorite: false,
      pinned: false,
      pinnable: true,
    });
  }

  const cycle = [...savedOrdered, ...takeEntries];
  const anchorIndex = cycle.findIndex((it) => refMatches(anchor, it));
  if (anchorIndex > 0) cycle.unshift(cycle.splice(anchorIndex, 1)[0]);

  if (livePin && livePin.kind !== 'hardcut') {
    for (const it of cycle) {
      if (it.kind === livePin.kind && it.uuid === livePin.uuid) it.pinned = true;
    }
  }
  return cycle;
}

/** The session's current position as an evidence identity: the active
 * item, read as its Take when it IS the under-review draft. */
export function activeEvidenceRef(
  session: { items: readonly SavedTransition[]; active: number },
  takeDraft: { takeUuid: string; itemUuid: string } | null
): EvidenceRef | null {
  const item = session.items[session.active];
  if (!item) return null;
  if (takeDraft && item.uuid === takeDraft.itemUuid) {
    return { kind: 'take', uuid: takeDraft.takeUuid };
  }
  return { kind: 'transition', uuid: item.uuid };
}

export function findEvidenceIndex(items: readonly EvidenceItem[], ref: EvidenceRef | null): number {
  return items.findIndex((it) => refMatches(ref, it));
}

/**
 * Pin-follow (gh#167): in set context, SWITCHING EVIDENCE IS THE
 * DELIBERATE ACT — the Set pin follows the switch (the pin picker's
 * doctrine, per-adjacency carve-out). Null = no side-effect: outside set
 * context, when the loaded pair no longer matches the context (manual
 * re-assign, deck swap), or when the target can't be pinned (pristine
 * sketches never persist a uuid).
 */
export function pinFollowUpdate(
  ctx: SetEditContext | null,
  currentPairKey: string | null,
  item: EvidenceItem
): { setId: number; headTrackId: number; pin: AdjacencyPin } | null {
  if (!ctx || currentPairKey === null || ctx.pairKey !== currentPairKey) return null;
  if (!item.pinnable) return null;
  return {
    setId: ctx.setId,
    headTrackId: ctx.headTrackId,
    pin: { kind: item.kind, uuid: item.uuid },
  };
}
