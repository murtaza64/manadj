import type { ChannelId, StemName } from '../../playback/mixer';
import { STEM_NAMES } from '../../playback/mixer';
import { BEAT_FX_EFFECTS } from '../../playback/beatFx';
import type { LayeredControl } from '../actions';
import type {
  BeatFxEngageLamp,
  Binding,
  DeckFeedback,
  LedAddress,
  Mapping,
  MeterAddress,
} from '../mapping';

/**
 * Pioneer DDJ-SB3, from the official MIDI message list ver. 1.00 (2018)
 * cross-checked against the Mixxx mapping. NOT hardware-verified: facts and
 * the open verification list live in docs/research/ddj-sb3-hardware.md;
 * user-facing reference in docs/controllers/ddj-sb3.md.
 *
 * Two physical sides over a two-channel mixer, layered ×2 by the DECK
 * buttons: the whole side — deck controls AND its mixer strip — reports on
 * the active layer's channel. Every binding is channel-addressed, so Decks
 * C/D work through the same tables; the DECK report re-arms soft takeover
 * for the side's layered controls (SB3_LAYERED).
 */

interface DeckMidi {
  deck: ChannelId;
  channel: number;
  padChannel: number;
}

const DECKS: readonly DeckMidi[] = [
  { deck: 'A', channel: 0, padChannel: 7 },
  { deck: 'B', channel: 1, padChannel: 8 },
  { deck: 'C', channel: 2, padChannel: 9 },
  { deck: 'D', channel: 3, padChannel: 10 },
];

/** Pad note blocks per device pad mode; pad n = block + n − 1. */
const PAD_BLOCK = {
  hotCue: 0,
  sampler: 48,
  beatJump: 64,
  roll: 80,
  slicer: 96,
} as const;
/** SHIFT+pad = same channel, block + 8. */
const SHIFT = 8;

const LOOP_PRESETS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
const JUMP_DIVISORS = [8, 8, 4, 4, 2, 2, 1, 1] as const;
/** SAMPLER pads 1–4 → stems in STEM_NAMES order (kill; SHIFT = solo). */
const STEM_PADS: readonly StemName[] = STEM_NAMES;

/** Absolute controls the DECK layer moves between A⟷C / B⟷D. The filter
 * knobs sit on the global channel but still report per layer (CC 23/25
 * left, 24/26 right — Mixxx binds CH3's to the left knob). */
const SB3_LAYERED: readonly LayeredControl[] = ['pitch', 'trim', 'eq', 'filter', 'channel-fader'];

const GLOBAL = 6;

/**
 * FX units: FX1 = ch 5 (left side, DECK1/3), FX2 = ch 6 (right, DECK2/4).
 * Both drive manadj's ONE Beat FX section (CONTEXT.md, Beat FX):
 * FX-1/2/3 engage echo/reverb/flanger on the side's focused Deck;
 * SHIFT+FX-1/2/3 engage them on master. Pressing the running pairing again
 * turns the section off. The units are not independent: engaging on one
 * side moves the section there.
 */
const FX_UNITS = [
  { side: 'left', channel: 4 },
  { side: 'right', channel: 5 },
] as const;
const FX_BUTTON = 71; // FX-1; FX-2 = 72, FX-3 = 73
const FX_BUTTON_SHIFT = 99; // SHIFT+FX-1; 100, 101
/** LEVEL/DEPTH MSB/LSB pairs. The PDF lists three (per FX slot?); Mixxx
 * binds only 6/38. All three drive the same knob binding. */
const FX_LEVEL_PAIRS = [
  [2, 34],
  [4, 36],
  [6, 38],
] as const;

function fxBindings(): Binding[] {
  return FX_UNITS.flatMap(({ side, channel }) => [
    ...BEAT_FX_EFFECTS.map((effect, i) =>
      button(channel, FX_BUTTON + i, { control: 'beat-fx-engage', scope: side, effect })
    ),
    ...BEAT_FX_EFFECTS.map((effect, i) =>
      button(channel, FX_BUTTON_SHIFT + i, { control: 'beat-fx-engage', scope: 'master', effect })
    ),
    ...FX_LEVEL_PAIRS.map(([msb, lsb]) =>
      absolute14(channel, msb, lsb, { control: 'beat-fx-level', side })
    ),
  ]);
}

function fxLamps(): BeatFxEngageLamp[] {
  return FX_UNITS.flatMap(({ side, channel }) => [
    ...BEAT_FX_EFFECTS.map((effect, i) => ({ ...led(channel, FX_BUTTON + i), scope: side, effect })),
    ...BEAT_FX_EFFECTS.map((effect, i) => ({
      ...led(channel, FX_BUTTON_SHIFT + i),
      scope: 'master' as const,
      effect,
    })),
  ]);
}

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

