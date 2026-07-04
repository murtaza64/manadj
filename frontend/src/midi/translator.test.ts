import { describe, expect, it } from 'vitest';
import type { MidiAction } from './actions';
import type { Mapping } from './mapping';
import { initialDecoderState, translateMidiMessage } from './translator';

/**
 * The translator seam (PRD testing decisions): synthetic messages in,
 * asserted action streams out. Never internal decoder state. A synthetic
 * mapping keeps these tests independent of the Inpulse file's
 * hardware-verify placeholders.
 */

const mapping: Mapping = {
  portNameMatch: 'Test Controller',
  bindings: [
    {
      match: { message: 'note', channel: 0, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 0, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'B' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'B' },
    },
    {
      // Modifier layers are a later slice: gated bindings must stay inert.
      match: { message: 'note', channel: 0, number: 0x10 },
      modifier: 'shift',
      controlType: 'button',
      target: { control: 'load', deck: 'A' },
    },
  ],
};

/** Fold a message array through the translator, as the adapter does per port. */
function translate(messages: number[][]): MidiAction[] {
  let state = initialDecoderState();
  const actions: MidiAction[] = [];
  for (const message of messages) {
    const result = translateMidiMessage(message, state, mapping);
    state = result.state;
    actions.push(...result.actions);
  }
  return actions;
}

describe('button edge derivation', () => {
  it('emits a down edge on note-on', () => {
    expect(translate([[0x90, 0x07, 0x7f]])).toEqual([
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'down' },
    ]);
  });

  it('emits an up edge on note-off after a down', () => {
    expect(translate([[0x90, 0x06, 0x7f], [0x80, 0x06, 0x00]])).toEqual([
      { kind: 'button', target: { control: 'cue', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'cue', deck: 'A' }, edge: 'up' },
    ]);
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(translate([[0x90, 0x07, 0x7f], [0x90, 0x07, 0x00]])).toEqual([
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'up' },
    ]);
  });

  it('dedupes repeated note-ons while held to a single down edge', () => {
    expect(
      translate([[0x90, 0x07, 0x7f], [0x90, 0x07, 0x40], [0x80, 0x07, 0x00]])
    ).toEqual([
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'up' },
    ]);
  });

  it('swallows a stray note-off with no preceding down', () => {
    expect(translate([[0x80, 0x07, 0x00]])).toEqual([]);
  });
});

describe('binding resolution', () => {
  it('resolves the same note number to the right deck by channel', () => {
    expect(translate([[0x91, 0x07, 0x7f], [0x91, 0x06, 0x7f]])).toEqual([
      { kind: 'button', target: { control: 'transport', deck: 'B' }, edge: 'down' },
      { kind: 'button', target: { control: 'cue', deck: 'B' }, edge: 'down' },
    ]);
  });

  it('holds on one deck while the other toggles independently', () => {
    expect(
      translate([[0x90, 0x06, 0x7f], [0x91, 0x07, 0x7f], [0x80, 0x06, 0x00]])
    ).toEqual([
      { kind: 'button', target: { control: 'cue', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'transport', deck: 'B' }, edge: 'down' },
      { kind: 'button', target: { control: 'cue', deck: 'A' }, edge: 'up' },
    ]);
  });
});

describe('unmapped-message silence', () => {
  it('ignores an unmapped note number', () => {
    expect(translate([[0x90, 0x42, 0x7f], [0x80, 0x42, 0x00]])).toEqual([]);
  });

  it('ignores a mapped note number on an unmapped channel', () => {
    expect(translate([[0x95, 0x07, 0x7f]])).toEqual([]);
  });

  it('ignores CC and other non-note statuses', () => {
    expect(
      translate([
        [0xb0, 0x07, 0x7f], // CC on a note-mapped number: different message type
        [0xe0, 0x00, 0x40], // pitch bend
        [0xa0, 0x07, 0x7f], // poly aftertouch
      ])
    ).toEqual([]);
  });

  it('ignores truncated messages', () => {
    expect(translate([[0xf8], [0x90, 0x07]])).toEqual([]);
  });

  it('keeps modifier-gated bindings inert until modifiers land', () => {
    expect(translate([[0x90, 0x10, 0x7f], [0x80, 0x10, 0x00]])).toEqual([]);
  });
});

describe('purity across ports (hot-plug irrelevance)', () => {
  it('does not mutate the input state and is repeatable', () => {
    const state = initialDecoderState();
    const first = translateMidiMessage([0x90, 0x07, 0x7f], state, mapping);
    const second = translateMidiMessage([0x90, 0x07, 0x7f], state, mapping);
    expect(second.actions).toEqual(first.actions);
    expect(state.heldButtons.size).toBe(0);
  });

  it('decodes identically on independently-folded states, as two ports would', () => {
    const press = [[0x90, 0x06, 0x7f], [0x80, 0x06, 0x00]];
    expect(translate(press)).toEqual(translate(press));
  });
});
