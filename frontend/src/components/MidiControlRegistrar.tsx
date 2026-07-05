import { useEffect, useRef } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useDeck, useDeckReady } from '../hooks/useDeck';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { registerDeckControls } from '../midi/controlRegistry';
import { doubleBeatjump, halveBeatjump } from '../playback/beatjump';

/**
 * Headless glue (midi-controller 02): registers each shared Deck's
 * React-owned pad capabilities into the module-level control registry so
 * MIDI dispatch (which lives outside React) can drive them. Reuses the exact
 * hooks the on-screen pads use — hot cues via useHotCueActions (set-empty /
 * jump / hold-preview, React Query curation included), beatjump via the same
 * engine call + shared per-deck size as BeatjumpRow.
 *
 * Registration runs once per deck; handlers read the latest hook values
 * through a ref so a Load or size change never re-registers. Like
 * MidiControllerBridge, this is hands-on-hardware verified glue — the tested
 * seam is dispatch + registry (dispatch.test.ts).
 */

function DeckControlsRegistrar() {
  const { deck, engine, loadedTrack, beatjumpBeats, setBeatjumpBeats } = useDeck();
  const ready = useDeckReady();
  const hotCues = useHotCueActions(loadedTrack?.id ?? null);

  const latest = useRef({ engine, ready, hotCues, beatjumpBeats, setBeatjumpBeats });
  useEffect(() => {
    latest.current = { engine, ready, hotCues, beatjumpBeats, setBeatjumpBeats };
  });

  useEffect(
    () =>
      registerDeckControls(deck, {
        hotCueDown: (pad) => latest.current.hotCues.down(pad),
        hotCueUp: (pad) => latest.current.hotCues.up(pad),
        beatjump: (direction) => {
          const { engine: e, ready: r, beatjumpBeats: beats } = latest.current;
          if (!r) return; // same gate as BeatjumpRow's disabled jumps
          e.jumpBeats(direction === 'back' ? -beats : beats);
        },
        beatjumpSize: (change) => {
          const { beatjumpBeats: beats, setBeatjumpBeats: set } = latest.current;
          set(change === 'halve' ? halveBeatjump(beats) : doubleBeatjump(beats));
        },
      }),
    [deck]
  );

  return null;
}

/** Mounted once inside DeckProvider, alongside MidiControllerBridge. */
export function MidiControlRegistrar() {
  return (
    <>
      <DeckScope deck="A">
        <DeckControlsRegistrar />
      </DeckScope>
      <DeckScope deck="B">
        <DeckControlsRegistrar />
      </DeckScope>
    </>
  );
}
