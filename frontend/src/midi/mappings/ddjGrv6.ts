import type { ChannelId } from '../../playback/mixer';
import type { Binding, DeckFeedback, LedAddress, Mapping } from '../mapping';

interface DeckMidi {
  deck: ChannelId;
  channel: number;
  padChannel: number;
  shiftedPadChannel: number;
}

const DECKS: readonly DeckMidi[] = [
  { deck: 'A', channel: 0, padChannel: 7, shiftedPadChannel: 8 },
  { deck: 'B', channel: 1, padChannel: 9, shiftedPadChannel: 10 },
  { deck: 'C', channel: 2, padChannel: 11, shiftedPadChannel: 12 },
  { deck: 'D', channel: 3, padChannel: 13, shiftedPadChannel: 14 },
];

const PAD_BLOCK = {
  hotCue: 0,
  grid: 16,
  beatjump: 32,
  beatLoop: 96,
} as const;

const LOOP_PRESETS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
const JUMP_DIVISORS = [8, 8, 4, 4, 2, 2, 1, 1] as const;

const button = (
  channel: number,
  number: number,
  target: Extract<Binding, { controlType: 'button' }>['target']
): Binding => ({ match: { message: 'note', channel, number }, controlType: 'button', target });

const absolute14 = (
  channel: number,
  msb: number,
  lsb: number,
  target: Extract<Binding, { controlType: 'absolute' }>['target']
): Binding => ({
  match: { message: 'cc', channel, number: msb },
  controlType: 'absolute',
  target,
  bits: 14,
  lsbNumber: lsb,
});

const led = (channel: number, number: number): LedAddress => ({
  channel,
  number,
  onVelocity: 0x7f,
});

function deckBindings({ deck, channel, padChannel, shiftedPadChannel }: DeckMidi): Binding[] {
  return [
    button(channel, 11, { control: 'transport', deck }),
    button(channel, 12, { control: 'cue', deck }),
    button(channel, 53, { control: 'quantize' }),
    button(channel, 26, { control: 'key-lock', deck }),
    // Hardware BEAT SYNC is manadj's established one-shot MATCH gesture;
    // continuous sync remains deliberately absent.
    button(channel, 88, { control: 'match', deck }),
    button(channel, 84, { control: 'pfl', channel: deck }),
    // The controller reports selected logical Deck state on note 60:
    // velocity 0x7f for selected, 0 for the displaced layer.
    button(channel, 60, { control: 'set-control-focus', deck }),
    button(channel, 16, { control: 'beatjump', deck, direction: 'back' }),
    button(channel, 17, { control: 'beatjump', deck, direction: 'forward' }),
    button(channel, 76, { control: 'loop-or-jump-size', deck, change: 'halve' }),
    button(channel, 119, { control: 'loop-or-jump-size', deck, change: 'double' }),
    button(channel, 20, { control: 'loop-toggle', deck }),
    button(channel, 77, { control: 'loop-toggle', deck }),
    button(channel, 81, { control: 'hot-cue-walk', deck, direction: 'prev' }),
    button(channel, 83, { control: 'hot-cue-walk', deck, direction: 'next' }),
    // PDF polarity is explicit: minus side = minimum, plus side = maximum.
    // Verify the physical fader orientation when the controller arrives.
    absolute14(channel, 0, 32, { control: 'pitch', deck }),
    absolute14(channel, 19, 51, { control: 'channel-fader', channel: deck }),
    absolute14(channel, 4, 36, { control: 'trim', channel: deck }),
    absolute14(channel, 7, 39, { control: 'eq', channel: deck, band: 'high' }),
    absolute14(channel, 11, 43, { control: 'eq', channel: deck, band: 'mid' }),
    absolute14(channel, 15, 47, { control: 'eq', channel: deck, band: 'low' }),
    {
      match: { message: 'cc', channel, number: 33 },
      controlType: 'relative',
      target: { control: 'jog', deck },
      encoding: 'offset-64',
    },
    // Platter ROTATION streams differ by Vinyl mode. Vinyl-on rotation uses
    // the existing touch-stream behavior: fine seek while paused, ignored
    // while playing because scratch remains unsupported. The separate touch
    // note has no manadj action and stays unmapped. Vinyl-off nudges/seeks.
    {
      match: { message: 'cc', channel, number: 34 },
      controlType: 'relative',
      target: { control: 'jog-touch', deck },
      encoding: 'offset-64',
    },
    {
      match: { message: 'cc', channel, number: 35 },
      controlType: 'relative',
      target: { control: 'jog', deck },
      encoding: 'offset-64',
    },
    {
      match: { message: 'cc', channel, number: 38 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck },
      encoding: 'offset-64',
    },
    {
      match: { message: 'cc', channel, number: 41 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck },
      encoding: 'offset-64',
    },
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, PAD_BLOCK.hotCue + pad, { control: 'hot-cue', deck, pad: pad + 1 })
    ),
    ...Array.from({ length: 8 }, (_, pad) =>
      button(shiftedPadChannel, PAD_BLOCK.hotCue + pad, {
        control: 'hot-cue-clear',
        deck,
        pad: pad + 1,
      })
    ),
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, PAD_BLOCK.beatjump + pad, {
        control: 'beatjump-window',
        deck,
        direction: pad % 2 === 0 ? 'back' : 'forward',
        divisor: JUMP_DIVISORS[pad],
      })
    ),
    button(shiftedPadChannel, PAD_BLOCK.beatjump + 6, {
      control: 'beatjump-size',
      deck,
      change: 'halve',
    }),
    button(shiftedPadChannel, PAD_BLOCK.beatjump + 7, {
      control: 'beatjump-size',
      deck,
      change: 'double',
    }),
    ...LOOP_PRESETS.map((beats, pad) =>
      button(shiftedPadChannel, PAD_BLOCK.beatLoop + pad, {
        control: 'loop-preset',
        deck,
        beats,
      })
    ),
    button(padChannel, PAD_BLOCK.grid, { control: 'grid-bpm', deck, change: 'shrink' }),
    button(padChannel, PAD_BLOCK.grid + 1, { control: 'grid-bpm', deck, change: 'grow' }),
    button(padChannel, PAD_BLOCK.grid + 2, {
      control: 'grid-nudge',
      deck,
      direction: 'earlier',
    }),
    button(padChannel, PAD_BLOCK.grid + 3, { control: 'grid-anchor', deck }),
    button(padChannel, PAD_BLOCK.grid + 4, { control: 'grid-drop-anchor', deck }),
    button(padChannel, PAD_BLOCK.grid + 5, {
      control: 'grid-nudge',
      deck,
      direction: 'later',
    }),
    button(padChannel, PAD_BLOCK.grid + 6, { control: 'grid-reset-mark', deck }),
    button(padChannel, PAD_BLOCK.grid + 7, { control: 'grid-reset-delete', deck }),
  ];
}

