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

  it('maps the deck loop section across A-D', () => {
    expect(
      translate([
        press(0, 16),
        press(1, 17),
        press(2, 76),
        press(3, 119),
        press(0, 20),
        press(1, 77),
        press(2, 81),
        press(3, 83),
      ])
    ).toEqual([
      { kind: 'button', target: { control: 'beatjump', deck: 'A', direction: 'back' }, edge: 'down' },
      { kind: 'button', target: { control: 'beatjump', deck: 'B', direction: 'forward' }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-or-jump-size', deck: 'C', change: 'halve' }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-or-jump-size', deck: 'D', change: 'double' }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-toggle', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'loop-toggle', deck: 'B' }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue-walk', deck: 'C', direction: 'prev' }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue-walk', deck: 'D', direction: 'next' }, edge: 'down' },
    ]);
  });

  it('maps shifted Hot Cue pads to clear on every deck', () => {
    expect(translate([press(8, 0), press(10, 7), press(12, 3), press(14, 5)])).toEqual([
      { kind: 'button', target: { control: 'hot-cue-clear', deck: 'A', pad: 1 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue-clear', deck: 'B', pad: 8 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue-clear', deck: 'C', pad: 4 }, edge: 'down' },
      { kind: 'button', target: { control: 'hot-cue-clear', deck: 'D', pad: 6 }, edge: 'down' },
    ]);
  });

  it('maps Beat Jump pads as four left/right size pairs', () => {
    expect(translate(Array.from({ length: 8 }, (_, pad) => press(7, 32 + pad)))).toEqual(
      [8, 8, 4, 4, 2, 2, 1, 1].map((divisor, pad) => ({
        kind: 'button',
        target: {
          control: 'beatjump-window',
          deck: 'A',
          direction: pad % 2 === 0 ? 'back' : 'forward',
          divisor,
        },
        edge: 'down',
      }))
    );
    expect(translate([press(8, 38), press(8, 39)])).toEqual([
      { kind: 'button', target: { control: 'beatjump-size', deck: 'A', change: 'halve' }, edge: 'down' },
      { kind: 'button', target: { control: 'beatjump-size', deck: 'A', change: 'double' }, edge: 'down' },
    ]);
  });

  it('maps Beat Loop pads to the quarter-through-32-beat ladder', () => {
    const beats = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
    expect(translate(beats.map((_, pad) => press(8, 96 + pad)))).toEqual(
      beats.map((size) => ({
        kind: 'button',
        target: { control: 'loop-preset', deck: 'A', beats: size },
        edge: 'down',
      }))
    );
  });

  it('maps STEMS pads to the BPM panel actions in DOM order', () => {
    expect(translate(Array.from({ length: 8 }, (_, pad) => press(7, 16 + pad)))).toEqual([
      { kind: 'button', target: { control: 'grid-bpm', deck: 'A', change: 'shrink' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-bpm', deck: 'A', change: 'grow' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-nudge', deck: 'A', direction: 'earlier' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-anchor', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-drop-anchor', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-nudge', deck: 'A', direction: 'later' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-reset-mark', deck: 'A' }, edge: 'down' },
      { kind: 'button', target: { control: 'grid-reset-delete', deck: 'A' }, edge: 'down' },
    ]);
  });

  it('routes pad mode blocks across the B-D deck channels', () => {
    expect(translate([press(9, 32), press(12, 96), press(13, 23)])).toEqual([
      {
        kind: 'button',
        target: { control: 'beatjump-window', deck: 'B', direction: 'back', divisor: 8 },
        edge: 'down',
      },
      {
        kind: 'button',
        target: { control: 'loop-preset', deck: 'C', beats: 0.25 },
        edge: 'down',
      },
      {
        kind: 'button',
        target: { control: 'grid-reset-delete', deck: 'D' },
        edge: 'down',
      },
    ]);
  });

  it('leaves Groove Circuit, effects, Pad FX, Sampler, Key Shift, and Keyboard unmapped', () => {
    expect(
      translate([press(0, 0), press(4, 16), press(8, 16), press(7, 48), press(14, 112), press(7, 64)])
    ).toEqual([]);
  });

  it('declares A–D transport, PFL, and Hot Cue Feedback addresses', () => {
    expect(DDJ_GRV6.feedback?.decks.C).toMatchObject({
      play: { channel: 2, number: 11, onVelocity: 127 },
      cue: { channel: 2, number: 12, onVelocity: 127 },
      pfl: { channel: 2, number: 84, onVelocity: 127 },
    });
    expect(DDJ_GRV6.feedback?.decks.D?.hotCuePads).toHaveLength(8);
    expect(DDJ_GRV6.feedback?.decks.D?.hotCuePadsShifted).toHaveLength(8);
    expect(DDJ_GRV6.feedback?.decks.D?.jumpPads).toHaveLength(8);
    expect(DDJ_GRV6.feedback?.decks.D?.gridPads).toHaveLength(8);
    expect(DDJ_GRV6.feedback?.decks.D?.loopPads).toHaveLength(8);
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
    expect(messages).toContainEqual([0x9c, 0, 0x7f]);
  });

  it('addresses Beat Jump, GRID, and Beat Loop mode blocks independently', () => {
    const states = {
      play: false,
      cue: false,
      pfl: false,
      pads: Array(8).fill(false),
      gridPads: [true, true, false, true, true, true, true, true],
      quantize: false,
      keyLock: false,
      loopBeats: 0.25,
    };
    const messages = encodeDeckLeds(DDJ_GRV6.feedback!, 'D', states);
    expect(messages).toContainEqual([0x9d, 32, 0]);
    expect(messages).toContainEqual([0x9d, 18, 0x7f]);
    expect(messages).toContainEqual([0x9e, 96, 0x7f]);
  });
});

