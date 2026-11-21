/**
 * Heard (latency-compensated) Quantize store — desktop port of Android's
 * #382 HEARD mode. Alignment gestures (launches, hot-cue triggers and
 * sets, auto-loop engages) are read at the HEARD instant — L·rate before
 * the render playhead — and land advanced by the elapsed L·rate, so they
 * line up at the speaker instead of at the render position. L is the
 * current output route's latency: the performer's calibrated/nudged value
 * when set, else the output device's reported latency (Android:
 * `EngineSnapshot.reportedLatencySeconds()`; desktop: the master
 * AudioContext's baseLatency + outputLatency).
 *
 * Module-level like quantizeStore: Heard is performer intent, not a Deck
 * or view property. The mixer strip's HEARD cluster and Settings are the
 * writers; DeckEngine reads `heardSeconds()` at gesture time. Default OFF
 * (Grid semantics) — a wrong L is worse than none.
 *
 * The store is dependency-free: the route identity and the reported
 * latency come from a provider DeckContext registers (routingStore owns
 * the device, the Mixer owns the AudioContext).
 */
import { writeSetting } from '../settings/persistedSettings';

const MODE_KEY = 'manadj-heard';
const LATENCY_KEY = 'manadj-heard-latency';

/** Nudge bounds (Android clamps 0..2 s). */
export const HEARD_LATENCY_MAX_SECONDS = 2;
export const HEARD_LATENCY_STEP_SECONDS = 0.005;

/** The current output route's identity and reported latency. */
export interface HeardRoute {
  /** Stable per-device key (the master sink id; 'default' for the system route). */
  key: string;
  label: string;
  /** Device-reported output latency in seconds (0 = unknown). */
  reportedSeconds: number;
}

export interface HeardSnapshot extends HeardRoute {
  on: boolean;
  /** L in effect: the route's override when set, else its reported latency. */
  seconds: number;
  /** True when `seconds` is the performer's value, not the device's report. */
  overridden: boolean;
}

function loadMode(): boolean {
  try {
    // Default OFF: only an explicit 'true' turns Heard on.
    return localStorage.getItem(MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadOverrides(): Record<string, { label: string; seconds: number }> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LATENCY_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, { label: string; seconds: number }> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const { label, seconds } = value as { label?: unknown; seconds?: unknown };
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) continue;
      if (seconds < 0 || seconds > HEARD_LATENCY_MAX_SECONDS) continue;
      out[key] = { label: typeof label === 'string' ? label : key, seconds };
    }
    return out;
  } catch {
    return {};
  }
}

let on = loadMode();
let overrides = loadOverrides();
let routeProvider: () => HeardRoute = () => ({
  key: 'default',
  label: 'System default',
  reportedSeconds: 0,
});
const listeners = new Set<() => void>();

function persist(): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(MODE_KEY, String(on));
  writeSetting(LATENCY_KEY, JSON.stringify(overrides));
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeHeard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** DeckContext registers the live route source (routingStore + Mixer). */
export function registerHeardRouteProvider(provider: () => HeardRoute): void {
  routeProvider = provider;
  notify();
}

export function isHeardOn(): boolean {
  return on;
}

export function setHeard(next: boolean): void {
  if (next === on) return;
  on = next;
  persist();
  notify();
}

/** The route's effective latency, whether or not Heard is on (for the UI).
 * useSyncExternalStore-safe: identity is stable while every field is
 * unchanged, so a live reported-latency revision surfaces on the next
 * render without an extra notify. */
let cachedSnapshot: HeardSnapshot | null = null;
export function heardRoute(): HeardSnapshot {
  const route = routeProvider();
  const override = overrides[route.key];
  const seconds = override?.seconds ?? route.reportedSeconds;
  if (
    cachedSnapshot &&
    cachedSnapshot.on === on &&
    cachedSnapshot.key === route.key &&
    cachedSnapshot.label === route.label &&
    cachedSnapshot.reportedSeconds === route.reportedSeconds &&
    cachedSnapshot.seconds === seconds &&
    cachedSnapshot.overridden === (override !== undefined)
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = {
    ...route,
    on,
    seconds,
    overridden: override !== undefined,
  };
  return cachedSnapshot;
}

/** L at gesture time (0 = render-time Grid reads). */
export function heardSeconds(): number {
  return on ? heardRoute().seconds : 0;
}

/** Set/clear the current route's latency override (null = back to reported). */
export function setRouteLatency(seconds: number | null): void {
  const route = routeProvider();
  if (seconds === null) {
    if (!(route.key in overrides)) return;
    delete overrides[route.key];
  } else {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.min(HEARD_LATENCY_MAX_SECONDS, Math.max(0, seconds));
    if (overrides[route.key]?.seconds === clamped) return;
    overrides = { ...overrides, [route.key]: { label: route.label, seconds: clamped } };
  }
  persist();
  notify();
}

/** Nudge the current route's latency by a signed step (always materializes
 * an override, seeded from the effective value — like Android's sheet). */
export function nudgeRouteLatency(deltaSeconds: number): void {
  setRouteLatency(heardRoute().seconds + deltaSeconds);
}
