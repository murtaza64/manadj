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
      // 7-bit absolute.
      match: { message: 'cc', channel: 0, number: 0x14 },
      controlType: 'absolute',
      target: { control: 'master' },
      bits: 7,
    },
    {
      // 14-bit absolute: MSB #0, LSB #32.
      match: { message: 'cc', channel: 0, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'crossfader' },
      bits: 14,
      lsbNumber: 0x20,
    },
    {
      // 14-bit absolute on another channel: same numbers, different target.
      match: { message: 'cc', channel: 1, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'channel-fader', channel: 'A' },
      bits: 14,
      lsbNumber: 0x20,
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
});

describe('absolute decoding (midi-controller 04)', () => {
  it('7-bit CC emits a normalized 0..1 value', () => {
    expect(translate([[0xb0, 0x14, 0x00], [0xb0, 0x14, 0x7f]])).toEqual([
      { kind: 'absolute', target: { control: 'master' }, value: 0 },
      { kind: 'absolute', target: { control: 'master' }, value: 1 },
    ]);
  });

  it('14-bit: MSB alone is silent, the LSB completes the pair', () => {
    expect(translate([[0xb0, 0x00, 0x40], [0xb0, 0x20, 0x00]])).toEqual([
      { kind: 'absolute', target: { control: 'crossfader' }, value: (0x40 << 7) / 16383 },
    ]);
  });

  it('14-bit endpoints reach exactly 0 and 1', () => {
    expect(
      translate([
        [0xb0, 0x00, 0x00],
        [0xb0, 0x20, 0x00],
        [0xb0, 0x00, 0x7f],
        [0xb0, 0x20, 0x7f],
      ])
    ).toEqual([
      { kind: 'absolute', target: { control: 'crossfader' }, value: 0 },
      { kind: 'absolute', target: { control: 'crossfader' }, value: 1 },
    ]);
  });

  it('14-bit: an LSB with no stored MSB is silent', () => {
    expect(translate([[0xb0, 0x20, 0x7f]])).toEqual([]);
  });

  it('14-bit: the stored MSB persists across LSB-only refinements', () => {
    expect(
      translate([
        [0xb0, 0x00, 0x40],
        [0xb0, 0x20, 0x00],
        [0xb0, 0x20, 0x01],
      ])
    ).toEqual([
      { kind: 'absolute', target: { control: 'crossfader' }, value: (0x40 << 7) / 16383 },
      { kind: 'absolute', target: { control: 'crossfader' }, value: ((0x40 << 7) | 1) / 16383 },
    ]);
  });

  it('14-bit MSBs are tracked per channel', () => {
    expect(
      translate([
        [0xb0, 0x00, 0x10], // crossfader MSB (ch 0)
        [0xb1, 0x00, 0x40], // channel-fader A MSB (ch 1)
        [0xb1, 0x20, 0x00],
        [0xb0, 0x20, 0x00],
      ])
    ).toEqual([
      {
        kind: 'absolute',
        target: { control: 'channel-fader', channel: 'A' },
        value: (0x40 << 7) / 16383,
      },
      { kind: 'absolute', target: { control: 'crossfader' }, value: (0x10 << 7) / 16383 },
    ]);
  });

  it('note messages on absolute-bound numbers stay silent', () => {
    expect(translate([[0x90, 0x14, 0x7f]])).toEqual([]);
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
