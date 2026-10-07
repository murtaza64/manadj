/**
 * Persisted-settings seam (settings, #176): UI preferences live in the app
 * DB (`settings` table) so sandbox/lane clones inherit the real app's
 * preferences; per-origin localStorage is a write-through cache.
 *
 * Boot (main.tsx) awaits hydratePersistedSettings() BEFORE importing App,
 * so every module-level store that reads localStorage at import time sees
 * the DB's values already in the cache. Stores keep reading via
 * localStorage.getItem; writes go through writeSetting/removeSetting.
 *
 * One-time migration: against a DB with no settings rows, the current
 * origin's localStorage inventory is seeded up (POST /seed — backend
 * applies it only while the table is empty, so a fresh clone's empty
 * localStorage can never clobber the real app's rows).
 *
 * Values are the raw localStorage strings — often JSON, sometimes bare
 * tokens ('true', a preset id). The seam does not interpret them.
 *
 * Shipped defaults (setup-guides #293): GET /defaults returns Murtaza's
 * snapshotted preferences. Hydration writes one into the cache only when
 * its key is unset (no DB row, no journaled edit, no local value). Applied
 * defaults stay out of the DB: local values equal to their shipped default
 * are never seeded/pushed, so a later re-snapshot still reaches unset keys.
 */

// ── Inventory of persisted-preference keys ──────────────────────────────
// Every localStorage key that is a *preference* (should look identical on
// every instance sharing the DB). Per-instance ephemera stay out:
//   manadj-app-mode              last-opened view (session state)
//   manadj-last-pair             last-opened editor pair
//   manadj-transition-active     active take/transition selection per pair
//   manadj-loaded-tracks         what's loaded on the decks
//   manadj-crossfader-position   live fader position (playback state)
//   manadj-transition-pairs*, PROTOTYPE-*, findRelatedTracksSettings
//                                legacy/migration keys (pairStore owns them)

export const PERSISTED_SETTING_KEYS: readonly string[] = [
  // Waveform colors/styles — first-class (issue #176)
  'manadj.waveformStyles',
  // Visualizer
  'manadj-visualizer-preset',
  'manadj-visualizer-quality',
  'manadj-visualizer-cycle',
  'manadj-visualizer-hud',
  // Follow
  'manadj-follow-params',
  'manadj-follow-flags',
  // Performance view
  'manadj-perf-sections',
  'perf-kbd-hints',
  'manadj-perf-deck-count',
  'manadj-mouse-jog',
  'manadj-soft-takeover',
  // Sets
  'manadj-set-settings',
  // Library browsing
  'manadj-playlist-filter-enabled',
  'manadj-column-widths-v1',
  'manadj-column-order-v1',
  'trackListSort',
  // Playback/mixer preferences
  'manadj-audio-routing',
  'manadj-keylock',
  'manadj-quantize',
  'manadj-cue-mode',
  'manadj-crossfader-assignments',
  'manadj-crossfader-enabled',
  'manadj-filter-settings',
  'manadj-beat-fx-settings',
  // Hardware calibration
  'manadj.grv6JogCalibration',
  // Coach-mark tour progress (feature-tour #282)
  'manadj-tour-state',
  'manadj-tutorial-state',
  // Setup guides (guide status: done / skipped)
  'manadj-setup-state',
];

// Dynamic-key families (key = prefix + id), also preferences.
export const PERSISTED_SETTING_PREFIXES: readonly string[] = [
  'manadj-visualizer-params:', // per-preset visualizer param overrides
];

// Same resolution as api/client.ts: production builds default to same-origin
// (backend-served frontend, packaged app #279).
const BACKEND_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8127' : '');
const API_BASE = `${BACKEND_URL}/api/settings`;
// Per-origin recovery journal, not a library preference or part of the seed inventory.
const PENDING_KEY = 'manadj-pending-settings';

function readPending(): Record<string, string | null> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => isPersistedKey(key) && (value === null || typeof value === 'string')));
  } catch { return {}; }
}

function journal(key: string, value: string | null, acknowledged = false): void {
  try {
    const pending = readPending();
    if (acknowledged) {
      if (pending[key] !== value) return; // a newer edit still needs to reach the DB
      delete pending[key];
    } else pending[key] = value;
    if (Object.keys(pending).length) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable: in-memory serialization still applies */ }
}

