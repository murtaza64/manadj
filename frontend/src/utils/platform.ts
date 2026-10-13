/**
 * Platform-aware primary modifier: Cmd on macOS, Ctrl on Windows/Linux.
 *
 * Chords that are "Cmd-only" on macOS (Cmd held, Ctrl not) map to
 * "Ctrl-only" elsewhere — Win/Super is reserved by the OS there.
 */

export type Platform = 'mac' | 'other';

let override: Platform | null = null;

function detect(): Platform {
  if (typeof navigator === 'undefined') return 'mac';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  // navigator.platform first: always set in Chromium/Electron ('MacIntel',
  // 'Win32', 'Linux x86_64'); userAgentData follows UA overrides.
  const name = nav.platform || nav.userAgentData?.platform || '';
  if (name) return /mac|iphone|ipad/i.test(name) ? 'mac' : 'other';
  return /windows|linux|cros|android/i.test(nav.userAgent ?? '') ? 'other' : 'mac';
}

export function platform(): Platform {
  return override ?? detect();
}

export function isMac(): boolean {
  return platform() === 'mac';
}

/** Tests only: pin the platform (null restores detection). */
export function setPlatformOverride(next: Platform | null): void {
  override = next;
}

/** The primary modifier alone (no Ctrl on mac / no Meta elsewhere, no Alt). */
export function isPrimaryChord(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  if (event.altKey) return false;
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Word label for titles: "Cmd" / "Ctrl". */
export function primaryModName(): string {
  return isMac() ? 'Cmd' : 'Ctrl';
}

/** Single-glyph keycap: ⌘ on mac, ⌃ (rendered as a caret) elsewhere. */
export function primaryModGlyph(): string {
  return isMac() ? '\u2318' : '\u2303';
}

/** Compact chord label: "⌘⇧Z" on mac, "Ctrl+Shift+Z" elsewhere. */
export function primaryChordLabel(key: string, { shift = false }: { shift?: boolean } = {}): string {
  if (isMac()) return `\u2318${shift ? '\u21e7' : ''}${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}
