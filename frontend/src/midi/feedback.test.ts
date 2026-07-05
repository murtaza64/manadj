/**
 * Feedback seam (midi-pad-leds 01): pure state-in/messages-out — synthetic
 * deck state and the real Inpulse Mapping's feedback section, no Web MIDI,
 * no engine (ADR 0002). Byte expectations follow Mixxx's Inpulse 300
 * mapping (the LED ground truth cited in mappings/inpulse300mk2.ts).
 */
import { describe, expect, it } from 'vitest';
import { allOffMessages, encodeDeckLeds, ledStates } from './feedback';
import { INPULSE_300_MK2 } from './mappings/inpulse300mk2';

const feedback = INPULSE_300_MK2.feedback!;

const idle = { playing: false, assignedPads: new Set<number>() };

describe('ledStates', () => {
  it('PLAY is solid while playing', () => {
    expect(ledStates({ ...idle, playing: true }).play).toBe(true);
  });

  it('PLAY is off while paused', () => {
    expect(ledStates({ ...idle, playing: false }).play).toBe(false);
  });

  it('lights exactly the assigned pad slots', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([1, 3, 8]) });
    expect(states.pads).toEqual([true, false, true, false, false, false, false, true]);
  });

  it('all eight pads are dark with nothing assigned (empty deck)', () => {
    expect(ledStates(idle).pads).toEqual(new Array(8).fill(false));
  });

  it('ignores slot numbers outside the pad grid', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([0, 9, 42]) });
    expect(states.pads).toEqual(new Array(8).fill(false));
  });
});

const dark = ledStates(idle);

describe('encodeDeckLeds', () => {
  it('encodes deck A PLAY on as a note-on at the mapped address', () => {
    const messages = encodeDeckLeds(feedback, 'A', { ...dark, play: true });
    expect(messages).toContainEqual([0x91, 0x07, 0x7f]);
  });

  it('encodes deck B PLAY off as velocity zero on its own channel', () => {
    const messages = encodeDeckLeds(feedback, 'B', { ...dark, play: false });
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
  });

  it('encodes pads on the HOTCUE base-layer addresses (Mixxx ground truth)', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([1, 8]) });
    const messagesA = encodeDeckLeds(feedback, 'A', states);
    expect(messagesA).toContainEqual([0x96, 0x00, 0x7e]); // pad 1 lit
    expect(messagesA).toContainEqual([0x96, 0x07, 0x7e]); // pad 8 lit
    expect(messagesA).toContainEqual([0x96, 0x03, 0x00]); // pad 4 dark
    const messagesB = encodeDeckLeds(feedback, 'B', states);
    expect(messagesB).toContainEqual([0x97, 0x00, 0x7e]); // deck B channel
  });

  it('covers every light of the deck exactly once', () => {
    const messages = encodeDeckLeds(feedback, 'A', dark);
    const addresses = messages.map(([status, number]) => `${status}:${number}`);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses.length).toBeGreaterThanOrEqual(9); // PLAY + 8 pads
  });
});

describe('allOffMessages', () => {
  it('darkens every mapped light on both decks', () => {
    const messages = allOffMessages(feedback);
    // Every message is a velocity-zero note-on.
    for (const [status, , velocity] of messages) {
      expect(status >> 4).toBe(0x9);
      expect(velocity).toBe(0x00);
    }
    // Both decks' PLAY LEDs and pad grids are covered.
    expect(messages).toContainEqual([0x91, 0x07, 0x00]);
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
    expect(messages).toContainEqual([0x96, 0x05, 0x00]);
    expect(messages).toContainEqual([0x97, 0x02, 0x00]);
  });
});
