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
    {
      // Inverted 7-bit absolute (hardware direction opposite the app's).
      match: { message: 'cc', channel: 1, number: 0x14 },
      controlType: 'absolute',
      target: { control: 'master' },
      bits: 7,
      invert: true,
    },
    {
      // Inverted 14-bit absolute (the DJ pitch-fader convention).
      match: { message: 'cc', channel: 2, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'pitch', deck: 'A' },
      bits: 14,
      lsbNumber: 0x20,
      invert: true,
    },
    {
      // Relative encoder.
      match: { message: 'cc', channel: 0, number: 0x18 },
      controlType: 'relative',
      target: { control: 'jog', deck: 'A' },
    },
    {
      // Deck-less toggle (midi-performance-ops 07): both hardware Q
      // buttons bind to the one app-wide quantize target.
      match: { message: 'note', channel: 0, number: 0x02 },
      controlType: 'button',
      target: { control: 'quantize' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x02 },
      controlType: 'button',
      target: { control: 'quantize' },
    },
    {
      // SHIFT layer (channel+3 on the Inpulse): per-deck key lock.
      match: { message: 'note', channel: 3, number: 0x02 },
      controlType: 'button',
      target: { control: 'key-lock', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 4, number: 0x02 },
      controlType: 'button',
      target: { control: 'key-lock', deck: 'B' },
    },
    {
      // Assistant button (midi-performance-ops 08): the Follow macro.
      match: { message: 'note', channel: 0, number: 0x0e },
      controlType: 'button',
      target: { control: 'follow-macro' },
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

describe('quantize and key-lock bindings (midi-performance-ops 07)', () => {
  it('either Q button emits the same deck-less quantize action', () => {
    expect(translate([[0x90, 0x02, 0x7f], [0x91, 0x02, 0x7f]])).toEqual([
      { kind: 'button', target: { control: 'quantize' }, edge: 'down' },
      { kind: 'button', target: { control: 'quantize' }, edge: 'down' },
    ]);
  });

  it('shifted-layer Q resolves to the right deck by channel', () => {
    expect(translate([[0x93, 0x02, 0x7f], [0x94, 0x02, 0x7f]])).toEqual([
      { kind: 'button', target: { control: 'key-lock', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'key-lock', deck: 'B' }, edge: 'down' },
    ]);
  });

  it('a full press/release yields down then up edges', () => {
    expect(translate([[0x93, 0x02, 0x7f], [0x83, 0x02, 0x00]])).toEqual([
      { kind: 'button', target: { control: 'key-lock', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'key-lock', deck: 'A' }, edge: 'up' },
    ]);
  });
});

describe('assistant follow-macro binding (midi-performance-ops 08)', () => {
  it('emits the deck-less follow-macro action on press', () => {
    expect(translate([[0x90, 0x0e, 0x7f], [0x80, 0x0e, 0x00]])).toEqual([
      { kind: 'button', target: { control: 'follow-macro' }, edge: 'down' },
      { kind: 'button', target: { control: 'follow-macro' }, edge: 'up' },
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

  it('inverted 7-bit: endpoints swap (hardware runs opposite the app)', () => {
    expect(translate([[0xb1, 0x14, 0x00], [0xb1, 0x14, 0x7f]])).toEqual([
      { kind: 'absolute', target: { control: 'master' }, value: 1 },
      { kind: 'absolute', target: { control: 'master' }, value: 0 },
    ]);
  });

  it('inverted 14-bit: endpoints swap and the center stays centered', () => {
    expect(
      translate([
        [0xb2, 0x00, 0x00],
        [0xb2, 0x20, 0x00],
        [0xb2, 0x00, 0x7f],
        [0xb2, 0x20, 0x7f],
      ])
    ).toEqual([
      { kind: 'absolute', target: { control: 'pitch', deck: 'A' }, value: 1 },
      { kind: 'absolute', target: { control: 'pitch', deck: 'A' }, value: 0 },
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

describe('relative decoding (midi-controller 03)', () => {
  it("decodes two's-complement ticks in both directions", () => {
    expect(translate([[0xb0, 0x18, 0x01], [0xb0, 0x18, 0x7f]])).toEqual([
      { kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: 1 },
      { kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: -1 },
    ]);
  });

  it('carries multi-tick values', () => {
    expect(translate([[0xb0, 0x18, 0x03], [0xb0, 0x18, 0x7d]])).toEqual([
      { kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: 3 },
      { kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: -3 },
    ]);
  });

  it('a zero value is silence, not a zero-tick action', () => {
    expect(translate([[0xb0, 0x18, 0x00]])).toEqual([]);
  });

  it('note messages on relative-bound numbers stay silent', () => {
    expect(translate([[0x90, 0x18, 0x7f]])).toEqual([]);
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
