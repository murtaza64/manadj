/**
 * Mix-picker model (#205, ADR 0037 phase 2) — pure, under vitest.
 *
 * The context-aware picker is the Mix editor's navigation system,
 * absorbing the EvidenceSwitcher's jobs. Three page shapes, decided by
 * how many track chips are set:
 *
 * - 0 chips (COLD OPEN): search focused; deck-state surfacing —
 *   Transitions between pairs of loaded Tracks and Routines whose cast
 *   intersects the loaded Tracks — plus the full saved-Routine/Take/
 *   candidate inventory (the old <select>'s tiers, kept whole).
 * - 1 chip (TRACK SCOUTING): everything out of / into / over that Track.
 * - 2 chips (MOVE PAGE): the ordered pair's artifact set — Transitions
 *   (favorite-first), Takes, Cameos, Routines-through-the-pair — plus the
 *   pinned `+ New Transition A → B` (and `+ New blank mix`, ADR 0039).
 *
 * Scoped sibling cycling (the ◀/▶ in the header) cycles within the
 * current artifact's MOVE: the ordered pair for pair artifacts, the cast
 * for routines. buildEvidenceCycle is the precedent; this generalizes it
 * across artifact kinds.
 */
import type { CameoRowWire, RoutineRowWire, TakeRowWire } from '../api/client';

// ── Wire slices the model consumes (structural, kept narrow) ────────────

export interface TransitionRowLike {
  a_track_id: number;
  b_track_id: number;
  uuid: string;
  position: number;
  name: string;
  favorite: boolean;
  updated_at?: string | null;
}

// ── Artifact references (what a picker row opens) ───────────────────────

export type MixArtifactRef =
  | { kind: 'transition'; aTrackId: number; bTrackId: number; uuid: string }
  | { kind: 'routine'; uuid: string }
  | { kind: 'cameo'; hostTrackId: number; guestTrackId: number; uuid: string }
  | { kind: 'pair-take'; aTrackId: number; bTrackId: number; uuid: string }
  | { kind: 'routine-take'; uuid: string }
  | { kind: 'candidate'; uuid: string }
  | { kind: 'new-transition'; aTrackId: number; bTrackId: number }
  | { kind: 'new-blank' };

export function refKey(ref: MixArtifactRef): string {
  switch (ref.kind) {
    case 'new-transition':
      return `new:${ref.aTrackId}:${ref.bTrackId}`;
    case 'new-blank':
      return 'new-blank';
    default:
      return `${ref.kind}:${ref.uuid}`;
  }
}

// ── Move page (2 chips) ──────────────────────────────────────────────────

/** The ordered pair's Transitions, favorite-first then position (the
 * evidence-cycle ordering; position = creation order). */
export function pairTransitions(
  rows: readonly TransitionRowLike[],
  aTrackId: number,
  bTrackId: number
): TransitionRowLike[] {
  return rows
    .filter((r) => r.a_track_id === aTrackId && r.b_track_id === bTrackId)
    .sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.position - y.position);
}

/** The pair's Takes (handover kind), newest-first, unpromoted flagged.
 * Promoted Takes stay listed (the picker is an inventory, not a review
 * queue) — the open flow decides what opening one means. */
export function pairTakes(
  takes: readonly TakeRowWire[],
  aTrackId: number,
  bTrackId: number
): TakeRowWire[] {
  return takes
    .filter(
      (t) =>
        t.a_track_id === aTrackId &&
        t.b_track_id === bTrackId &&
        (t.kind ?? 'handover') === 'handover'
    )
    .sort((x, y) => (y.detected_at ?? '').localeCompare(x.detected_at ?? ''));
}

/** Cameos whose (host, guest) is the ordered pair. */
export function pairCameos(
  cameos: readonly CameoRowWire[],
  hostTrackId: number,
  guestTrackId: number
): CameoRowWire[] {
  return cameos
    .filter((c) => c.host_track_id === hostTrackId && c.guest_track_id === guestTrackId)
    .sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.position - y.position);
}

/** Routines through the pair: cast contains a immediately followed by b
 * (the ordered pair as an adjacency inside the cast). */
export function routinesThroughPair(
  routines: readonly RoutineRowWire[],
  aTrackId: number,
  bTrackId: number
): RoutineRowWire[] {
  return routines.filter((r) =>
    r.cast.some((id, i) => id === aTrackId && r.cast[i + 1] === bTrackId)
  );
}

// ── Track page (1 chip) ──────────────────────────────────────────────────

