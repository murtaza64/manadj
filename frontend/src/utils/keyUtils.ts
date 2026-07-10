/**
 * Utilities for converting between musical keys and OpenKey notation.
 *
 * OpenKey notation uses:
 * - 1m-12m for minor keys
 * - 1d-12d for major keys
 *
 * Engine DJ IDs (0-23) are used internally in the database.
 *
 * All mapping tables are derived from `keyTable.generated.ts`, which is
 * generated from `backend/key.py` (the single Key authority). This module
 * holds no hand-maintained key data — change `key.py` and regenerate.
 */

import { KEY_TABLE, ENHARMONICS } from './keyTable.generated';

// Engine DJ ID (0-23) → OpenKey, derived from the generated table.
const ENGINE_ID_TO_OPENKEY: Record<number, string> = Object.fromEntries(
  KEY_TABLE.map((row) => [row.engineId, row.openkey])
);

// Reverse mapping: OpenKey → Engine DJ ID
const OPENKEY_TO_ENGINE_ID: Record<string, number> = Object.fromEntries(
  KEY_TABLE.map((row) => [row.openkey, row.engineId])
);

// Musical key notation → OpenKey. The canonical musical spelling of each key
// plus every enharmonic/alternative spelling (Gb→F#'s slot, C# Minor→C#m's, …).
const KEY_TO_OPENKEY: Record<string, string> = (() => {
  const musicalToOpenKey = new Map(KEY_TABLE.map((row) => [row.musical, row.openkey]));
  const map: Record<string, string> = {};
  for (const [musical, openkey] of musicalToOpenKey) {
    map[musical] = openkey;
  }
  for (const [alt, canonical] of Object.entries(ENHARMONICS)) {
    const openkey = musicalToOpenKey.get(canonical);
    if (openkey) map[alt] = openkey;
  }
  return map;
})();

// Reverse mapping: OpenKey → canonical musical key notation.
const OPENKEY_TO_KEY: Record<string, string> = Object.fromEntries(
  KEY_TABLE.map((row) => [row.openkey, row.musical])
);

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

