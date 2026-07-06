/**
 * Inpulse 300 MK2 mapping data (midi-performance-ops 02): the real
 * Mapping's LOOP pad bindings, exercised through the pure translator —
 * synthetic device bytes in, actions out (same style as translator.test.ts,
 * which keeps its own synthetic mapping for schema behaviors; this file
 * pins the device data itself).
 */
import { describe, expect, it } from 'vitest';
import type { MidiAction } from '../actions';
import { initialDecoderState, translateMidiMessage } from '../translator';
import { INPULSE_300_MK2 } from './inpulse300mk2';

function translate(messages: number[][]): MidiAction[] {
  let state = initialDecoderState();
  const actions: MidiAction[] = [];
  for (const message of messages) {
    const result = translateMidiMessage(message, state, INPULSE_300_MK2);
    state = result.state;
    actions.push(...result.actions);
  }
  return actions;
}

/** Pad press down+up: note-on then note-off on the pad channel. */
function padPress(channel: number, note: number): number[][] {
  return [
    [0x90 | channel, note, 0x7f],
    [0x80 | channel, note, 0x00],
  ];
}

describe('LOOP pad mode bindings', () => {
  it('base page walks the 1-128 ladder (deck A, notes 0x10-0x17 on ch 6)', () => {
    const ladder = [1, 2, 4, 8, 16, 32, 64, 128];
    ladder.forEach((beats, i) => {
      expect(translate(padPress(6, 0x10 + i))).toEqual([
        { kind: 'button', target: { control: 'loop-preset', deck: 'A', beats }, edge: 'down' },
        { kind: 'button', target: { control: 'loop-preset', deck: 'A', beats }, edge: 'up' },
      ]);
    });
  });

  it('shifted page ascends across the top row, 3/4 alone on the bottom row', () => {
    // Pads 1-3 (notes 0x18-0x1a): 1/8, 1/4, 1/2; pad 5 (note 0x1c): 3/4.
    const bound: [number, number][] = [
      [0x18, 0.125],
      [0x19, 0.25],
      [0x1a, 0.5],
      [0x1c, 0.75],
    ];
    for (const [note, beats] of bound) {
      expect(translate(padPress(6, note))).toEqual([
        { kind: 'button', target: { control: 'loop-preset', deck: 'A', beats }, edge: 'down' },
        { kind: 'button', target: { control: 'loop-preset', deck: 'A', beats }, edge: 'up' },
      ]);
    }
  });

  it('deck B mirrors both pages on ch 7', () => {
    expect(translate(padPress(7, 0x17))).toEqual([
      { kind: 'button', target: { control: 'loop-preset', deck: 'B', beats: 128 }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-preset', deck: 'B', beats: 128 }, edge: 'up' },
    ]);
    expect(translate(padPress(7, 0x1c))).toEqual([
      { kind: 'button', target: { control: 'loop-preset', deck: 'B', beats: 0.75 }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-preset', deck: 'B', beats: 0.75 }, edge: 'up' },
    ]);
  });

  it('unbound shifted pads (4, 6-8) stay silent (notes 0x1b, 0x1d-0x1f)', () => {
    for (const note of [0x1b, 0x1d, 0x1e, 0x1f]) {
      expect(translate(padPress(6, note))).toEqual([]);
      expect(translate(padPress(7, note))).toEqual([]);
    }
  });
});
