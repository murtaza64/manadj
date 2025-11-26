/**
 * Utilities for converting between musical keys and OpenKey notation.
 *
 * OpenKey notation uses:
 * - 1m-12m for minor keys
 * - 1d-12d for major keys
 *
 * Engine DJ IDs (0-23) are used internally in the database.
 */

// Engine DJ ID (0-23) → OpenKey
const ENGINE_ID_TO_OPENKEY: Record<number, string> = {
  0: '1d',   // C
  1: '1m',   // Am
  2: '2d',   // G
  3: '2m',   // Em
  4: '3d',   // D
  5: '3m',   // Bm
  6: '4d',   // A
  7: '4m',   // F#m
  8: '5d',   // E
  9: '5m',   // C#m
  10: '6d',  // B
  11: '6m',  // G#m
  12: '7d',  // F#
  13: '7m',  // D#m
  14: '8d',  // Db
  15: '8m',  // Bbm
  16: '9d',  // Ab
  17: '9m',  // Fm
  18: '10d', // Eb
  19: '10m', // Cm
  20: '11d', // Bb
  21: '11m', // Gm
  22: '12d', // F
  23: '12m', // Dm
};

// Reverse mapping: OpenKey → Engine DJ ID
const OPENKEY_TO_ENGINE_ID: Record<string, number> = Object.fromEntries(
  Object.entries(ENGINE_ID_TO_OPENKEY).map(([id, openkey]) => [openkey, parseInt(id)])
);

// Mapping from musical key notation to OpenKey notation
const KEY_TO_OPENKEY: Record<string, string> = {
  // Major keys (d notation)
  'C': '1d', 'G': '2d', 'D': '3d', 'A': '4d', 'E': '5d', 'B': '6d',
  'F#': '7d', 'Gb': '7d', 'Db': '8d', 'C#': '8d', 'Ab': '9d', 'Eb': '10d',
  'Bb': '11d', 'F': '12d',
  // Minor keys (m notation)
  'Am': '1m', 'Em': '2m', 'Bm': '3m', 'F#m': '4m', 'Gbm': '4m',
  'C#m': '5m', 'Dbm': '5m', 'G#m': '6m', 'Abm': '6m', 'D#m': '7m',
  'Ebm': '7m', 'Bbm': '8m', 'Fm': '9m', 'Cm': '10m', 'Gm': '11m', 'Dm': '12m',
};

// Reverse mapping from OpenKey notation to musical key notation
const OPENKEY_TO_KEY: Record<string, string> = {
  // Major keys (d notation)
  '1d': 'C', '2d': 'G', '3d': 'D', '4d': 'A', '5d': 'E', '6d': 'B',
  '7d': 'F#', '8d': 'Db', '9d': 'Ab', '10d': 'Eb', '11d': 'Bb', '12d': 'F',
  // Minor keys (m notation)
  '1m': 'Am', '2m': 'Em', '3m': 'Bm', '4m': 'F#m', '5m': 'C#m',
  '6m': 'G#m', '7m': 'D#m', '8m': 'Bbm', '9m': 'Fm', '10m': 'Cm',
  '11m': 'Gm', '12m': 'Dm',
};

/**
 * Convert Engine DJ ID to OpenKey notation.
 *
 * @param engineId - Engine DJ key ID (0-23)
 * @returns OpenKey notation like '1m', '1d', etc., or null if engineId is invalid/null
 *
 * @example
 * engineIdToOpenKey(0)  // '1d' (C)
 * engineIdToOpenKey(1)  // '1m' (Am)
 * engineIdToOpenKey(7)  // '4m' (F#m)
 */
export function engineIdToOpenKey(engineId: number | null | undefined): string | null {
  if (engineId === null || engineId === undefined) {
    return null;
  }
  return ENGINE_ID_TO_OPENKEY[engineId] || null;
}

/**
 * Convert OpenKey notation to Engine DJ ID.
 *
 * @param openkey - OpenKey notation like '1m', '1d', etc.
 * @returns Engine DJ key ID (0-23) or null if openkey is invalid/null
 *
 * @example
 * openKeyToEngineId('1d')  // 0 (C)
 * openKeyToEngineId('1m')  // 1 (Am)
 * openKeyToEngineId('4m')  // 7 (F#m)
 */
export function openKeyToEngineId(openkey: string | null | undefined): number | null {
  if (!openkey) {
    return null;
  }
  return OPENKEY_TO_ENGINE_ID[openkey] ?? null;
}

/**
 * Convert musical key notation to OpenKey notation.
 *
 * @param key - Musical key like 'Am', 'C', 'F#m', etc.
 * @returns OpenKey notation like '1m', '1d', etc., or null if key is invalid/null
 *
 * @example
 * keyToOpenKey('Am')  // '1m'
 * keyToOpenKey('C')   // '1d'
 * keyToOpenKey('F#m') // '4m'
 */
export function keyToOpenKey(key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }
  return KEY_TO_OPENKEY[key] || null;
}

/**
 * Convert OpenKey notation to musical key notation.
 *
 * @param openkey - OpenKey notation like '1m', '1d', etc.
 * @returns Musical key like 'Am', 'C', etc., or null if openkey is invalid/null
 *
 * @example
 * openKeyToKey('1m')  // 'Am'
 * openKeyToKey('1d')  // 'C'
 * openKeyToKey('4m') // 'F#m'
 */
export function openKeyToKey(openkey: string | null | undefined): string | null {
  if (!openkey) {
    return null;
  }
  return OPENKEY_TO_KEY[openkey] || null;
}

/**
 * Get all valid OpenKey key notations in order.
 *
 * @returns Array of all OpenKey keys: ['1m', '2m', ..., '12m', '1d', '2d', ..., '12d']
 */
export function getAllOpenKeys(): string[] {
  // Generate in order: all m keys (minor) then all d keys (major)
  const keys: string[] = [];
  for (let num = 1; num <= 12; num++) {
    keys.push(`${num}m`);
  }
  for (let num = 1; num <= 12; num++) {
    keys.push(`${num}d`);
  }
  return keys;
}

/**
 * Format a key for display using OpenKey notation.
 * Accepts either Engine DJ ID (number) or musical key (string).
 *
 * @param key - Engine DJ key ID (0-23) or musical key like 'Am', 'C', 'F#m', etc.
 * @returns OpenKey notation or '-' if key is invalid/null
 *
 * @example
 * formatKeyDisplay(0)     // '1d'
 * formatKeyDisplay(7)     // '4m'
 * formatKeyDisplay('Am')  // '1m'
 * formatKeyDisplay('C')   // '1d'
 * formatKeyDisplay(null)  // '-'
 */
export function formatKeyDisplay(key: number | string | null | undefined): string {
  if (typeof key === 'number') {
    const openkey = engineIdToOpenKey(key);
    return openkey || '-';
  }
  const openkey = keyToOpenKey(key);
  return openkey || '-';
}

// Legacy exports for backwards compatibility during transition
export const keyToCamelot = keyToOpenKey;
export const camelotToKey = openKeyToKey;
export const getAllCamelotKeys = getAllOpenKeys;
