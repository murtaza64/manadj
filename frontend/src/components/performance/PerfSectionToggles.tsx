/**
 * Performance-section toggles (perf-layout 12 / gh#68): WAVE and DECK
 * buttons, lit green while the section is shown — same button language as
 * KBD. They ride the mixer strip's left cell next to KBD (the strip is the
 * one surface that never hides, so the toggles stay reachable with
 * everything collapsed). Display-only: they flip the perfSectionsStore,
 * never audio/transport.
 */
import { useSyncExternalStore } from 'react';
import {
  isPerfSectionShown,
  subscribePerfSections,
  togglePerfSection,
  type PerfSection,
} from '../../performance/perfSectionsStore';

const SECTIONS: { id: PerfSection; label: string; name: string }[] = [
  { id: 'waveforms', label: 'WAVE', name: 'Waveforms' },
  { id: 'decks', label: 'DECK', name: 'Decks' },
];

export function PerfSectionToggles() {
  return (
    <span className="perf-section-toggles">
      {SECTIONS.map((s) => (
        <PerfSectionToggle key={s.id} {...s} />
      ))}
    </span>
  );
}

function PerfSectionToggle({ id, label, name }: { id: PerfSection; label: string; name: string }) {
  const shown = useSyncExternalStore(subscribePerfSections, () => isPerfSectionShown(id));
  return (
    <button
      className={`player-button perf-strip-toggle perf-section-toggle${shown ? ' on' : ''}`}
      title={shown ? `${name} shown — click to hide (display only)` : `${name} hidden — click to show`}
      aria-pressed={shown}
      onClick={() => togglePerfSection(id)}
    >
      {label}
    </button>
  );
}