function isPersistedKey(key: string): boolean {
  return (
    PERSISTED_SETTING_KEYS.includes(key) ||
    PERSISTED_SETTING_PREFIXES.some((p) => key.startsWith(p))
  );
}

let shippedDefaults: Record<string, string> = {};

/** Shipped default for a key (after hydration), or null. */
export function shippedDefault(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(shippedDefaults, key) ? shippedDefaults[key] : null;
}

async function fetchShippedDefaults(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${API_BASE}/defaults`);
    if (!res.ok) return {};
    const body: unknown = (await res.json())?.defaults;
    if (!body || typeof body !== 'object') return {};
    return Object.fromEntries(
      Object.entries(body).filter(([key, value]) => isPersistedKey(key) && typeof value === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Cache-only: fill unset keys with their shipped default. */
function applyShippedDefaults(rows: Record<string, string>, pending: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(shippedDefaults)) {
    if (key in rows || key in pending) continue;
    try {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    } catch { /* cache is best-effort */ }
  }
}

/** All inventoried preference values currently in this origin's localStorage
 *  (minus values that are just their shipped default). */
function collectLocalSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && isPersistedKey(key)) {
        const value = localStorage.getItem(key);
        if (value !== null && value !== shippedDefault(key)) out[key] = value;
      }
    }
  } catch {
    // localStorage unavailable: nothing to collect.
  }
  return out;
}

/**
 * Hydrate the localStorage cache from the DB (awaited before App import).
 *
 * - DB has rows: DB wins, except locally journaled edits not yet acknowledged.
 *   Inventoried local keys the DB doesn't know yet (e.g. a preference key
 *   added after the seed) are pushed up.
 * - DB empty: seed it from this origin's localStorage (one-time migration).
 * - Backend unreachable: no-op; the localStorage cache serves as-is.
 */
export async function hydratePersistedSettings(): Promise<void> {
  let rows: Record<string, string>;
  const defaultsRequest = fetchShippedDefaults();
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return;
    rows = (await res.json()).settings ?? {};
  } catch {
    return; // offline/backend down — cache serves
  }
  shippedDefaults = await defaultsRequest;

  const pending = readPending();
  for (const [key, value] of Object.entries(pending)) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* cache is best-effort */ }
  }
  const local = collectLocalSettings();

  if (Object.keys(rows).length === 0) {
    if (Object.keys(local).length > 0) try {
      await fetch(`${API_BASE}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: local }),
      });
    } catch {
      // best-effort; next boot retries
    }
    for (const [key, value] of Object.entries(pending)) queueSetting(key, value);
    applyShippedDefaults(rows, pending);
    return;
  }

  for (const [key, value] of Object.entries(rows)) {
    if (key in pending) continue;
    try {
      localStorage.setItem(key, value);
    } catch {
      // cache write is best-effort
    }
  }
  for (const [key, value] of Object.entries(local)) {
    if (!(key in rows) && !(key in pending)) queueSetting(key, value);
  }
  for (const [key, value] of Object.entries(pending)) queueSetting(key, value);
  applyShippedDefaults(rows, pending);
}

const pendingWrites = new Map<string, string | null>();
const writing = new Set<string>();

/** One in-flight write per key; slider bursts collapse to their newest value. */
function queueSetting(key: string, value: string | null): void {
  journal(key, value);
  pendingWrites.set(key, value);
  if (writing.has(key)) return;
  writing.add(key);
  void (async () => {
    try {
      while (pendingWrites.has(key)) {
        const next = pendingWrites.get(key)!;
        pendingWrites.delete(key);
        try {
          const response = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
            method: next === null ? 'DELETE' : 'PUT',
            ...(next === null ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: next }) }),
            keepalive: true,
          });
          if (response.ok) journal(key, next, true);
        } catch {
          // Best effort, as before; the synchronous cache keeps the latest value.
        }
      }
    } finally { writing.delete(key); }
  })();
}

/** Write-through preference write: localStorage cache + fire-and-forget PUT. */
export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // cache write is best-effort
  }
  queueSetting(key, value);
}

/** Write-through preference removal (reset-to-defaults paths). */
export function removeSetting(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // cache write is best-effort
  }
  queueSetting(key, null);
}
