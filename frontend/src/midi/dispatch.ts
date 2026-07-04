import { audibleTransport } from '../playback/audibleSurface';
import type { MidiAction } from './actions';

/**
 * Thin glue: route translator actions to the AUDIBLE SURFACE's transport
 * (ADR 0013) — never to decks directly, never synthetic key events. The
 * arbiter answers "who is audible"; dispatch stays view-blind forever.
 * Hardware mirrors the keyboard of the audible surface: the shared surface
 * carries the library/performance guards (loading decks latch play, cue
 * needs decoded audio), the Transition editor maps both PLAYs to its one
 * mix transport and registers no cue handlers — CUE drops there, like F.
 *
 * This slice handles transport toggle + cue down/up; every other target in
 * the vocabulary is a silent no-op until its slice lands.
 */
export function dispatchMidiAction(action: MidiAction): void {
  // Absolute/relative handlers land in later slices.
  if (action.kind !== 'button') return;

  const transport = audibleTransport();
  if (!transport) return; // boot-order edge: holder not registered yet

  const target = action.target;
  switch (target.control) {
    case 'transport': {
      if (action.edge !== 'down') return;
      transport.togglePlay(target.deck);
      return;
    }
    case 'cue': {
      if (action.edge === 'down') transport.cueDown?.(target.deck);
      else transport.cueUp?.(target.deck);
      return;
    }
    // Hot cues, beatjump, match, load: later slices.
    default:
      return;
  }
}