export interface TrackPage {
  /** Transitions out of the track (it is the outgoing). */
  outOf: TransitionRowLike[];
  /** Transitions into the track (it is the incoming). */
  into: TransitionRowLike[];
  /** Cameos over the track (it hosts). */
  over: CameoRowWire[];
  /** Cameos where the track guests. */
  guesting: CameoRowWire[];
  /** Routines whose cast contains the track. */
  through: RoutineRowWire[];
}

export function trackPage(
  trackId: number,
  transitions: readonly TransitionRowLike[],
  cameos: readonly CameoRowWire[],
  routines: readonly RoutineRowWire[]
): TrackPage {
  const fav = (x: TransitionRowLike | CameoRowWire, y: TransitionRowLike | CameoRowWire) =>
    Number(y.favorite) - Number(x.favorite) || x.position - y.position;
  return {
    outOf: transitions.filter((r) => r.a_track_id === trackId).sort(fav),
    into: transitions.filter((r) => r.b_track_id === trackId).sort(fav),
    over: cameos.filter((c) => c.host_track_id === trackId).sort(fav),
    guesting: cameos.filter((c) => c.guest_track_id === trackId && c.host_track_id !== trackId).sort(fav),
    through: routines.filter((r) => r.cast.includes(trackId)),
  };
}

// ── Cold open (0 chips): deck-state surfacing ────────────────────────────

export interface DeckSurfacing {
  /** Transitions between ordered pairs of loaded tracks (both directions
   * of every loaded pair, aTrack loaded AND bTrack loaded). */
  transitions: TransitionRowLike[];
  /** Routines whose cast intersects the loaded tracks. */
  routines: RoutineRowWire[];
}

export function deckSurfacing(
  loadedTrackIds: readonly number[],
  transitions: readonly TransitionRowLike[],
  routines: readonly RoutineRowWire[]
): DeckSurfacing {
  const loaded = new Set(loadedTrackIds);
  return {
    transitions: transitions
      .filter((r) => loaded.has(r.a_track_id) && loaded.has(r.b_track_id))
      .sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.position - y.position),
    routines: routines.filter((r) => r.cast.some((id) => loaded.has(id))),
  };
}

// ── Scoped sibling cycling ───────────────────────────────────────────────

/** The current artifact's move-scoped sibling cycle, and its position in
 * it. Pair artifacts cycle the ordered pair's Transitions (favorite-first
 * — the evidence-cycle order); Routines cycle routines sharing the exact
 * cast. The `+ new` tail is the caller's affordance, not a cycle entry. */
export function siblingCycle(
  current:
    | { kind: 'transition'; aTrackId: number; bTrackId: number; uuid: string }
    | { kind: 'routine'; uuid: string },
  transitions: readonly TransitionRowLike[],
  routines: readonly RoutineRowWire[]
): { refs: MixArtifactRef[]; index: number } {
  if (current.kind === 'transition') {
    const sibs = pairTransitions(transitions, current.aTrackId, current.bTrackId);
    const refs: MixArtifactRef[] = sibs.map((r) => ({
      kind: 'transition',
      aTrackId: r.a_track_id,
      bTrackId: r.b_track_id,
      uuid: r.uuid,
    }));
    return { refs, index: refs.findIndex((r) => refKey(r) === `transition:${current.uuid}`) };
  }
  const self = routines.find((r) => r.uuid === current.uuid);
  const sibs = self
    ? routines.filter((r) => r.cast.length === self.cast.length && r.cast.every((id, i) => id === self.cast[i]))
    : [];
  const refs: MixArtifactRef[] = sibs.map((r) => ({ kind: 'routine', uuid: r.uuid }));
  return { refs, index: refs.findIndex((r) => refKey(r) === `routine:${current.uuid}`) };
}

// ── Track chip typeahead ─────────────────────────────────────────────────

export interface TrackLike {
  id: number;
  title?: string | null;
  artist?: string | null;
  filename?: string | null;
  bpm?: number | null;
}

export function trackLabel(t: TrackLike): string {
  const title = t.title || t.filename || `#${t.id}`;
  return t.artist ? `${t.artist} – ${title}` : title;
}

/** Case-insensitive substring match over artist/title/filename (the
 * library search's ILIKE semantic, client-side over the cached rows). */
export function filterTracks(tracks: readonly TrackLike[], query: string, limit = 12): TrackLike[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: TrackLike[] = [];
  for (const t of tracks) {
    const hay = `${t.artist ?? ''} ${t.title ?? ''} ${t.filename ?? ''}`.toLowerCase();
    if (hay.includes(q)) {
      out.push(t);
      if (out.length >= limit) break;
    }
  }
  return out;
}