describe('browse cluster (four-deck-performance 25)', () => {
  it('maps rotary press and tilt directions, including the E1 tilt-right quirk', () => {
    expect(
      translate([press(6, 65), press(6, 56), press(6, 58), press(6, 60), press(6, 46)])
    ).toEqual([
      { kind: 'button', target: { control: 'browse-activate' }, edge: 'down' },
      { kind: 'button', target: { control: 'selection-page', direction: 'up' }, edge: 'down' },
      { kind: 'button', target: { control: 'selection-page', direction: 'down' }, edge: 'down' },
      { kind: 'button', target: { control: 'browse-area-move', direction: 'left' }, edge: 'down' },
      { kind: 'button', target: { control: 'browse-area-move', direction: 'right' }, edge: 'down' },
    ]);
  });

  it('maps shifted vertical tilts to list ends (the official top/bottom)', () => {
    expect(translate([press(6, 57), press(6, 59)])).toEqual([
      { kind: 'button', target: { control: 'selection-end', direction: 'top' }, edge: 'down' },
      { kind: 'button', target: { control: 'selection-end', direction: 'bottom' }, edge: 'down' },
    ]);
  });

  it('maps BACK/VIEW/DISCOVER and their shift layers', () => {
    expect(translate([press(6, 101), press(6, 102), press(6, 122), press(6, 53), press(6, 104)])).toEqual([
      { kind: 'button', target: { control: 'browse-focus-sidebar' }, edge: 'down' },
      { kind: 'button', target: { control: 'split-view-toggle' }, edge: 'down' },
      { kind: 'button', target: { control: 'view-toggle' }, edge: 'down' },
      { kind: 'button', target: { control: 'follow-macro' }, edge: 'down' },
      { kind: 'button', target: { control: 'follow-known-only' }, edge: 'down' },
    ]);
  });

  it('leaves PREVIEW, shifted rotate, shifted press, and shifted loads absent', () => {
    expect(
      translate([press(6, 54), press(6, 55), press(6, 66), press(6, 88), cc(6, 100, 1)])
    ).toEqual([]);
  });
});
