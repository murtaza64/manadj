/**
 * Cameo pins (cameos PRD, #140) — pure functions under vitest.
 *
 * A Cameo pin is an ENTRY ornament: zero or more saved Cameos (or,
 * manually, Cameo Takes) hosted by that entry's Track. Always manual —
 * an ornament resolves to nothing (no Unresolved state, never
 * auto-filled) — and adjacency-independent: reordering never touches
 * them (PRD story 15). Dormancy keys on the HOST TRACK per Set
 * (glossary "Dormant pin"): a removed host's Cameo pins go Dormant and
 * restore when it returns.
 *
 * `reconcileCameoOrderChange` is the single rule for what happens to
 * Cameo pins when a Set's track order changes — the Cameo sibling of
 * dormancy.ts's reconcileOrderChange, deliberately separate: the
 * adjacency rule keys on ordered pairs, this one on host membership.
 */

/** One Cameo pin: a saved Cameo or a Cameo Take (a guest-kind Take). */
export interface CameoPin {
  kind: 'cameo' | 'cameo-take';
  uuid: string;
}

/** A Set's memory of a removed host's Cameo pins, keyed on the host. */
export interface DormantCameoPin {
  hostTrackId: number;
  pin: CameoPin;
}

/** An entry as the Cameo reconcile sees it (structurally SetEntryLocal). */
export interface CameoHostEntry {
  trackId: number;
  cameoPins?: CameoPin[];
}

/**
 * Apply a track-order change to a Set's Cameo pins: pins whose host
 * survives ride along untouched (order is irrelevant — ornaments are
 * adjacency-independent), a removed host's pins go Dormant (keyed on the
 * host track; a fresh removal overwrites an older memory), and a
 * returning host restores its memory in pin order.
 */
export function reconcileCameoOrderChange(
  oldEntries: readonly CameoHostEntry[],
  oldDormant: readonly DormantCameoPin[],
  newTrackIds: readonly number[]
): { cameoPinsByHost: Map<number, CameoPin[]>; dormant: DormantCameoPin[] } {
  const present = new Set(newTrackIds);
  const dormantByHost = new Map<number, CameoPin[]>();
  for (const d of oldDormant) {
    const list = dormantByHost.get(d.hostTrackId);
    if (list) list.push(d.pin);
    else dormantByHost.set(d.hostTrackId, [d.pin]);
  }

  const cameoPinsByHost = new Map<number, CameoPin[]>();
  for (const e of oldEntries) {
    const pins = e.cameoPins ?? [];
    if (pins.length === 0) continue;
    if (present.has(e.trackId)) {
      cameoPinsByHost.set(e.trackId, [...pins]);
    } else {
      // Host removed: its pins go Dormant (fresh removal overwrites).
      dormantByHost.set(e.trackId, [...pins]);
    }
  }

  // Returning hosts consume their memory — unless the entry somehow
  // already carries pins (an explicit act outranks a memory).
  for (const trackId of newTrackIds) {
    if (cameoPinsByHost.has(trackId)) {
      dormantByHost.delete(trackId);
      continue;
    }
    const memory = dormantByHost.get(trackId);
    if (memory) {
      cameoPinsByHost.set(trackId, memory);
      dormantByHost.delete(trackId);
    }
  }

  const dormant: DormantCameoPin[] = [];
  for (const [hostTrackId, pins] of dormantByHost) {
    for (const pin of pins) dormant.push({ hostTrackId, pin });
  }
  return { cameoPinsByHost, dormant };
}
