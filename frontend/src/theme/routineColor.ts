/**
 * THE routine accent (gh#170 follow-up): one design token for every
 * Routine surface — cast brackets, ◆ chips/tags, pin picker tiers, the
 * ladder's ◆ ROUTINE bands, session-timeline region guides, the Routine
 * editor's chrome.
 *
 * CHARTREUSE, bright and fully saturated (project preference), chosen to
 * read distinct IN SITU from every neighboring accent: the four deck
 * colors (A cyan #00e5ff, B pink #ff2d95, C orange #ff7a00, D violet
 * #8f4dff — the old routine magenta collided with B on busy timelines),
 * the Cameo accent (#140 introduces hot orange), warning amber, and
 * error red.
 *
 * TS/canvas consumers import ROUTINE_ACCENT; CSS consumers use the
 * variables installed at boot (main.tsx): `--routine-accent` and
 * `--routine-accent-rgb` (comma triplet for alpha washes) — the deck
 * color idiom.
 */
export const ROUTINE_ACCENT = '#a8ff00';
export const ROUTINE_ACCENT_RGB = '168,255,0';
/** Dark ink for text ON the accent (chips/flags). */
export const ROUTINE_ACCENT_INK = '#101400';

export function installRoutineColorVars(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement
): void {
  root.style.setProperty('--routine-accent', ROUTINE_ACCENT);
  root.style.setProperty('--routine-accent-rgb', ROUTINE_ACCENT_RGB);
  root.style.setProperty('--routine-accent-ink', ROUTINE_ACCENT_INK);
}
