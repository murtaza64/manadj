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
import { audioDeviceMapping, verifiedRouteDefaults } from './audioDeviceMapping';

/** A stereo pair of a device's output channels, 0-based. */
export interface OutputPair {
  left: number;
  right: number;
}

export interface SavedDevice {
  deviceId: string;
  /** Display label (pair entries include e.g. "… (outs 3/4)");
   * matching is by id (+ pair). */
  label: string;
  /** Which output pair to occupy; absent/null = device default. */
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
  /** Output pair on the master sink; null = device default. */
  masterPair: OutputPair | null;
  /** The saved master device is gone — fell back to the system default. */
  masterMissing: boolean;
  /** Recognized device is present, but no hardware-verified/default pair exists. */
  masterNeedsPair: boolean;
  /** Sink for the cue context; null = Cue bus disabled. */
  cueSinkId: string | null;
  /** Output pair on the cue sink; null = device default / auto. */
  cuePair: OutputPair | null;
  /** The saved cue device is gone — Cue bus disabled until it returns. */
  cueMissing: boolean;
  /** Recognized device is present, but no hardware-verified/default pair exists. */
  cueNeedsPair: boolean;
}

interface ResolvedBus {
  sinkId: string | null;
  pair: OutputPair | null;
  missing: boolean;
  needsPair: boolean;
}

function resolveBus(
  saved: SavedDevice | null,
  available: ReadonlyMap<string, AudioOutputDevice>,
  bus: 'master' | 'cue'
): ResolvedBus {
  if (saved === null) return { sinkId: null, pair: null, missing: false, needsPair: false };
  const device = available.get(saved.deviceId);
  if (!device) return { sinkId: null, pair: null, missing: true, needsPair: false };

  if (saved.pair) {
    // The channel-count probe deliberately degrades to stereo on timeout.
    // An explicit saved choice is stronger knowledge; the bridge validates
    // against the live sink and applies its per-bus failure policy.
    return { sinkId: saved.deviceId, pair: saved.pair, missing: false, needsPair: false };
  }

  const defaults = verifiedRouteDefaults(device.label, device.maxChannelCount);
  if (defaults) {
    return { sinkId: saved.deviceId, pair: defaults[bus], missing: false, needsPair: false };
  }

  // An identified Mapping with unknown channel order must not silently use
  // the hardware's first pair for either bus. Generic devices retain their
  // normal default-output behavior.
  if (audioDeviceMapping(device.label)) {
    return { sinkId: null, pair: null, missing: false, needsPair: true };
  }
  return { sinkId: saved.deviceId, pair: null, missing: false, needsPair: false };
}

export function resolveRouting(
  prefs: RoutingPrefs,
  availableDevices: readonly AudioOutputDevice[]
): ResolvedRouting {
  const available = new Map(availableDevices.map((device) => [device.deviceId, device]));
  const master = resolveBus(prefs.master, available, 'master');
  const cue = resolveBus(prefs.cue, available, 'cue');
  return {
    masterSinkId: master.sinkId,
    masterPair: master.pair,
    masterMissing: master.missing,
    masterNeedsPair: master.needsPair,
    cueSinkId: cue.sinkId,
    cuePair: cue.pair,
    cueMissing: cue.missing,
    cueNeedsPair: cue.needsPair,
  };
}

/**
 * How the resolved routes physically leave the app (four-deck 32).
 *
 * The main context's sink IS the master device: master always plays
 * through the main context's own destination, never over a bridge. A
 * routed-away destination renders pure silence, and after 30s Chromium's
 * SilentSinkSuspender swaps the real sink for a timer-driven fake one
 * whose clock collapses under render load (crbug.com/40247085) — decks
 * audibly drop to ~half speed. Keeping master on the destination means
 * the clock that drives the decks is fed by the audio the room hears.
 *
 * Cue joins the main context (a wider discrete destination + merger)
 * when it targets the SAME device on an explicit pair; only cross-device
 * cue still uses the ADR 0017 MediaStream bridge.
 */
export interface OutputPlan {
  /** Sink for the main context ('' = system default). */
  mainSinkId: string;
  /** Master placement on the main destination; null = plain stereo. */
  masterPairInMain: OutputPair | null;
  /** Cue placement on the main destination (same-device path). */
  cuePairInMain: OutputPair | null;
  /** Cross-device cue delivery over the bridge; null = none. */
  cueBridge: { sinkId: string; pair: OutputPair | null } | null;
}

export function planOutput(route: {
  masterSinkId: string | null;
  masterPair: OutputPair | null;
  cueSinkId: string | null;
  cuePair: OutputPair | null;
}): OutputPlan {
  const mainSinkId = route.masterSinkId ?? '';
  const masterPairInMain = route.masterSinkId === null ? null : route.masterPair;
  if (route.cueSinkId === null) {
    return { mainSinkId, masterPairInMain, cuePairInMain: null, cueBridge: null };
  }
  // Same device + explicit pair → single-context delivery. The system
  // default ('' vs an explicit id) is never treated as the same device:
  // ids alone can't prove identity, and the bridge path is correct there.
  if (route.masterSinkId !== null && route.cueSinkId === route.masterSinkId && route.cuePair) {
    return { mainSinkId, masterPairInMain, cuePairInMain: route.cuePair, cueBridge: null };
  }
  return {
    mainSinkId,
    masterPairInMain,
    cuePairInMain: null,
    cueBridge: { sinkId: route.cueSinkId, pair: route.cuePair },
  };
}

/**
 * Output picker entries (explicit-output-pairs follow-up): a plain stereo
 * device is one entry; a multichannel interface splits into its
 * stereo pairs, labelled 1-based — the Inpulse (one 4-out device,
 * hardware-learned) becomes "… (outs 1/2)" (rear RCA) and "… (outs 3/4)"
 * (front headphone jack).
 */
export function outputPairOptions(devices: readonly AudioOutputDevice[]): SavedDevice[] {
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
export function sameOutputChoice(a: SavedDevice, b: SavedDevice): boolean {
  const pa = a.pair ?? null;
  const pb = b.pair ?? null;
  return (
    a.deviceId === b.deviceId &&
    (pa === null ? pb === null : pb !== null && pa.left === pb.left && pa.right === pb.right)
  );
}

/**
 * Which output channels the Cue bus occupies when the user hasn't chosen a
 * pair explicitly. Only hardware-verified Mapping knowledge may provide a
 * pair; unknown and not-yet-verified devices return null.
 */
export function cueChannelPair(label: string, maxChannelCount: number): OutputPair | null {
  return verifiedRouteDefaults(label, maxChannelCount)?.cue ?? null;
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
