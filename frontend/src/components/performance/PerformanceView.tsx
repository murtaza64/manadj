/**
 * The Performance view (performance-mode issue 03): two-deck surface over an
 * embedded Library. Layout per the prototype verdict (PRD Further Notes) —
 * top 50vh: stacked full-width waveforms, then Deck A | Mixer | Deck B;
 * bottom 50vh: the real Library browse surface (browseOnly) with per-row
 * load-to-A/B buttons. Mouse-only in this slice; the keyboard hub is issue 04.
 */
import { useCallback } from 'react';
import Library from '../Library';
import { DeckScope } from '../../contexts/DeckContext';
import { useDecks } from '../../hooks/useDeck';
import type { ChannelId } from '../../playback/mixer';
import type { Track } from '../../types';
import { DeckPanel, DeckWaveform } from './DeckPanel';
import { MixerPanel } from './MixerPanel';
import './PerformanceView.css';

export function PerformanceView({ onClose }: { onClose: () => void }) {
  // The per-deck loadTrack functions are identity-stable (provider), so this
  // callback is too — memoized track rows don't re-render on deck churn.
  const { A, B } = useDecks();
  const loadA = A.loadTrack;
  const loadB = B.loadTrack;
  const loadToDeck = useCallback(
    (deck: ChannelId, track: Track) => (deck === 'A' ? loadA : loadB)(track),
    [loadA, loadB]
  );

  return (
    <div className="perf-root">
      <button className="player-button perf-back" onClick={onClose}>
        ← Library
      </button>

      {/* Performance surface — top half of the viewport */}
      <div className="perf-surface">
        <div className="perf-waves">
          <DeckScope deck="A">
            <DeckWaveform />
          </DeckScope>
          <DeckScope deck="B">
            <DeckWaveform />
          </DeckScope>
        </div>
        <div className="perf-middle">
          <DeckScope deck="A">
            <DeckPanel />
          </DeckScope>
          <MixerPanel />
          <DeckScope deck="B">
            <DeckPanel mirrored />
          </DeckScope>
        </div>
      </div>

      {/* Browse surface — the real Library, bottom half. Enter/double-click
          load to A (the embedded library is scope A); hover buttons per row
          load to either deck. */}
      <div className="perf-library">
        <DeckScope deck="A">
          <Library browseOnly onLoadToDeck={loadToDeck} />
        </DeckScope>
      </div>
    </div>
  );
}