const jog = (
  channel: number,
  number: number,
  target: Extract<Binding, { controlType: 'relative' }>['target']
): Binding => ({
  match: { message: 'cc', channel, number },
  controlType: 'relative',
  target,
  encoding: 'offset-64',
  jogProfile: 'ddj-sb3',
});

const led = (channel: number, number: number): LedAddress => ({
  channel,
  number,
  onVelocity: 0x7f,
});

/** CH Level Indicator: CC 2 on the deck channel, 0–127. Mixxx's SB3
 * script caps ordinary level at 117 and sends 119 for clipping — the same
 * scheme as the GRV6 meter. */
const meter = (channel: number): MeterAddress => ({
  channel,
  number: 2,
  minValue: 0,
  levelMaxValue: 0x75,
  peakValue: 0x77,
});

function deckBindings({ deck, channel, padChannel }: DeckMidi): Binding[] {
  return [
    button(channel, 11, { control: 'transport', deck }),
    button(channel, 12, { control: 'cue', deck }),
    button(channel, 88, { control: 'sync', deck }),
    button(channel, 92, { control: 'match', deck }),
    button(channel, 26, { control: 'key-lock', deck }),
    // No QUANTIZE button: SHIFT+KEY LOCK (Serato's tempo range) hosts it.
    button(channel, 96, { control: 'quantize' }),
    button(channel, 23, { control: 'vinyl-mode', deck }),
    button(channel, 64, { control: 'slip-mode', deck }),
    button(channel, 54, { control: 'jog-touch-edge', deck, shifted: false }),
    // Mixxx also binds 53 ("touch, vinyl off"); absent from the PDF.
    button(channel, 53, { control: 'jog-touch-edge', deck, shifted: false }),
    button(channel, 103, { control: 'jog-touch-edge', deck, shifted: true }),
    button(channel, 84, { control: 'pfl', channel: deck }),
    // DECK press reports the newly active layer on its own channel.
    button(channel, 114, { control: 'set-control-focus', deck, layered: SB3_LAYERED }),
    // LOOP 1/2X / 2X: beatjump (GRV6 IN/OUT parity); SHIFT = size.
    button(channel, 18, { control: 'beatjump', deck, direction: 'back' }),
    button(channel, 19, { control: 'beatjump', deck, direction: 'forward' }),
    button(channel, 97, { control: 'loop-or-jump-size', deck, change: 'halve' }),
    button(channel, 98, { control: 'loop-or-jump-size', deck, change: 'double' }),
    button(channel, 20, { control: 'loop-toggle', deck }),
    // TEMPO: "−" side = 0. SHIFT sends CC 5/37 — bound too so holding
    // SHIFT never freezes the fader.
    absolute14(channel, 0, 32, { control: 'pitch', deck }),
    absolute14(channel, 5, 37, { control: 'pitch', deck }),
    absolute14(channel, 19, 51, { control: 'channel-fader', channel: deck }),
    absolute14(channel, 4, 36, { control: 'trim', channel: deck }),
    absolute14(channel, 7, 39, { control: 'eq', channel: deck, band: 'high' }),
    absolute14(channel, 11, 43, { control: 'eq', channel: deck, band: 'mid' }),
    absolute14(channel, 15, 47, { control: 'eq', channel: deck, band: 'low' }),
    jog(channel, 33, { control: 'jog', deck }),
    jog(channel, 34, { control: 'jog-touch', deck }),
    jog(channel, 35, { control: 'jog-vinyl-off', deck }),
    jog(channel, 31, { control: 'jog-seek', deck }),
    jog(channel, 38, { control: 'jog-seek', deck }),
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, PAD_BLOCK.hotCue + pad, { control: 'hot-cue', deck, pad: pad + 1 })
    ),
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, PAD_BLOCK.hotCue + SHIFT + pad, {
        control: 'hot-cue-clear',
        deck,
        pad: pad + 1,
      })
    ),
    ...Array.from({ length: 8 }, (_, pad) =>
      button(padChannel, PAD_BLOCK.beatJump + pad, {
        control: 'beatjump-window',
        deck,
        direction: pad % 2 === 0 ? 'back' : 'forward',
        divisor: JUMP_DIVISORS[pad],
      })
    ),
    button(padChannel, PAD_BLOCK.beatJump + SHIFT + 6, {
      control: 'beatjump-size',
      deck,
      change: 'halve',
    }),
    button(padChannel, PAD_BLOCK.beatJump + SHIFT + 7, {
      control: 'beatjump-size',
      deck,
      change: 'double',
    }),
    ...LOOP_PRESETS.map((beats, pad) =>
      button(padChannel, PAD_BLOCK.roll + pad, { control: 'loop-preset', deck, beats })
    ),
    // SLICER → GRID, same pad order as the GRV6 / on-screen BPM panel.
    button(padChannel, PAD_BLOCK.slicer, { control: 'grid-bpm', deck, change: 'shrink' }),
    button(padChannel, PAD_BLOCK.slicer + 1, { control: 'grid-bpm', deck, change: 'grow' }),
    button(padChannel, PAD_BLOCK.slicer + 2, {
      control: 'grid-nudge',
      deck,
      direction: 'earlier',
    }),
    button(padChannel, PAD_BLOCK.slicer + 3, { control: 'grid-anchor', deck }),
    button(padChannel, PAD_BLOCK.slicer + 4, { control: 'grid-drop-anchor', deck }),
    button(padChannel, PAD_BLOCK.slicer + 5, {
      control: 'grid-nudge',
      deck,
      direction: 'later',
    }),
    button(padChannel, PAD_BLOCK.slicer + 6, { control: 'grid-reset-mark', deck }),
    button(padChannel, PAD_BLOCK.slicer + 7, { control: 'grid-reset-delete', deck }),
    ...STEM_PADS.map((stem, pad) =>
      button(padChannel, PAD_BLOCK.sampler + pad, { control: 'stem', channel: deck, stem })
    ),
    ...STEM_PADS.map((stem, pad) =>
      button(padChannel, PAD_BLOCK.sampler + SHIFT + pad, {
        control: 'stem-solo',
        channel: deck,
        stem,
      })
    ),
    // FX FADE (16), PAD SCRATCH (32), TRANS (112) are firmware-driven
    // modes: deliberately unbound.
  ];
}

