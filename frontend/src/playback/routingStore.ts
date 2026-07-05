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

/** Secondary mixers following the MASTER sink (headphone-cue 06): the
 * Transition editor's private Mixer plays to the system default unless
 * routed too — "editor comes out of the headphones". Master only: the cue
 * bridge stays exclusive to the primary mixer. */
type MasterRoutable = Pick<Mixer, 'setMasterSinkId'>;
const secondaryMixers = new Set<MasterRoutable>();

let prefs: RoutingPrefs = loadPrefs();
let devices: AudioOutputDevice[] = [];
let snapshot: RoutingSnapshot = {
  prefs,
  resolved: resolveRouting(prefs, []),
  devices,
};
const listeners = new Set<() => void>();

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
  const resolved = resolveRouting(prefs, devices.map((d) => d.deviceId));
  snapshot = { prefs, resolved, devices };
  notify();
  for (const secondary of secondaryMixers) {
    void applyMasterSink(secondary, resolved.masterSinkId);
  }
  if (!mixer) return;
  await applyMasterSink(mixer, resolved.masterSinkId);
  try {
    await mixer.setCueSinkId(resolved.cueSinkId, resolved.cuePair);
  } catch (err) {
    // setCueSinkId already disabled itself; just surface it.
    console.warn('[routing] cue sink failed; cue bus disabled', err);
  }
}

async function applyMasterSink(target: MasterRoutable, sinkId: string | null): Promise<void> {
  try {
    await target.setMasterSinkId(sinkId);
  } catch (err) {
    console.warn('[routing] master sink failed; falling back to default', err);
    await target.setMasterSinkId(null).catch(() => undefined);
  }
}

/**
 * Follow the routed MASTER device with an additional Mixer (the editor's
 * private one). Applies the currently-resolved sink immediately and on
 * every recompute; never the cue sink. Returns an unregister.
 */
export function registerRoutedMixer(target: MasterRoutable): () => void {
  secondaryMixers.add(target);
  void applyMasterSink(target, snapshot.resolved.masterSinkId);
  return () => {
    secondaryMixers.delete(target);
  };
}

/** Enumerate (may unlock labels — see audioDevices.ts) and re-apply. */
export async function refreshRouting(): Promise<void> {
  devices = await listAudioOutputs();
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
    if (mixer === target) mixer = null;
  };
}
