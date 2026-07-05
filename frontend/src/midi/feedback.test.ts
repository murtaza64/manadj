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

describe('ledStates', () => {
  it('PLAY is solid while playing', () => {
    expect(ledStates({ playing: true }).play).toBe(true);
  });

  it('PLAY is off while paused', () => {
    expect(ledStates({ playing: false }).play).toBe(false);
  });
});

describe('encodeDeckLeds', () => {
  it('encodes deck A PLAY on as a note-on at the mapped address', () => {
    const messages = encodeDeckLeds(feedback, 'A', { play: true });
    expect(messages).toContainEqual([0x91, 0x07, 0x7f]);
  });

  it('encodes deck B PLAY off as velocity zero on its own channel', () => {
    const messages = encodeDeckLeds(feedback, 'B', { play: false });
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
  });

  it('covers every light of the deck exactly once', () => {
    const messages = encodeDeckLeds(feedback, 'A', { play: false });
    const addresses = messages.map(([status, number]) => `${status}:${number}`);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(messages.length).toBeGreaterThan(0);
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
    // Both decks' PLAY LEDs are covered.
    expect(messages).toContainEqual([0x91, 0x07, 0x00]);
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
  });
});