function deckFeedback({ channel, padChannel, shiftedPadChannel }: DeckMidi): DeckFeedback {
  return {
    play: led(channel, 11),
    cue: led(channel, 12),
    pfl: led(channel, 84),
    hotCuePads: Array.from({ length: 8 }, (_, pad) => led(padChannel, pad)),
    hotCuePadsShifted: Array.from({ length: 8 }, (_, pad) => led(shiftedPadChannel, pad)),
    jumpPads: Array.from({ length: 8 }, (_, pad) => led(padChannel, PAD_BLOCK.beatjump + pad)),
    gridPads: Array.from({ length: 8 }, (_, pad) => led(padChannel, PAD_BLOCK.grid + pad)),
    gridPadMapped: Array.from({ length: 8 }, () => true),
    quantize: led(channel, 53),
    keyLock: led(channel, 26),
    loopPads: LOOP_PRESETS.map((beats, pad) => ({
      ...led(shiftedPadChannel, PAD_BLOCK.beatLoop + pad),
      beats,
    })),
    loopPadsShifted: [],
  };
}

/** AlphaTheta DDJ-GRV6, from the official E1 MIDI message list (2024). */
export const DDJ_GRV6: Mapping = {
  portNameMatch: 'DDJ-GRV6',
  bindings: [
    ...DECKS.flatMap(deckBindings),
    // Smart Rotary Selector and fixed Load 1–4 buttons.
    {
      match: { message: 'cc', channel: 6, number: 64 },
      controlType: 'relative',
      target: { control: 'selection-move' },
    },
    ...DECKS.map(({ deck }, index) => button(6, 70 + index, { control: 'load', deck })),
    // Sound Color FX knobs are the four per-channel sweep filters.
    ...DECKS.map(({ deck }, index) =>
      absolute14(6, 23 + index, 55 + index, { control: 'filter', channel: deck })
    ),
    absolute14(6, 31, 63, { control: 'crossfader' }),
    absolute14(6, 8, 40, { control: 'master' }),
    absolute14(6, 13, 45, { control: 'cue-level' }),
    absolute14(6, 12, 44, { control: 'cue-mix' }),
  ],
  feedback: {
    decks: Object.fromEntries(DECKS.map((entry) => [entry.deck, deckFeedback(entry)])),
  },
};
