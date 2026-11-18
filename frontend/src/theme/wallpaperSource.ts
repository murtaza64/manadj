/**
 * Wallpaper-derived theme source (gh#470).
 *
 * Fetches the wal-palette/1 palette from the backend (which adapts the
 * wallpaper tool's real cache file), applies the mapped overrides on top of
 * the installed base theme, and polls the file mtime so re-running the
 * wallpaper tool updates manaDJ live. The source only ever consumes the
 * internal contract; any backend refusal (404/422) keeps the current theme.
 *
 * The wallpaper source owns exactly the variables its mapper emits; the base
 * installTheme keeps ownership of every other variable.
 *
 * The palette endpoint is device-local: it reads the wallpaper tool's cache
 * file on the machine the backend runs on. It is not a library or remote-sync
 * path; a remote device's backend serves that device's own wallpaper only.
 * The opt-in is likewise device-local by design: it lives in raw per-origin
 * localStorage and is deliberately NOT in PERSISTED_SETTING_KEYS, so the
 * DB-backed settings sync can never carry one machine's wallpaper choice
 * onto another host.
 */

import { API_BASE } from '../api/client';
import { CSS_VARS } from './tokens';
import { mapWalPalette, validateWalPalette, type CssVarMap } from './walPalette';

const STORAGE_KEY = 'manadj.wallpaperTheme.enabled';
const POLL_MS = 3000;

interface WallpaperPaletteResponse {
  palette: unknown;
  mtime: number;
}

/** Stable identity of a validated palette's actual colors. Compared instead
 * of mtime: a re-written file with an equal or older timestamp still applies,
 * and identical colors never re-apply. */
function paletteIdentity(palette: WalPalette): string {
  const c = palette.colors;
  return [c.background, c.foreground, c.cursor, ...c.ansi].join(',');
}

export function isWallpaperThemeEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

async function fetchPalette(): Promise<WallpaperPaletteResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/theme/wallpaper-palette`);
    if (!response.ok) return null; // 404 no palette yet; 422 refused wholesale
    return (await response.json()) as WallpaperPaletteResponse;
  } catch {
    return null; // backend down or unreachable: keep current theme
  }
}

/** Apply wallpaper overrides over the installed base theme. */
export function applyWallpaperOverrides(overrides: CssVarMap): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(overrides)) style.setProperty(name, value);
}

/** Restore every wallpaper-owned variable to its base-theme value. */
export function clearWallpaperOverrides(overrides: CssVarMap): void {
  const style = document.documentElement.style;
  for (const name of Object.keys(overrides)) {
    const base = CSS_VARS[name as keyof typeof CSS_VARS];
    if (base !== undefined) style.setProperty(name, base);
    else style.removeProperty(name);
  }
}

let applied: CssVarMap | null = null;
let appliedIdentity: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function refresh(): Promise<void> {
  if (inFlight) return; // slow backend: never stack overlapping polls; polling
  // is strictly sequential, so responses cannot arrive out of order.
  inFlight = true;
  try {
    const result = await fetchPalette();
    if (!result) return;
    const parsed = validateWalPalette(result.palette);
    if (!parsed.ok) return; // refused palette never touches applied state
    const identity = paletteIdentity(parsed.palette);
    if (appliedIdentity === identity) return; // same colors: no re-apply
    const { cssOverrides: overrides } = mapWalPalette(parsed.palette);
    if (applied) clearWallpaperOverrides(applied);
    applyWallpaperOverrides(overrides);
    applied = overrides;
    appliedIdentity = identity;
  } finally {
    inFlight = false;
  }
}

/** Opt in and start watching the wallpaper palette. */
export function enableWallpaperTheme(): void {
  localStorage.setItem(STORAGE_KEY, '1');
  if (timer === null) timer = setInterval(refresh, POLL_MS);
  void refresh();
}

/** Opt out: restore the base theme values and stop watching. */
export function disableWallpaperTheme(): void {
  localStorage.removeItem(STORAGE_KEY);
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (applied) {
    clearWallpaperOverrides(applied);
    applied = null;
  }
  appliedIdentity = null;
}

/** Called once at boot, after installTheme, when the user has opted in. */
export function initWallpaperTheme(): void {
  if (isWallpaperThemeEnabled()) enableWallpaperTheme();
}
