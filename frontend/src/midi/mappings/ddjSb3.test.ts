import { describe, expect, it } from 'vitest';
import { initialDecoderState, translateMidiMessage } from '../translator';
import type { DecoderState } from '../translator';
import type { MidiAction } from '../actions';
import { DDJ_SB3 } from './ddjSb3';
import { allOffMessages, encodeBeatFxEngageLeds, encodeDeckLeds } from '../feedback';

/** Expectations come from the official DDJ-SB3 MIDI list ver. 1.00
 * (docs/research/ddj-sb3-hardware.md); channels here are 0-based. */

function translate(messages: number[][]): MidiAction[] {
  let state: DecoderState = initialDecoderState();
  return messages.flatMap((message) => {
    const result = translateMidiMessage(message, state, DDJ_SB3);
    state = result.state;
    return [...result.actions];
  });
}

const press = (channel: number, note: number) => [0x90 | channel, note, 0x7f];
const cc = (channel: number, number: number, value: number) => [0xb0 | channel, number, value];
const DECKS = ['A', 'B', 'C', 'D'] as const;
const LAYERED = ['pitch', 'trim', 'eq', 'filter', 'channel-fader'];

const darkStates = {
  sync: false,
  play: false,
  cue: false,
  pfl: false,
  pads: Array(8).fill(false),
  gridPads: [],
  quantize: false,
  keyLock: false,
  slipMode: false,
  vinylMode: false,
  loopBeats: null,
  stems: null,
};

describe('DDJ-SB3 Mapping — deck section', () => {
  it('matches the device port name', () => {
    expect('PIONEER DDJ-SB3'.includes(DDJ_SB3.portNameMatch)).toBe(true);
  });

  it.each(DECKS)('maps deck buttons and their SHIFT layer on deck %s', (deck) => {
    const ch = DECKS.indexOf(deck);
    expect(translate([11, 12, 88, 92, 26, 96, 23, 64, 84, 20].map((n) => press(ch, n)))).toEqual([
      { control: 'transport', deck },
      { control: 'cue', deck },
      { control: 'sync', deck },
      { control: 'match', deck },
      { control: 'key-lock', deck },
      { control: 'quantize' },
      { control: 'vinyl-mode', deck },
      { control: 'slip-mode', deck },
      { control: 'pfl', channel: deck },
      { control: 'loop-toggle', deck },
    ].map((target) => ({ kind: 'button', target, edge: 'down' })));
  });

  it.each(DECKS)('maps LOOP 1/2X / 2X to beatjump and SHIFT to size on deck %s', (deck) => {
    const ch = DECKS.indexOf(deck);
    expect(translate([18, 19, 97, 98].map((n) => press(ch, n))).map((a) => a.target)).toEqual([
      { control: 'beatjump', deck, direction: 'back' },
      { control: 'beatjump', deck, direction: 'forward' },
      { control: 'loop-or-jump-size', deck, change: 'halve' },
      { control: 'loop-or-jump-size', deck, change: 'double' },
    ]);
  });

  it.each(DECKS)('reports DECK layer selection with the layered control set on %s', (deck) => {
    const ch = DECKS.indexOf(deck);
    expect(translate([press(ch, 114)])).toEqual([
      { kind: 'button', target: { control: 'set-control-focus', deck, layered: LAYERED }, edge: 'down' },
    ]);
  });

  it.each(DECKS)('maps jog streams and touch on deck %s with the ddj-sb3 profile', (deck) => {
    const ch = DECKS.indexOf(deck);
    expect(translate([33, 34, 35, 31, 38].map((n) => cc(ch, n, 62)))).toEqual(
      ['jog', 'jog-touch', 'jog-vinyl-off', 'jog-seek', 'jog-seek'].map((control) => ({
        kind: 'relative',
        target: { control, deck },
        ticks: -2,
        jogProfile: 'ddj-sb3',
      }))
    );
    expect(translate([press(ch, 54), [0x90 | ch, 54, 0], press(ch, 103)]).map((a) => a.kind === 'button' && [a.target, a.edge])).toEqual([
      [{ control: 'jog-touch-edge', deck, shifted: false }, 'down'],
      [{ control: 'jog-touch-edge', deck, shifted: false }, 'up'],
      [{ control: 'jog-touch-edge', deck, shifted: true }, 'down'],
    ]);
  });

  it('decodes 14-bit tempo (plain and SHIFT) and the layered mixer strip on C/D', () => {
    expect(
      translate([
        cc(2, 0, 0), cc(2, 32, 0),
        cc(2, 5, 127), cc(2, 37, 127),
        cc(3, 19, 127), cc(3, 51, 127),
        cc(2, 4, 64), cc(2, 36, 0),
        cc(3, 7, 0), cc(3, 39, 0),
        cc(3, 11, 0), cc(3, 43, 0),
        cc(3, 15, 0), cc(3, 47, 0),
      ]).map((a) => a.target)
    ).toEqual([
      { control: 'pitch', deck: 'C' },
      { control: 'pitch', deck: 'C' },
      { control: 'channel-fader', channel: 'D' },
      { control: 'trim', channel: 'C' },
      { control: 'eq', channel: 'D', band: 'high' },
      { control: 'eq', channel: 'D', band: 'mid' },
      { control: 'eq', channel: 'D', band: 'low' },
    ]);
  });
});

