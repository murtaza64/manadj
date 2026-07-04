import type { ReactNode } from 'react';
import { useDeck, useDeckSnapshot } from '../../hooks/useDeck';
import { useHotCueActions } from '../../hooks/useHotCueActions';
import HotCue from '../HotCue';

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The only hot-cue pad surface (deck-controls PRD, playback class): the
 * eight HotCue pads driven by useHotCueActions for the scoped deck's
 * loaded Track. Returns a fragment: callers own the grid container.
 *
 * `padKbd` adds on-pad keyboard hints (Performance view); when present,
 * every pad gets a positioning wrapper so hints anchor to their pad.
 */
export function HotCuePads({ padKbd }: { padKbd?: (slot: number) => ReactNode }) {
  const { loadedTrack } = useDeck();
  const actions = useHotCueActions(loadedTrack?.id ?? null);
  const previewingSlot = useDeckSnapshot((s) => s.hotCuePreviewSlot);

  return (
    <>
      {SLOTS.map((slot) => {
        const pad = (
          <HotCue
            key={slot}
            slotNumber={slot}
            hotCue={actions.bySlot.get(slot)}
            disabled={!actions.enabled}
            isPreviewing={previewingSlot === slot}
            onDown={actions.down}
            onUp={actions.up}
            onDelete={actions.remove}
          />
        );
        return padKbd ? (
          <span key={slot} className="perf-pad-wrap">
            {pad}
            {padKbd(slot)}
          </span>
        ) : (
          pad
        );
      })}
    </>
  );
}
