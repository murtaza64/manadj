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

function deckBindings({ deck, channel, padChannel }: DeckMidi): Binding[] {
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
    // The PDF assigns note block 0 to the first pad mode; verify HOT CUE
    // mode and shifted-pad illumination against the physical device.
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, pad, { control: 'hot-cue', deck, pad: pad + 1 })
    ),
  ];
}

function deckFeedback({ channel, padChannel, shiftedPadChannel }: DeckMidi): DeckFeedback {
  return {
    play: led(channel, 11),
    cue: led(channel, 12),
    pfl: led(channel, 84),
    hotCuePads: Array.from({ length: 8 }, (_, pad) => led(padChannel, pad)),
    hotCuePadsShifted: Array.from({ length: 8 }, (_, pad) => led(shiftedPadChannel, pad)),
    gridPads: [],
    quantize: led(channel, 53),
    keyLock: led(channel, 26),
    loopPads: [],
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
