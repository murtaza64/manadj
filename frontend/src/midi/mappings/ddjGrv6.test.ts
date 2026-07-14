import { describe, expect, it } from 'vitest';
import { initialDecoderState, translateMidiMessage } from '../translator';
import type { DecoderState } from '../translator';
import type { MidiAction } from '../actions';
import { DDJ_GRV6 } from './ddjGrv6';
import { encodeDeckLeds } from '../feedback';

function translate(messages: number[][]): MidiAction[] {
  let state: DecoderState = initialDecoderState();
  return messages.flatMap((message) => {
    const result = translateMidiMessage(message, state, DDJ_GRV6);
    state = result.state;
    return [...result.actions];
  });
}

const press = (channel: number, note: number) => [0x90 | channel, note, 0x7f];
const cc = (channel: number, number: number, value: number) => [
  0xb0 | channel,
  number,
  value,
];

describe('DDJ-GRV6 Mapping — official E1 message table', () => {
  it('matches the device port name', () => {
    expect('AlphaTheta DDJ-GRV6'.includes(DDJ_GRV6.portNameMatch)).toBe(true);
  });

  it('maps transport and logical Deck selection across A–D', () => {
    expect(translate([press(0, 11), press(1, 12), press(2, 60), press(3, 88)])).toEqual([
      { kind: 'button', target: { control: 'transport', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'cue', deck: 'B' }, edge: 'down' },
      { kind: 'button', target: { control: 'set-control-focus', deck: 'C' }, edge: 'down' },
      { kind: 'button', target: { control: 'match', deck: 'D' }, edge: 'down' },
    ]);
  });

  it('ignores the deselected layer velocity-zero state', () => {
    expect(translate([[0x92, 60, 0]])).toEqual([]);
  });

  it('maps fixed Load 1–4 buttons and the browser encoder', () => {
    expect(
      translate([press(6, 70), press(6, 71), press(6, 72), press(6, 73), cc(6, 64, 127)])
    ).toEqual([
      { kind: 'button', target: { control: 'load', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'load', deck: 'B' }, edge: 'down' },
      { kind: 'button', target: { control: 'load', deck: 'C' }, edge: 'down' },
      { kind: 'button', target: { control: 'load', deck: 'D' }, edge: 'down' },
      { kind: 'relative', target: { control: 'selection-move' }, ticks: -1 },
    ]);
  });

  it('decodes 14-bit pitch and fixed four-channel Mixer controls', () => {
    const actions = translate([
      cc(2, 0, 64),
      cc(2, 32, 0),
      cc(3, 19, 127),
      cc(3, 51, 127),
      cc(0, 4, 32),
      cc(0, 36, 0),
      cc(6, 26, 96),
      cc(6, 58, 0),
    ]);
    expect(actions).toEqual([
      { kind: 'absolute', target: { control: 'pitch', deck: 'C' }, value: 8192 / 16383 },
      { kind: 'absolute', target: { control: 'channel-fader', channel: 'D' }, value: 1 },
      { kind: 'absolute', target: { control: 'trim', channel: 'A' }, value: 4096 / 16383 },
      { kind: 'absolute', target: { control: 'filter', channel: 'D' }, value: 12288 / 16383 },
    ]);
  });

  it('maps the documented tempo minus/plus endpoints without inversion', () => {
    expect(translate([cc(0, 0, 0), cc(0, 32, 0), cc(0, 0, 127), cc(0, 32, 127)])).toEqual([
      { kind: 'absolute', target: { control: 'pitch', deck: 'A' }, value: 0 },
      { kind: 'absolute', target: { control: 'pitch', deck: 'A' }, value: 1 },
    ]);
  });

  it('decodes offset-64 jog ticks in both directions', () => {
    expect(
      translate([
        cc(2, 33, 65),
        cc(2, 33, 63),
        cc(3, 34, 65),
        cc(3, 35, 63),
        cc(3, 38, 66),
        cc(3, 41, 62),
      ])
    ).toEqual([
      { kind: 'relative', target: { control: 'jog', deck: 'C' }, ticks: 1 },
      { kind: 'relative', target: { control: 'jog', deck: 'C' }, ticks: -1 },
      { kind: 'relative', target: { control: 'jog-touch', deck: 'D' }, ticks: 1 },
      { kind: 'relative', target: { control: 'jog', deck: 'D' }, ticks: -1 },
      { kind: 'relative', target: { control: 'jog-seek', deck: 'D' }, ticks: 2 },
      { kind: 'relative', target: { control: 'jog-seek', deck: 'D' }, ticks: -2 },
    ]);
  });

  it('maps all eight Hot Cue pads on each dedicated pad channel', () => {
    expect(translate([press(7, 0), press(9, 7), press(11, 3), press(13, 5)])).toEqual([
      { kind: 'button', target: { control: 'hot-cue', deck: 'A', pad: 1 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue', deck: 'B', pad: 8 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue', deck: 'C', pad: 4 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue', deck: 'D', pad: 6 }, edge: 'down' },
    ]);
  });

  it('leaves Groove Circuit, effects, stems, and shifted pad actions unmapped', () => {
    expect(translate([press(0, 0), press(4, 16), press(8, 0), press(14, 16)])).toEqual([]);
  });

  it('declares A–D transport, PFL, and Hot Cue Feedback addresses', () => {
    expect(DDJ_GRV6.feedback?.decks.C).toMatchObject({
      play: { channel: 2, number: 11, onVelocity: 127 },
      cue: { channel: 2, number: 12, onVelocity: 127 },
      pfl: { channel: 2, number: 84, onVelocity: 127 },
    });
    expect(DDJ_GRV6.feedback?.decks.D?.hotCuePads).toHaveLength(8);
    expect(DDJ_GRV6.feedback?.decks.D?.hotCuePadsShifted).toHaveLength(8);
  });

  it('encodes C/D logical deck Feedback on their official output channels', () => {
    const states = {
      play: true,
      cue: false,
      pfl: true,
      pads: [true, false, false, false, false, false, false, false],
      gridPads: [],
      quantize: true,
      keyLock: true,
      loopBeats: null,
    };
    const messages = encodeDeckLeds(DDJ_GRV6.feedback!, 'C', states);
    expect(messages).toContainEqual([0x92, 11, 0x7f]);
    expect(messages).toContainEqual([0x92, 84, 0x7f]);
    expect(messages).toContainEqual([0x92, 26, 0x7f]);
    expect(messages).toContainEqual([0x9b, 0, 0x7f]);
  });
});
