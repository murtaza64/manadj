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
  // Sets
  'manadj-set-settings',
  // Library browsing
  'manadj-playlist-filter-enabled',
  'manadj-column-widths-v1',
  'trackListSort',
  // Playback/mixer preferences
  'manadj-audio-routing',
  'manadj-keylock',
  'manadj-quantize',
  'manadj-crossfader-assignments',
  'manadj-crossfader-enabled',
  // Hardware calibration
  'manadj.grv6JogCalibration',
];

// Dynamic-key families (key = prefix + id), also preferences.
export const PERSISTED_SETTING_PREFIXES: readonly string[] = [
  'manadj-visualizer-params:', // per-preset visualizer param overrides
];

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8127';
const API_BASE = `${BACKEND_URL}/api/settings`;

function isPersistedKey(key: string): boolean {
  return (
    PERSISTED_SETTING_KEYS.includes(key) ||
    PERSISTED_SETTING_PREFIXES.some((p) => key.startsWith(p))
  );
}

/** All inventoried preference values currently in this origin's localStorage. */
function collectLocalSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && isPersistedKey(key)) {
        const value = localStorage.getItem(key);
        if (value !== null) out[key] = value;
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
 * - DB has rows: DB wins — every row is written into localStorage.
 *   Inventoried local keys the DB doesn't know yet (e.g. a preference key
 *   added after the seed) are pushed up.
 * - DB empty: seed it from this origin's localStorage (one-time migration).
 * - Backend unreachable: no-op; the localStorage cache serves as-is.
 */
export async function hydratePersistedSettings(): Promise<void> {
  let rows: Record<string, string>;
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return;
    rows = (await res.json()).settings ?? {};
  } catch {
    return; // offline/backend down — cache serves
  }

  const local = collectLocalSettings();

  if (Object.keys(rows).length === 0) {
    if (Object.keys(local).length === 0) return;
    try {
      await fetch(`${API_BASE}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: local }),
      });
    } catch {
      // best-effort; next boot retries
    }
    return;
  }

  for (const [key, value] of Object.entries(rows)) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // cache write is best-effort
    }
  }
  for (const [key, value] of Object.entries(local)) {
    if (!(key in rows)) void pushSetting(key, value);
  }
}

async function pushSetting(key: string, value: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch {
    // write-through is best-effort; localStorage keeps the value
  }
}

/** Write-through preference write: localStorage cache + fire-and-forget PUT. */
export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // cache write is best-effort
  }
  void pushSetting(key, value);
}

/** Write-through preference removal (reset-to-defaults paths). */
export function removeSetting(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // cache write is best-effort
  }
  void (async () => {
    try {
      await fetch(`${API_BASE}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    } catch {
      // best-effort
    }
  })();
}
