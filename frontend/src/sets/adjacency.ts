/**
 * Adjacency model (sets 02, revised by sets 26) — pure functions under
 * vitest.
 *
 * Each adjacency in a Set (ordered pair of neighboring entries) carries a
 * pin: a saved Transition (by uuid), a Take (by uuid — ADR 0023), an
 * explicit Hard-cut, or nothing. Pinning freezes a choice; nothing here
 * re-resolves a pinned adjacency on favoriting or new saves.
 *
 * UNRESOLVED (nothing pinned) is deliberately library-live since sets 26:
 * it resolves at plan time to the pair's best saved Transition — the
 * favorite first, else the most recently edited — and hard-cuts only when
 * the pair has no Transitions at all. Saving or favoriting a Transition
 * upgrades every unresolved adjacency for that pair, everywhere, at the
 * recorded cost that unpinned playback changes as the library evolves
 * (the determinism guarantee is scoped to pinned adjacencies —
 * product-owner decision 2026-07-05). A dangling Transition pin (its
 * Transition was deleted) re-resolves the same way; a dangling Take pin
 * degrades to a cut — Takes never auto-resolve, so a broken manual act is
 * never auto-swapped for a machine choice.
 *
 * Two orthogonal per-adjacency facts fall out of pin + evidence:
 *
 * - what PLAYS: a Transition (pinned or auto-resolved), a Take (always
 *   pinned), or a hard cut (explicit Hard-cut pin, or no evidence).
 * - UNPRACTICED: the ordered pair has zero saved Transitions AND zero
 *   Takes — the rehearsal to-do list.
 *
 * Auto-fill's remaining role (sets 26) is freezing: bulk-pinning the
 * auto-resolved choices. Takes are never auto-filled — pinning one is
 * always a manual act.
 */

export type AdjacencyPin =
  | { kind: 'transition' | 'take'; uuid: string }
  /** Explicit "cut here, play no Transition" (sets 26) — the way to keep
   * a deliberate cut now that Unresolved auto-resolves. */
  | { kind: 'hardcut'; uuid?: undefined };

/** A saved Transition for the pair, as resolution/picker/badges need it. */
export interface TransitionEvidence {
  uuid: string;
  name: string;
  favorite?: boolean;
  /** Last edit instant (epoch ms) — resolution recency. Absent = oldest. */
  updatedAtMs?: number;
}

/** A Take for the pair (metadata only). */
export interface TakeEvidence {
  uuid: string;
  detectedAt: string;
}

export interface AdjacencyView {
  /** What plays at this handover: a Transition (pinned or auto-resolved),
   * a pinned Take, an explicit Hard-cut pin, or unresolved-with-no-
   * evidence (also a cut). The red hard-cut chip keys off 'hardcut' |
   * 'unresolved' — exactly the statuses where a cut actually plays. */
  status: 'transition' | 'take' | 'hardcut' | 'unresolved';
  /** status 'transition': true when auto-resolved at plan time rather
   * than pinned (the badge's subtle "auto" mark keys off this). */
  auto?: boolean;
  /** The playing Transition's evidence row (status 'transition'). */
  transition?: TransitionEvidence;
  /** The pinned Take's evidence row (status 'take'). */
  take?: TakeEvidence;
  /** The ordered pair has no saved Transition and no Take. */
  unpracticed: boolean;
  counts: { transitions: number; takes: number };
}

/** The pair's best saved Transition (sets 26's resolution rule): the
 * favorite first — the most recently edited favorite when several — else
 * the most recently edited overall; recency ties break toward the later
 * sibling (append order = creation order). Null only when the pair has
 * no Transitions. Doubles as auto-fill's proposal (freezing = pinning
 * exactly what resolution picked). */
export function resolveTransition(
  transitions: readonly TransitionEvidence[]
): TransitionEvidence | null {
  const pool = transitions.some((t) => t.favorite)
    ? transitions.filter((t) => t.favorite)
    : transitions;
  let best: TransitionEvidence | null = null;
  for (const t of pool) {
    // `>=` breaks ties toward the later sibling; missing stamps (-∞) still
    // beat nothing, so a stampless pool resolves to its last item.
    if (best === null || (t.updatedAtMs ?? -Infinity) >= (best.updatedAtMs ?? -Infinity)) {
      best = t;
    }
  }
  return best;
}

/**
 * Resolve a Set's entry pins for the planner (sets 26) — THE pure
 * resolution seam shared by the plan input assembly (useSetPlanParts →
 * ladder, Conductor, practice) so every consumer executes the same
 * choice the badges show. Pinned adjacencies pass through untouched
 * (resolution never overrides a pin — Hard-cut pins keep cutting, Take
 * pins stay manual); unpinned and dangling-Transition adjacencies take
 * the pair's best Transition, else stay null (hard cut).
 */
export function resolvePlanPins<E extends { trackId: number; pin: AdjacencyPin | null }>(
  entries: readonly E[],
  evidenceFor: (aTrackId: number, bTrackId: number) => readonly TransitionEvidence[]
): E[] {
  return entries.map((entry, i) => {
    const next = entries[i + 1];
    if (!next) return entry; // heads no adjacency
    const pin = entry.pin;
    if (pin?.kind === 'take' || pin?.kind === 'hardcut') return entry;
    const evidence = evidenceFor(entry.trackId, next.trackId);
    if (pin?.kind === 'transition' && evidence.some((t) => t.uuid === pin.uuid)) {
      return entry; // live pin: frozen
    }
    // Unpinned, or a dangling Transition pin: plan-time resolution.
    const resolved = resolveTransition(evidence);
    return { ...entry, pin: resolved ? { kind: 'transition' as const, uuid: resolved.uuid } : null };
  });
}

/** Resolve one adjacency's pin against the pair's evidence — the badge/
 * row/practice view of the same rule `resolvePlanPins` feeds the plan. */
export function adjacencyView(
  pin: AdjacencyPin | null,
  transitions: readonly TransitionEvidence[],
  takes: readonly TakeEvidence[]
): AdjacencyView {
  const base = {
    unpracticed: transitions.length === 0 && takes.length === 0,
    counts: { transitions: transitions.length, takes: takes.length },
  };
  if (pin?.kind === 'transition') {
    const transition = transitions.find((t) => t.uuid === pin.uuid);
    if (transition) return { status: 'transition', auto: false, transition, ...base };
    // Dangling: fall through to plan-time resolution, like no pin.
  }
  if (pin?.kind === 'take') {
    const take = takes.find((t) => t.uuid === pin.uuid);
    if (take) return { status: 'take', take, ...base };
    // Dangling Take pin: a cut (the planner cuts too) — a broken manual
    // act is never auto-swapped for a machine choice.
    return { status: 'unresolved', ...base };
  }
  if (pin?.kind === 'hardcut') {
    return { status: 'hardcut', ...base };
  }
  const resolved = resolveTransition(transitions);
  if (resolved) return { status: 'transition', auto: true, transition: resolved, ...base };
  return { status: 'unresolved', ...base };
}
