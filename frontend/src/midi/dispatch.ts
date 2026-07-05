import { audibleTransport } from '../playback/audibleSurface';
import type { MidiAction } from './actions';
import { deckControlsFor } from './controlRegistry';

/**
 * Thin glue, view-blind forever. Two routing classes (ADR 0013):
 *
 * - Transport-class gestures (transport, cue) go through the AUDIBLE
 *   SURFACE's transport — never to decks directly, never synthetic key
 *   events. The shared surface carries the library/performance guards; the
 *   Transition editor maps both PLAYs to its one mix transport and registers
 *   no cue handlers, so CUE drops there like keyboard F.
 *
 * - Everything else aims at the shared decks' registered controls
 *   (controlRegistry). While the editor is audible the shared decks are
 *   silenced and the engine's mayStart tripwire keeps stabs inert.
 *
 * Targets without a registered handler are silent no-ops, like unmapped
 * messages.
 */
export function dispatchMidiAction(action: MidiAction): void {
  // Absolute/relative handlers land in later slices.
  if (action.kind !== 'button') return;

  const target = action.target;
  switch (target.control) {
    case 'transport': {
      if (action.edge !== 'down') return;
      audibleTransport()?.togglePlay(target.deck);
      return;
    }
    case 'cue': {
      const transport = audibleTransport();
      if (!transport) return; // boot-order edge: holder not registered yet
      if (action.edge === 'down') transport.cueDown?.(target.deck);
      else transport.cueUp?.(target.deck);
      return;
    }
    case 'hot-cue': {
      const controls = deckControlsFor(target.deck);
      if (action.edge === 'down') controls?.hotCueDown(target.pad);
      else controls?.hotCueUp(target.pad);
      return;
    }
    case 'beatjump': {
      if (action.edge !== 'down') return;
      deckControlsFor(target.deck)?.beatjump(target.direction);
      return;
    }
    case 'beatjump-size': {
      if (action.edge !== 'down') return;
      deckControlsFor(target.deck)?.beatjumpSize(target.change);
      return;
    }
    // Match, load: later slices.
    default:
      return;
  }
}
