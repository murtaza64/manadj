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
import type { AudioOutputDevice } from './audioDevices';

/** A stereo pair of a device's output channels, 0-based. */
export interface OutputPair {
  left: number;
  right: number;
}

export interface SavedDevice {
  deviceId: string;
  /** Display label (cue entries include the pair, e.g. "… (outs 3/4)");
   * matching is by id (+ pair). */
  label: string;
  /** Cue only: which output pair to occupy; absent/null = device default. */
  pair?: OutputPair | null;
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
  /** Output pair on the cue sink; null = device default / auto. */
  cuePair: OutputPair | null;
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
    cuePair: cuePresent ? (prefs.cue!.pair ?? null) : null,
    cueMissing: prefs.cue !== null && !cuePresent,
  };
}

/**
 * The CUE picker's entries (explicit-output-pairs follow-up): a plain
 * stereo device is one entry; a multichannel interface splits into its
 * stereo pairs, labelled 1-based — the Inpulse (one 4-out device,
 * hardware-learned) becomes "… (outs 1/2)" (rear RCA) and "… (outs 3/4)"
 * (front headphone jack). MASTER keeps whole-device entries: routing
 * master to a non-default pair is the single-context optimization ADR 0017
 * defers.
 */
export function cueOutputOptions(devices: readonly AudioOutputDevice[]): SavedDevice[] {
  return devices.flatMap((d): SavedDevice[] => {
    if (d.maxChannelCount < 4) {
      return [{ deviceId: d.deviceId, label: d.label, pair: null }];
    }
    const pairs = Math.floor(d.maxChannelCount / 2);
    return Array.from({ length: pairs }, (_, i) => ({
      deviceId: d.deviceId,
      label: `${d.label} (outs ${2 * i + 1}/${2 * i + 2})`,
      pair: { left: 2 * i, right: 2 * i + 1 },
    }));
  });
}

/** Same saved choice — id and pair (label is display-only). */
export function sameCueChoice(a: SavedDevice, b: SavedDevice): boolean {
  const pa = a.pair ?? null;
  const pb = b.pair ?? null;
  return (
    a.deviceId === b.deviceId &&
    (pa === null ? pb === null : pb !== null && pa.left === pb.left && pa.right === pb.right)
  );
}

/**
 * Which output channels the Cue bus occupies when the user hasn't chosen a
 * pair explicitly (legacy prefs / dev tracer): a ≥4-out sink defaults to
 * 0-based 2/3 — outs 3/4, the Inpulse's headphone jack — leaving 1/2 free
 * for master. null = the device's default stereo pair.
 */
export function cueChannelPair(maxChannelCount: number): OutputPair | null {
  return maxChannelCount >= 4 ? { left: 2, right: 3 } : null;
}

/**
 * Revive persisted prefs (headphone-cue 04). Anything malformed degrades to
 * the safe default for that bus — a corrupt blob must never kill audio or
 * throw at boot.
 */
export function parseRoutingPrefs(raw: unknown): RoutingPrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_ROUTING_PREFS;
  const pair = (v: unknown): OutputPair | null => {
    if (typeof v !== 'object' || v === null) return null;
    const p = v as Record<string, unknown>;
    return typeof p.left === 'number' &&
      typeof p.right === 'number' &&
      Number.isInteger(p.left) &&
      Number.isInteger(p.right) &&
      p.left >= 0 &&
      p.right >= 0
      ? { left: p.left, right: p.right }
      : null;
  };
  const device = (v: unknown): SavedDevice | null => {
    if (typeof v !== 'object' || v === null) return null;
    const d = v as Record<string, unknown>;
    return typeof d.deviceId === 'string' && d.deviceId !== '' && typeof d.label === 'string'
      ? { deviceId: d.deviceId, label: d.label, pair: pair(d.pair) }
      : null;
  };
  const o = raw as Record<string, unknown>;
  return { master: device(o.master), cue: device(o.cue) };
}
