/**
 * Audio routing store (headphone-cue 04): the module-level home of "which
 * device does each bus play from". Persists device choices (localStorage —
 * the codebase's UI-preference pattern), re-resolves them against what's
 * actually plugged in (routing.ts, the tested seam), and applies the result
 * to the Mixer. Lives outside React like connectionStore; the picker
 * subscribes via useSyncExternalStore.
 *
 * Failure policy (PRD): master falls back to the system default, the Cue
 * bus degrades to disabled — audio is never dead because a saved device is
 * gone. A devicechange re-resolves, so unplugging the cue device tears the
 * bridge down mid-session and replugging it restores the route.
 */
import { listAudioOutputs, onAudioDevicesChanged } from './audioDevices';
import type { AudioOutputDevice } from './audioDevices';
import { DEFAULT_ROUTING_PREFS, parseRoutingPrefs, resolveRouting } from './routing';
import type { ResolvedRouting, RoutingPrefs, SavedDevice } from './routing';
import type { Mixer } from './mixer';

const STORAGE_KEY = 'manadj-audio-routing';

export interface RoutingSnapshot {
  prefs: RoutingPrefs;
  resolved: ResolvedRouting;
  devices: AudioOutputDevice[];
}

function loadPrefs(): RoutingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseRoutingPrefs(JSON.parse(raw)) : DEFAULT_ROUTING_PREFS;
  } catch {
    return DEFAULT_ROUTING_PREFS;
  }
}

function savePrefs(prefs: RoutingPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // persistence is best-effort; the session still routes
  }
}

let mixer: Mixer | null = null;

/** The routable slice of the Mixer. There is exactly one Mixer since
 * ADR 0022 — the secondary-mixer registry (ADR 0021, retired) lived here
 * while the Transition editor had a private one. */
type MasterRoutable = Pick<Mixer, 'setMasterSinkId'>;

let prefs: RoutingPrefs = loadPrefs();
let devices: AudioOutputDevice[] = [];
let snapshot: RoutingSnapshot = {
  prefs,
  resolved: resolveRouting(prefs, devices),
  devices,
};
const listeners = new Set<() => void>();
let routingRevision = 0;
let refreshRevision = 0;
let applyQueue: Promise<void> = Promise.resolve();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeRouting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for useSyncExternalStore; replaced on every change. */
export function getRoutingSnapshot(): RoutingSnapshot {
  return snapshot;
}

/** Re-resolve against the current device list and push the sinks at the
 * Mixer. Apply failures degrade per the PRD and never throw. */
async function recompute(): Promise<void> {
  const resolved = resolveRouting(prefs, devices);
  const revision = ++routingRevision;
  snapshot = { prefs, resolved, devices };
  notify();
  const target = mixer;
  if (!target) return;
  // Sink changes can take long enough for another picker/devicechange update
  // to arrive. Serialize them, skip stale queued work, and always finish on
  // the newest complete Master+Cue route.
  applyQueue = applyQueue.then(async () => {
    if (revision !== routingRevision || mixer !== target) return;
    await applyMasterSink(target, resolved.masterSinkId, resolved.masterPair);
    if (revision !== routingRevision || mixer !== target) return;
    try {
      await target.setCueSinkId(resolved.cueSinkId, resolved.cuePair);
    } catch (err) {
      // setCueSinkId already disabled itself; just surface it.
      console.warn('[routing] cue sink failed; cue bus disabled', err);
    }
  });
  await applyQueue;
}

async function applyMasterSink(
  target: MasterRoutable,
  sinkId: string | null,
  pair: SavedDevice['pair'] = null
): Promise<void> {
  try {
    await target.setMasterSinkId(sinkId, pair ?? null);
  } catch (err) {
    console.warn('[routing] master sink failed; falling back to default', err);
    await target.setMasterSinkId(null, null).catch(() => undefined);
  }
}

/** Enumerate (may unlock labels — see audioDevices.ts) and re-apply. */
export async function refreshRouting(): Promise<void> {
  const revision = ++refreshRevision;
  const nextDevices = await listAudioOutputs();
  if (revision !== refreshRevision) return;
  devices = nextDevices;
  await recompute();
}

/** User-requested hard refresh: discard session channel-count probes before
 * enumerating. Useful immediately after a multichannel device is plugged in. */
export async function forceRefreshRouting(): Promise<void> {
  const revision = ++refreshRevision;
  const nextDevices = await listAudioOutputs(true);
  if (revision !== refreshRevision) return;
  devices = nextDevices;
  await recompute();
}

export function setMasterDevice(device: SavedDevice | null): void {
  prefs = { ...prefs, master: device };
  savePrefs(prefs);
  void recompute();
}

export function setCueDevice(device: SavedDevice | null): void {
  prefs = { ...prefs, cue: device };
  savePrefs(prefs);
  void recompute();
}

/**
 * Boot wiring (mounted once by AudioRoutingBridge). Skips enumeration when
 * nothing is saved — never hit the permission path for users who haven't
 * touched routing; the picker refreshes on open instead. Returns a dispose.
 */
export function initAudioRouting(target: Mixer): () => void {
  mixer = target;
  const saved = () => prefs.master !== null || prefs.cue !== null;
  if (saved()) void refreshRouting();
  // Same guard on plug/unplug: only re-enumerate (and possibly walk the
  // permission path) for setups that actually route somewhere.
  const unsubscribe = onAudioDevicesChanged(() => {
    if (saved()) void refreshRouting();
  });
  return () => {
    unsubscribe();
    if (mixer === target) {
      mixer = null;
      routingRevision++;
    }
  };
}