function deckFeedback({ channel, padChannel }: DeckMidi): DeckFeedback {
  const pads = (block: number) => Array.from({ length: 8 }, (_, pad) => led(padChannel, block + pad));
  return {
    play: led(channel, 11),
    cue: led(channel, 12),
    pfl: led(channel, 84),
    hotCuePads: pads(PAD_BLOCK.hotCue),
    hotCuePadsShifted: pads(PAD_BLOCK.hotCue + SHIFT),
    jumpPads: pads(PAD_BLOCK.beatJump),
    gridPads: pads(PAD_BLOCK.slicer),
    gridPadMapped: Array.from({ length: 8 }, () => true),
    quantize: led(channel, 96),
    sync: led(channel, 88),
    keyLock: led(channel, 26),
    slipMode: led(channel, 64),
    vinylMode: led(channel, 23),
    loopPads: LOOP_PRESETS.map((beats, pad) => ({ ...led(padChannel, PAD_BLOCK.roll + pad), beats })),
    loopPadsShifted: [],
    stemPads: STEM_PADS.map((_, pad) => led(padChannel, PAD_BLOCK.sampler + pad)),
    stemPadsShifted: STEM_PADS.map((_, pad) => led(padChannel, PAD_BLOCK.sampler + SHIFT + pad)),
  };
}

export const DDJ_SB3: Mapping = {
  portNameMatch: 'DDJ-SB3',
  bindings: [
    ...DECKS.flatMap(deckBindings),
    {
      match: { message: 'cc', channel: GLOBAL, number: 64 },
      controlType: 'relative',
      target: { control: 'selection-move' },
    },
    button(GLOBAL, 65, { control: 'browse-activate' }),
    // No VIEW button: SHIFT+browse press toggles Performance ⟷ Library.
    button(GLOBAL, 66, { control: 'view-toggle' }),
    // LOAD L = 70 (deck 1) / 72 (deck 3); LOAD R = 71 / 73 — per layer.
    ...DECKS.map(({ deck }, index) => button(GLOBAL, 70 + index, { control: 'load', deck })),
    ...DECKS.map(({ deck }, index) =>
      absolute14(GLOBAL, 23 + index, 55 + index, { control: 'filter', channel: deck })
    ),
    absolute14(GLOBAL, 31, 63, { control: 'crossfader' }),
    ...fxBindings(),
    // SHIFT+LEVEL (CC 18/50) unbound: echo beats stay screen/keyboard.
    // Deliberately UNBOUND: MASTER LEVEL (CC 8/40) and HEADPHONES VOL
    // (CC 13/45) act on the device's own audio interface (Mixxx manual) —
    // binding would double-apply, as on the GRV6. MASTER CUE (91/120),
    // SHIFT+rotate (CC 100), SHIFT+LOAD, SHIFT+DECK (115), SHIFT+PLAY/CUE
    // (71/72), SHIFT+AUTO LOOP (80), SHIFT+headphone CUE (104), fader-start
    // notes (102/81/82) stay open.
  ],
  feedback: {
    decks: Object.fromEntries(DECKS.map((entry) => [entry.deck, deckFeedback(entry)])),
    meters: Object.fromEntries(DECKS.map((entry) => [entry.deck, meter(entry.channel)])),
    beatFxEngage: fxLamps(),
  },
};