describe('DDJ-SB3 Mapping — performance pads', () => {
  const padCh = (deck: (typeof DECKS)[number]) => 7 + DECKS.indexOf(deck);

  it.each(DECKS)('HOT CUE pads set/clear on deck %s', (deck) => {
    const ch = padCh(deck);
    expect(translate([press(ch, 0), press(ch, 7), press(ch, 8), press(ch, 15)]).map((a) => a.target)).toEqual([
      { control: 'hot-cue', deck, pad: 1 },
      { control: 'hot-cue', deck, pad: 8 },
      { control: 'hot-cue-clear', deck, pad: 1 },
      { control: 'hot-cue-clear', deck, pad: 8 },
    ]);
  });

  it('BEAT JUMP pads are four left/right window pairs; SHIFT 7/8 resize', () => {
    expect(translate(Array.from({ length: 8 }, (_, i) => press(7, 64 + i))).map((a) => a.target)).toEqual(
      [8, 8, 4, 4, 2, 2, 1, 1].map((divisor, i) => ({
        control: 'beatjump-window',
        deck: 'A',
        direction: i % 2 === 0 ? 'back' : 'forward',
        divisor,
      }))
    );
    expect(translate([press(7, 78), press(7, 79)]).map((a) => a.target)).toEqual([
      { control: 'beatjump-size', deck: 'A', change: 'halve' },
      { control: 'beatjump-size', deck: 'A', change: 'double' },
    ]);
  });

  it('ROLL pads engage the 1/4–32 beat loop ladder', () => {
    expect(translate(Array.from({ length: 8 }, (_, i) => press(8, 80 + i))).map((a) => a.target)).toEqual(
      [0.25, 0.5, 1, 2, 4, 8, 16, 32].map((beats) => ({ control: 'loop-preset', deck: 'B', beats }))
    );
  });

  it('SLICER pads mirror the BPM panel (GRID) in DOM order', () => {
    expect(translate(Array.from({ length: 8 }, (_, i) => press(9, 96 + i))).map((a) => a.target.control)).toEqual([
      'grid-bpm', 'grid-bpm', 'grid-nudge', 'grid-anchor',
      'grid-drop-anchor', 'grid-nudge', 'grid-reset-mark', 'grid-reset-delete',
    ]);
  });

  it('SAMPLER pads 1–4 kill stems, SHIFT solos; pads 5–8 unbound', () => {
    expect(translate([48, 49, 50, 51, 56, 59, 52, 55].map((n) => press(10, n))).map((a) => a.target)).toEqual([
      { control: 'stem', channel: 'D', stem: 'vocals' },
      { control: 'stem', channel: 'D', stem: 'drums' },
      { control: 'stem', channel: 'D', stem: 'bass' },
      { control: 'stem', channel: 'D', stem: 'other' },
      { control: 'stem-solo', channel: 'D', stem: 'vocals' },
      { control: 'stem-solo', channel: 'D', stem: 'other' },
    ]);
  });

  it('leaves firmware-driven FX FADE, PAD SCRATCH, TRANS pads and mode buttons unbound', () => {
    const notes = [16, 23, 24, 32, 39, 40, 112, 119, 120, 127];
    expect(translate(notes.map((n) => press(7, n)))).toEqual([]);
    expect(translate([27, 105, 30, 107, 32, 109, 34, 110].map((n) => press(0, n)))).toEqual([]);
  });
});

