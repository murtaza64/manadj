/**
 * Performance-section visibility store (perf-layout 12 / gh#68): decks and
 * waveforms are independently hideable in Performance mode to reclaim
 * vertical real estate for the embedded library (Set view / Session
 * timeline playback). Module-level subscribable like quantizeStore —
 * layout intent, not Deck state; the TopBar toggles are the writers,
 * PerformanceView is the reader.
 *
 * Hiding is DISPLAY ONLY: consumers hide with `display: none`, never by
 * tearing down engines — audio/transport lives in DeckProvider above the
 * view switch and is untouched.
 */
import { writeSetting } from '../settings/persistedSettings';

export type PerfSection = 'waveforms' | 'decks';

const STORAGE_KEY = 'manadj-perf-sections';

type Shown = Record<PerfSection, boolean>;

/** Default: everything shown; only an explicit false hides a section. */
function load(): Shown {
  const shown: Shown = { waveforms: true, decks: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return shown;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return shown;
    for (const section of ['waveforms', 'decks'] as const) {
      if ((parsed as Record<string, unknown>)[section] === false) {
        shown[section] = false;
      }
    }
  } catch {
    // garbage/unavailable storage → defaults
  }
  return shown;
}

function save(shown: Shown): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify(shown));
}

let shown = load();
const listeners = new Set<() => void>();

export function subscribePerfSections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPerfSectionShown(section: PerfSection): boolean {
  return shown[section];
}

export function setPerfSectionShown(section: PerfSection, on: boolean): void {
  if (shown[section] === on) return;
  shown = { ...shown, [section]: on };
  save(shown);
  for (const listener of listeners) listener();
}

export function togglePerfSection(section: PerfSection): void {
  setPerfSectionShown(section, !shown[section]);
}
