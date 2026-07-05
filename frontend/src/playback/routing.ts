/**
 * Pure routing resolution (headphone-cue 01). Saved output-device choices +
 * whatever is actually plugged in → the sink each bus should use. The
 * semantics live here, unit-tested; the glue that enumerates devices and
 * applies sinks is hands-on-verified like the rest of the audio layer
 * (ADR 0002 / ADR 0017).
 *
 * Rules (PRD: audio must never be dead because a saved device is gone):
 * - Master: saved device present → use it; absent or nothing saved → the
 *   system default output.
 * - Cue: saved device present → use it; absent or nothing saved → the Cue
 *   bus is disabled. Master is never affected by cue routing.
 */

export interface SavedDevice {
  deviceId: string;
  /** For display when the device is missing; matching is by id only. */
  label: string;
}

export interface RoutingPrefs {
  /** null = system default output. */
  master: SavedDevice | null;
  /** null = Cue bus off (never configured, or explicitly off). */
  cue: SavedDevice | null;
}

export const DEFAULT_ROUTING_PREFS: RoutingPrefs = { master: null, cue: null };

export interface ResolvedRouting {
  /** Sink for the main context; null = system default. */
  masterSinkId: string | null;
  /** The saved master device is gone — fell back to the system default. */
  masterMissing: boolean;
  /** Sink for the cue context; null = Cue bus disabled. */
  cueSinkId: string | null;
  /** The saved cue device is gone — Cue bus disabled until it returns. */
  cueMissing: boolean;
}

export function resolveRouting(
  prefs: RoutingPrefs,
  availableIds: readonly string[]
): ResolvedRouting {
  const available = new Set(availableIds);
  const masterPresent = prefs.master !== null && available.has(prefs.master.deviceId);
  const cuePresent = prefs.cue !== null && available.has(prefs.cue.deviceId);
  return {
    masterSinkId: masterPresent ? prefs.master!.deviceId : null,
    masterMissing: prefs.master !== null && !masterPresent,
    cueSinkId: cuePresent ? prefs.cue!.deviceId : null,
    cueMissing: prefs.cue !== null && !cuePresent,
  };
}
