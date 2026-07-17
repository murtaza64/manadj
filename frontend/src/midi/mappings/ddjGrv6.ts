import type { ChannelId } from '../../playback/mixer';
import type { Binding, DeckFeedback, LedAddress, Mapping, MeterAddress } from '../mapping';

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

/**
 * Channel level-meter output (four-deck-performance 36). AlphaTheta DDJ
 * channel meters are a CONTROL-CHANGE output on each deck's channel — the
 * device drives its five-segment LED ladder from CC 2 on deck channels 0–3.
 * Official E1 MIDI-OUT ranges (hardware-confirmed 2026-07-16):
 *   0x00–0x25 dark; 0x26–0x40 one green; 0x41–0x56 two greens;
 *   0x57–0x64 + one orange; 0x65–0x76 + two oranges;
 *   0x77–0x7f + red.
 * Mixxx's Pioneer mapping caps ordinary `vu_meter` at 0x75 and sends 0x77
 * only when `peak_indicator` reports clipping. We mirror that distinction.
 */
const METER_CC = 2;
const meter = (channel: number): MeterAddress => ({
  channel,
  number: METER_CC,
  minValue: 0,
  levelMaxValue: 0x75,
  peakValue: 0x77,
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
      jogProfile: 'grv6',
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
      jogProfile: 'grv6',
    },
    {
      match: { message: 'cc', channel, number: 35 },
      controlType: 'relative',
      target: { control: 'jog', deck },
      encoding: 'offset-64',
      jogProfile: 'grv6',
    },
    {
      match: { message: 'cc', channel, number: 38 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck },
      encoding: 'offset-64',
      jogProfile: 'grv6',
    },
    {
      match: { message: 'cc', channel, number: 41 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck },
      encoding: 'offset-64',
      jogProfile: 'grv6',
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
    // Browse cluster (four-deck-performance 25, design doc). All on the
    // global channel: rotary press/tilt drive the area-navigation surface;
    // BACK/VIEW/DISCOVER follow the mapping design. PREVIEW, shifted
    // rotate (official: waveform zoom), shifted press/tilt-L/R, and
    // shifted LOAD stay deliberately absent.
    button(6, 65, { control: 'browse-activate' }),
    // Tilt ▲/▼ page the focused list; their shift layer jumps to the ends
    // (the official top/bottom behavior).
    button(6, 56, { control: 'selection-page', direction: 'up' }),
    button(6, 58, { control: 'selection-page', direction: 'down' }),
    button(6, 57, { control: 'selection-end', direction: 'top' }),
    button(6, 59, { control: 'selection-end', direction: 'bottom' }),
    // Tilt ◄/► walk the browse-area ring. The tilt block is sequential
    // (56/58/60/62 = fwd/back/left/right; shifts 57/59/61/63) —
    // hardware-verified 2026-07-15: the E1 PDF's table layout misled an
    // earlier read into note 46 for tilt-right, leaving it dead.
    button(6, 60, { control: 'browse-area-move', direction: 'left' }),
    button(6, 62, { control: 'browse-area-move', direction: 'right' }),
    button(6, 101, { control: 'browse-focus-sidebar' }),
    button(6, 102, { control: 'split-view-toggle' }),
    button(6, 122, { control: 'view-toggle' }),
    // DISCOVER's official job is track suggestion — manadj's Follow.
    button(6, 53, { control: 'follow-macro' }),
    button(6, 104, { control: 'follow-known-only' }),
    // Sound Color FX knobs are the four per-channel sweep filters.
    ...DECKS.map(({ deck }, index) =>
      absolute14(6, 23 + index, 55 + index, { control: 'filter', channel: deck })
    ),
    absolute14(6, 31, 63, { control: 'crossfader' }),
    // MASTER LEVEL (CC 8/40) is deliberately UNBOUND (hardware-verified
    // 2026-07-17, master-headroom): the knob attenuates the GRV6's own
    // analog output stage AND reports CC — binding it to the digital
    // Master double-applies every move (VLC playback confirmed the analog
    // path alone tracks the knob). Room volume belongs to the knob;
    // the on-screen Master (unity 50%, +6 dB max) remains for other
    // outputs. HEADPHONES LEVEL (CC 13/45), HEADPHONES MIX (CC 12/44),
    // and MASTER CUE (note 99) are also hardware-side (verified
    // 2026-07-17): the device blends USB outs 3/4 (manadj's cue bus)
    // with the master pair in its own headphone stage — MIX blends,
    // MASTER CUE gates master in, LEVEL attenuates. All stay unbound;
    // manadj sends a pure PFL cue bus on 3/4 (cue-mix default 0).
  ],
  feedback: {
    decks: Object.fromEntries(DECKS.map((entry) => [entry.deck, deckFeedback(entry)])),
    // Each fixed A–D channel meter on its own deck channel — the meter
    // follows only that channel's signal (channel isolation).
    meters: Object.fromEntries(DECKS.map((entry) => [entry.deck, meter(entry.channel)])),
  },
};