describe('DDJ-SB3 Mapping — browser, mixer globals', () => {
  it('maps encoder, press, SHIFT press, and per-layer LOAD', () => {
    expect(
      translate([cc(6, 64, 1), cc(6, 64, 127), press(6, 65), press(6, 66), press(6, 70), press(6, 71), press(6, 72), press(6, 73)])
    ).toEqual([
      { kind: 'relative', target: { control: 'selection-move' }, ticks: 1 },
      { kind: 'relative', target: { control: 'selection-move' }, ticks: -1 },
      ...[
        { control: 'browse-activate' },
        { control: 'view-toggle' },
        { control: 'load', deck: 'A' },
        { control: 'load', deck: 'B' },
        { control: 'load', deck: 'C' },
        { control: 'load', deck: 'D' },
      ].map((target) => ({ kind: 'button', target, edge: 'down' })),
    ]);
  });

  it('maps CH1–4 filters and the crossfader on the global channel', () => {
    expect(translate([cc(6, 23, 0), cc(6, 55, 0), cc(6, 26, 127), cc(6, 58, 127), cc(6, 31, 64), cc(6, 63, 0)])).toEqual([
      { kind: 'absolute', target: { control: 'filter', channel: 'A' }, value: 0 },
      { kind: 'absolute', target: { control: 'filter', channel: 'D' }, value: 1 },
      { kind: 'absolute', target: { control: 'crossfader' }, value: 8192 / 16383 },
    ]);
  });

  it('leaves hardware-side levels, MASTER CUE, and open SHIFT slots unbound', () => {
    expect(
      translate([
        cc(6, 8, 64), cc(6, 40, 0), cc(6, 13, 64), cc(6, 45, 0), cc(6, 100, 1),
        press(6, 91), press(6, 120), press(6, 88), press(6, 89), press(6, 96), press(6, 97),
        press(0, 71), press(0, 72), press(0, 80), press(0, 104), press(0, 115),
        press(0, 102), press(0, 81), press(0, 82),
      ])
    ).toEqual([]);
  });
});

