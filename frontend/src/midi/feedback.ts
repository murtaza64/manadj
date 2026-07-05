import type { DeckFeedback, LedAddress, MappingFeedback } from './mapping';

/**
 * The Feedback seam (midi-pad-leds PRD, ADR 0002): deck state in →
 * per-light on/off out (`ledStates`), and light states + a Mapping's
 * feedback section in → MIDI messages out (`encodeDeckLeds`). Pure — no
 * Web MIDI, no engine; the adapter and the feedback bridge are the
 * hands-on-verified glue around it.
 *
 * No diffing anywhere: callers recompute and resend a deck's full light
 * set on every relevant state change (a handful of lights is nothing),
 * which is also exactly what a connect/replug resync needs.
 */

/** The slice of deck state Feedback reads. */
export interface DeckLedInput {
  playing: boolean;
}

/** Desired on/off per light of one deck. */
export interface DeckLedStates {
  play: boolean;
}

/** [status, data1, data2] — ready for MIDIOutput.send. */
export type MidiMessage = readonly [number, number, number];

/** Deck state → desired light states. */
export function ledStates(input: DeckLedInput): DeckLedStates {
  return { play: input.playing };
}

const NOTE_ON = 0x9;

function encodeLed(address: LedAddress, lit: boolean): MidiMessage {
  return [(NOTE_ON << 4) | address.channel, address.number, lit ? address.onVelocity : 0x00];
}

function deckAddresses(deck: DeckFeedback): readonly LedAddress[] {
  return [deck.play];
}

/** Desired light states for one deck → the full message set to send. */
export function encodeDeckLeds(
  feedback: MappingFeedback,
  deck: 'A' | 'B',
  states: DeckLedStates
): readonly MidiMessage[] {
  const addresses = feedback.decks[deck];
  return [encodeLed(addresses.play, states.play)];
}

/**
 * Every mapped light dark — sent on detach and dispose so stale state
 * never lingers on the hardware.
 */
export function allOffMessages(feedback: MappingFeedback): readonly MidiMessage[] {
  return (['A', 'B'] as const).flatMap((deck) =>
    deckAddresses(feedback.decks[deck]).map((address) => encodeLed(address, false))
  );
}
