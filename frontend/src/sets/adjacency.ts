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
 * always a deliberate act naming that evidence. Since the glossary
 * amendment of 2026-08-24 that act may be bulk: the Set-level "Resolve
 * from evidence" gesture (sets #163) previews and, on one confirm, pins
 * the best Take on every Unresolved adjacency — the confirmed bulk
 * gesture IS the explicit act ADR 0023 requires; what the doctrine
 * forbids is Takes arriving without the user choosing them, not pins
 * arriving one at a time.
 */

export type AdjacencyPin =
  /** 'routine' (sets 160, ADR 0035): a saved Routine pinned on the
   * adjacency leaving its first cast track, COVERING the following
   * adjacencies (offerable exactly when its cast is the next n entries
   * and it ends the covered sequence). Covered adjacencies' own pins
   * stay stored but are SHADOWED — inert while covered, active again on
   * unpin/Dormant. Plans as a hard-cut placeholder for now (replay is
   * sets #159). */
  | { kind: 'transition' | 'take' | 'routine'; uuid: string }
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
  /** Take window length in seconds (capture clock) — chop classification.
   * Absent = unknown, treated as full-length. */
  windowS?: number;
}

export interface AdjacencyView {
  /** What plays at this handover: a Transition (pinned or auto-resolved),
   * a pinned Take, a pinned Routine (sets 160 — the pane renders its own
   * routine row for these), an explicit Hard-cut pin, or unresolved-
   * with-no-evidence (also a cut). The red hard-cut chip keys off
   * 'hardcut' | 'unresolved' — exactly the statuses where a cut actually
   * plays. */
  status: 'transition' | 'take' | 'routine' | 'hardcut' | 'unresolved';
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

/** A Routine's cast by pin uuid; null = unknown (metadata not loaded)
 * or dangling. THE lookup shape shared by coverage, dormancy, and the
 * plan-input resolution (sets 160). */
export type RoutineCastLookup = (uuid: string) => readonly number[] | null;

/** Offerability (ADR 0035, sets 160): the cast is exactly the next n
 * entries starting at `headIndex` — MEMBERSHIP equality plus both
 * boundaries (enter on the first, exit on the last). Interior order is
 * presentational, so it does not participate (the same rule as the
 * backend cast-prefix query). n < 3 never offers (a 2-cast routine is a
 * Transition — forbidden as a Routine). */
export function routineOfferable(
  orderedTrackIds: readonly number[],
  headIndex: number,
  cast: readonly number[]
): boolean {
  const n = cast.length;
  if (n < 3 || headIndex < 0 || headIndex + n > orderedTrackIds.length) return false;
  const window = orderedTrackIds.slice(headIndex, headIndex + n);
  if (window[0] !== cast[0] || window[n - 1] !== cast[n - 1]) return false;
  const members = new Set(cast);
  return members.size === n && window.every((id) => members.has(id));
}

/** One live Routine pin's span over a Set (sets 160). */
export interface RoutineCoverage {
  /** Entry index carrying the routine pin (the first cast track). */
  headIndex: number;
  /** Entry index of the exit track (last cast member). */
  lastEntryIndex: number;
  uuid: string;
  cast: readonly number[];
}

/**
 * Coverage per ADJACENCY index (sets 160): adjacency i sits under the
 * returned Routine (null = uncovered). A routine pin covers adjacencies
 * headIndex..headIndex+n−2 exactly when its cast is live (offerable at
 * its head); a pin whose cast is unknown or no longer matches covers
 * NOTHING (dormancy reconciliation is what retires it — coverage never
 * guesses). Chained Routines share a boundary track, so one entry may
 * be an exit and the next head — the covered adjacencies stay disjoint.
 */
export function routineCoverage<E extends { trackId: number; pin: AdjacencyPin | null }>(
  entries: readonly E[],
  castOf: RoutineCastLookup
): (RoutineCoverage | null)[] {
  const orderedIds = entries.map((e) => e.trackId);
  const coverage: (RoutineCoverage | null)[] = new Array(
    Math.max(0, entries.length - 1)
  ).fill(null);
  entries.forEach((entry, i) => {
    if (entry.pin?.kind !== 'routine') return;
    const cast = castOf(entry.pin.uuid);
    if (!cast || !routineOfferable(orderedIds, i, cast)) return;
    const span: RoutineCoverage = {
      headIndex: i,
      lastEntryIndex: i + cast.length - 1,
      uuid: entry.pin.uuid,
      cast,
    };
    for (let a = i; a <= i + cast.length - 2 && a < coverage.length; a++) {
      coverage[a] = span;
    }
  });
  return coverage;
}

/**
 * Resolve a Set's entry pins for the planner (sets 26) — THE pure
 * resolution seam shared by the plan input assembly (useSetPlanParts →
 * ladder, Conductor, practice) so every consumer executes the same
 * choice the badges show. Pinned adjacencies pass through untouched
 * (resolution never overrides a pin — Hard-cut pins keep cutting, Take
 * pins stay manual); unpinned and dangling-Transition adjacencies take
 * the pair's best Transition, else stay null (hard cut).
 *
 * Routine pins (sets 160): the head passes through (the planner plans
 * it as a hard-cut placeholder until replay, sets #159); the COVERED
 * interior adjacencies plan as explicit hard cuts — their shadowed pins
 * are inert while covered, and nothing auto-resolves inside the span.
 */
export function resolvePlanPins<E extends { trackId: number; pin: AdjacencyPin | null }>(
  entries: readonly E[],
  evidenceFor: (aTrackId: number, bTrackId: number) => readonly TransitionEvidence[],
  /** Routine casts for coverage; absent = no routine pins in play. */
  castOf?: RoutineCastLookup
): E[] {
  const coverage = castOf ? routineCoverage(entries, castOf) : undefined;
  return entries.map((entry, i) => {
    const next = entries[i + 1];
    if (!next) return entry; // heads no adjacency
    const covered = coverage?.[i];
    if (covered && covered.headIndex !== i) {
      // Interior of a Routine span: the shadowed pin is inert and the
      // pair never auto-resolves — the Routine owns this handover.
      return { ...entry, pin: { kind: 'hardcut' as const } };
    }
    const pin = entry.pin;
    if (pin?.kind === 'take' || pin?.kind === 'hardcut' || pin?.kind === 'routine') return entry;
    const evidence = evidenceFor(entry.trackId, next.trackId);
    if (pin?.kind === 'transition' && evidence.some((t) => t.uuid === pin.uuid)) {
      return entry; // live pin: frozen
    }
    // Unpinned, or a dangling Transition pin: plan-time resolution.
    const resolved = resolveTransition(evidence);
    return { ...entry, pin: resolved ? { kind: 'transition' as const, uuid: resolved.uuid } : null };
  });
}

/** Windows under this are chop-Takes: near-instant fader cuts the
 * detector still stamps as Takes (map #114's real-data finding — real
 * cuts produce sub-second windows). Resolve from evidence pins them,
 * but flagged for review. */
export const CHOP_TAKE_MAX_S = 2;

/** A chop-Take: a sub-2s window — likely a fader chop, not a blend.
 * Unknown windows count as full-length (never flag blind). */
export function isChopTake(take: TakeEvidence): boolean {
  return take.windowS !== undefined && take.windowS < CHOP_TAKE_MAX_S;
}

/** The pair's best Take (Resolve from evidence, sets #163): full-length
 * Takes outrank chop-Takes; within a class the most recent detection
 * wins, ties toward the later sibling (append order = capture order —
 * the same tiebreak idiom as `resolveTransition`). Null only when the
 * pair has no Takes. */
export function resolveTake(takes: readonly TakeEvidence[]): TakeEvidence | null {
  const pool = takes.some((t) => !isChopTake(t)) ? takes.filter((t) => !isChopTake(t)) : takes;
  let best: TakeEvidence | null = null;
  for (const t of pool) {
    // `>=` breaks ties toward the later sibling; an unparseable stamp
    // (NaN) never beats a real one but a NaN-only pool still resolves.
    if (best === null || !(Date.parse(t.detectedAt) < Date.parse(best.detectedAt))) {
      best = t;
    }
  }
  return best;
}

/** One adjacency's fate under Resolve from evidence (preview rows). */
export interface EvidenceResolutionRow {
  /** The entry heading the adjacency — `setAdjacencyPins`' key. */
  headTrackId: number;
  aTrackId: number;
  bTrackId: number;
  take: TakeEvidence;
  /** Pinned but flagged: a sub-2s window (likely a fader chop). */
  chop: boolean;
}

export interface EvidenceResolution {
  /** headTrackId → Take pin, shaped for `setAdjacencyPins`. */
  pins: Map<number, AdjacencyPin>;
  /** The adjacencies gaining a Take pin, in Set order. */
  rows: EvidenceResolutionRow[];
  /** Unresolved adjacencies with no evidence at all — these remain
   * hard-cuts after the gesture (the preview lists them). */
  hardCuts: { aTrackId: number; bTrackId: number }[];
}

/**
 * Resolve from evidence (sets #163; glossary amendment 2026-08-24): the
 * pure computation behind the Set-level bulk gesture. For every
 * Unresolved adjacency (nothing pinned):
 *
 * - a pair with saved Transitions is SKIPPED — plan-time resolution
 *   already plays its best Transition (saved Transitions win; freezing
 *   them stays auto-fill's job);
 * - a pair with Takes proposes its best Take (`resolveTake`) — chop-
 *   Takes (sub-2s windows) proposed but flagged;
 * - a pair with no evidence lands in `hardCuts` (still cuts after).
 *
 * Pinned adjacencies — including dangling pins — are never touched.
 * Adjacencies COVERED by a Routine pin (sets 160) are skipped outright:
 * the Routine owns those handovers; their shadowed pins stay shadowed.
 * The result is a PREVIEW: nothing applies until the user confirms,
 * which is what makes the bulk pin an explicit act under ADR 0023.
 */
export function resolveFromEvidence<E extends { trackId: number; pin: AdjacencyPin | null }>(
  entries: readonly E[],
  evidenceFor: (
    aTrackId: number,
    bTrackId: number
  ) => { transitions: readonly TransitionEvidence[]; takes: readonly TakeEvidence[] },
  /** Routine casts for coverage (sets 160); absent = none in play. */
  castOf?: RoutineCastLookup
): EvidenceResolution {
  const coverage = castOf ? routineCoverage(entries, castOf) : undefined;
  const pins = new Map<number, AdjacencyPin>();
  const rows: EvidenceResolutionRow[] = [];
  const hardCuts: { aTrackId: number; bTrackId: number }[] = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const entry = entries[i];
    if (coverage?.[i]) continue;
    if (entry.pin !== null) continue;
    const bTrackId = entries[i + 1].trackId;
    const { transitions, takes } = evidenceFor(entry.trackId, bTrackId);
    if (resolveTransition(transitions)) continue; // a Transition plays
    const take = resolveTake(takes);
    if (take) {
      pins.set(entry.trackId, { kind: 'take', uuid: take.uuid });
      rows.push({
        headTrackId: entry.trackId,
        aTrackId: entry.trackId,
        bTrackId,
        take,
        chop: isChopTake(take),
      });
    } else {
      hardCuts.push({ aTrackId: entry.trackId, bTrackId });
    }
  }
  return { pins, rows, hardCuts };
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
  if (pin?.kind === 'routine') {
    // The pane renders a routine row for these (sets 160); the view
    // status exists so shared consumers (editor routing) can branch.
    return { status: 'routine', ...base };
  }
  if (pin?.kind === 'hardcut') {
    return { status: 'hardcut', ...base };
  }
  const resolved = resolveTransition(transitions);
  if (resolved) return { status: 'transition', auto: true, transition: resolved, ...base };
  return { status: 'unresolved', ...base };
}