describe('DDJ-SB3 Mapping — Feedback', () => {
  it('declares A–D lights and meters on the deck/pad channels', () => {
    for (const [index, deck] of DECKS.entries()) {
      expect(DDJ_SB3.feedback?.decks[deck]).toMatchObject({
        play: { channel: index, number: 11 },
        cue: { channel: index, number: 12 },
        quantize: { channel: index, number: 96 },
        vinylMode: { channel: index, number: 23 },
        slipMode: { channel: index, number: 64 },
      });
      expect(DDJ_SB3.feedback?.meters?.[deck]).toMatchObject({ channel: index, number: 2, peakValue: 0x77 });
    }
  });

  it('addresses each pad-mode block on the deck pad channel', () => {
    const messages = encodeDeckLeds(DDJ_SB3.feedback!, 'C', {
      ...darkStates,
      pads: [true, false, false, false, false, false, false, false],
      gridPads: [true, true, true, true, true, true, true, true],
      loopBeats: 0.25,
      stems: { vocals: false, drums: true, bass: true, other: true },
    });
    expect(messages).toContainEqual([0x99, 0, 0x7f]); // hot cue 1
    expect(messages).toContainEqual([0x99, 8, 0x7f]); // shifted hot cue 1
    expect(messages).toContainEqual([0x99, 96, 0x7f]); // slicer → GRID
    expect(messages).toContainEqual([0x99, 80, 0x7f]); // roll 1/4 loop
    expect(messages).toContainEqual([0x99, 48, 0]); // vocals killed
    expect(messages).toContainEqual([0x99, 49, 0x7f]); // drums on
    expect(messages).toContainEqual([0x99, 57, 0x7f]); // shift mirror
    expect(messages).toContainEqual([0x99, 64, 0]); // beat jump dark
  });

  it('all-off covers the deck and pad channels of every layer', () => {
    const off = allOffMessages(DDJ_SB3.feedback!);
    expect(off).toContainEqual([0x93, 11, 0]);
    expect(off).toContainEqual([0x9a, 0, 0]);
  });
});

describe('DDJ-SB3 Mapping — FX units → Beat FX', () => {
  it.each([['left', 4], ['right', 5]] as const)('FX%s buttons engage echo/reverb/flanger; SHIFT engages on master', (side, ch) => {
    expect(translate([71, 72, 73, 99, 100, 101].map((n) => press(ch, n))).map((a) => a.target)).toEqual([
      { control: 'beat-fx-engage', scope: side, effect: 'echo' },
      { control: 'beat-fx-engage', scope: side, effect: 'reverb' },
      { control: 'beat-fx-engage', scope: side, effect: 'flanger' },
      { control: 'beat-fx-engage', scope: 'master', effect: 'echo' },
      { control: 'beat-fx-engage', scope: 'master', effect: 'reverb' },
      { control: 'beat-fx-engage', scope: 'master', effect: 'flanger' },
    ]);
  });

  it.each([['left', 4], ['right', 5]] as const)('every documented LEVEL/DEPTH CC pair drives the %s knob', (side, ch) => {
    expect(translate([cc(ch, 2, 127), cc(ch, 34, 127), cc(ch, 4, 0), cc(ch, 36, 0), cc(ch, 6, 64), cc(ch, 38, 0)])).toEqual([
      { kind: 'absolute', target: { control: 'beat-fx-level', side }, value: 1 },
      { kind: 'absolute', target: { control: 'beat-fx-level', side }, value: 0 },
      { kind: 'absolute', target: { control: 'beat-fx-level', side }, value: 8192 / 16383 },
    ]);
    expect(translate([cc(ch, 18, 64), cc(ch, 50, 0)])).toEqual([]); // SHIFT+LEVEL unbound
  });

  it('lights the FX button running on its scope, dark otherwise', () => {
    const fb = DDJ_SB3.feedback!;
    const focus = { left: 'C', right: 'B' } as const;
    const on = encodeBeatFxEngageLeds(fb, { on: true, selected: 'reverb', target: 'C' }, focus);
    expect(on).toContainEqual([0x94, 72, 0x7f]); // FX1-2 (reverb, left on C)
    expect(on).toContainEqual([0x95, 72, 0]); // FX2-2: right is on B
    expect(on).toContainEqual([0x94, 71, 0]);
    const master = encodeBeatFxEngageLeds(fb, { on: true, selected: 'echo', target: 'master' }, focus);
    expect(master).toContainEqual([0x94, 99, 0x7f]);
    expect(master).toContainEqual([0x95, 99, 0x7f]);
    const off = encodeBeatFxEngageLeds(fb, { on: false, selected: 'echo', target: 'master' }, focus);
    expect(off.every(([, , v]) => v === 0)).toBe(true);
    expect(allOffMessages(fb)).toContainEqual([0x95, 101, 0]);
  });
});
