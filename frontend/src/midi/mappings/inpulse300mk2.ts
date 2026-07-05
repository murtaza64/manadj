import type { Binding, Mapping } from '../mapping';

/** The shifted pad layer of a deck's HOTCUE mode: notes 0x08-0x0F. */
function shiftedPadClears(deck: 'A' | 'B', channel: number): Binding[] {
  return Array.from({ length: 8 }, (_, i) => ({
    match: { message: 'note' as const, channel, number: 0x08 + i },
    controlType: 'button' as const,
    target: { control: 'hot-cue-clear' as const, deck, pad: i + 1 },
  }));
}

/**
 * Hercules DJControl Inpulse 300 MK2 (glossary: Controller, Mapping).
 *
 * Learned against the physical device via the Web MIDI inspector. Channels
 * are the app's 0-based status-byte low nibble, not human MIDI channel names.
 *
 * The MK2 enumerated as "DJControl Inpulse 300 Mk2" on macOS. Keep the
 * common substring so OS-specific suffixes and MK1/MK2 casing differences do
 * not break matching.
 *
 * Shifted controls are hardware-layered: SHIFT emits its own note and shifted
 * controls emit distinct messages. Only verified unshifted bindings live here
 * until each shifted function has a manadj target.
 */
export const INPULSE_300_MK2: Mapping = {
  portNameMatch: 'DJControl Inpulse 300',
  bindings: [
    // Transport.
    {
      match: { message: 'note', channel: 1, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'B' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'B' },
    },

    // Browser/load.
    {
      match: { message: 'note', channel: 1, number: 0x0d },
      controlType: 'button',
      target: { control: 'load', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x0d },
      controlType: 'button',
      target: { control: 'load', deck: 'B' },
    },
    {
      match: { message: 'cc', channel: 0, number: 0x01 },
      controlType: 'relative',
      target: { control: 'selection-move' },
    },

    // Jogs. The rim (CC #9) only ticks past a rotation-speed threshold; the
    // touch surface (CC #10) streams densely while touched — fine paused
    // seeks live there (issue 11). The touch on/off note #8 stays unmapped.
    {
      match: { message: 'cc', channel: 1, number: 0x09 },
      controlType: 'relative',
      target: { control: 'jog', deck: 'A' },
    },
    {
      match: { message: 'cc', channel: 2, number: 0x09 },
      controlType: 'relative',
      target: { control: 'jog', deck: 'B' },
    },
    {
      match: { message: 'cc', channel: 1, number: 0x0a },
      controlType: 'relative',
      target: { control: 'jog-touch', deck: 'A' },
    },
    {
      match: { message: 'cc', channel: 2, number: 0x0a },
      controlType: 'relative',
      target: { control: 'jog-touch', deck: 'B' },
    },
    // SHIFT+wheel = fast seek (issue 12). Shifted controls emit on ch+3;
    // Mixxx's Inpulse 300 XML corroborates (shift-mode wheel on 0x94/0x95).
    // Both the shifted rim and shifted touch-spin streams seek fast.
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'cc', channel: 4, number: 0x09 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck: 'A' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'cc', channel: 4, number: 0x0a },
      controlType: 'relative',
      target: { control: 'jog-seek', deck: 'A' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'cc', channel: 5, number: 0x09 },
      controlType: 'relative',
      target: { control: 'jog-seek', deck: 'B' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'cc', channel: 5, number: 0x0a },
      controlType: 'relative',
      target: { control: 'jog-seek', deck: 'B' },
    },

    // Pitch faders.
    {
      match: { message: 'cc', channel: 1, number: 0x08 },
      controlType: 'absolute',
      target: { control: 'pitch', deck: 'A' },
      bits: 14,
      lsbNumber: 0x28,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x08 },
      controlType: 'absolute',
      target: { control: 'pitch', deck: 'B' },
      bits: 14,
      lsbNumber: 0x28,
    },

    // Mixer absolute controls.
    {
      match: { message: 'cc', channel: 1, number: 0x05 },
      controlType: 'absolute',
      target: { control: 'trim', channel: 'A' },
      bits: 14,
      lsbNumber: 0x25,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x05 },
      controlType: 'absolute',
      target: { control: 'trim', channel: 'B' },
      bits: 14,
      lsbNumber: 0x25,
    },
    {
      match: { message: 'cc', channel: 1, number: 0x04 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'A', band: 'high' },
      bits: 14,
      lsbNumber: 0x24,
    },
    {
      match: { message: 'cc', channel: 1, number: 0x03 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'A', band: 'mid' },
      bits: 14,
      lsbNumber: 0x23,
    },
    {
      match: { message: 'cc', channel: 1, number: 0x02 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'A', band: 'low' },
      bits: 14,
      lsbNumber: 0x22,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x04 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'B', band: 'high' },
      bits: 14,
      lsbNumber: 0x24,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x03 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'B', band: 'mid' },
      bits: 14,
      lsbNumber: 0x23,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x02 },
      controlType: 'absolute',
      target: { control: 'eq', channel: 'B', band: 'low' },
      bits: 14,
      lsbNumber: 0x22,
    },
    {
      match: { message: 'cc', channel: 1, number: 0x01 },
      controlType: 'absolute',
      target: { control: 'filter', channel: 'A' },
      bits: 14,
      lsbNumber: 0x21,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x01 },
      controlType: 'absolute',
      target: { control: 'filter', channel: 'B' },
      bits: 14,
      lsbNumber: 0x21,
    },
    {
      match: { message: 'cc', channel: 1, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'channel-fader', channel: 'A' },
      bits: 14,
      lsbNumber: 0x20,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'channel-fader', channel: 'B' },
      bits: 14,
      lsbNumber: 0x20,
    },
    {
      match: { message: 'cc', channel: 0, number: 0x00 },
      controlType: 'absolute',
      target: { control: 'crossfader' },
      bits: 14,
      lsbNumber: 0x20,
    },
    {
      match: { message: 'cc', channel: 0, number: 0x03 },
      controlType: 'absolute',
      target: { control: 'master' },
      bits: 14,
      lsbNumber: 0x23,
    },
    // Headphone-level knob → cue level (headphone-cue 03). Hardware-learned.
    // The device has no cue/mix control — that target stays screen-only.
    {
      match: { message: 'cc', channel: 0, number: 0x04 },
      controlType: 'absolute',
      target: { control: 'cue-level' },
      bits: 14,
      lsbNumber: 0x24,
    },

    // PFL buttons (headphone-cue 02): the headphone icon under each VU
    // strip puts that channel in the Cue bus. Hardware-learned.
    {
      match: { message: 'note', channel: 1, number: 0x0c },
      controlType: 'button',
      target: { control: 'pfl', channel: 'A' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x0c },
      controlType: 'button',
      target: { control: 'pfl', channel: 'B' },
    },

    // Deck buttons.
    {
      match: { message: 'note', channel: 1, number: 0x05 },
      controlType: 'button',
      target: { control: 'match', deck: 'A' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x05 },
      controlType: 'button',
      target: { control: 'match', deck: 'B' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x09 },
      controlType: 'button',
      target: { control: 'beatjump', deck: 'A', direction: 'back' },
    },
    {
      match: { message: 'note', channel: 1, number: 0x0a },
      controlType: 'button',
      target: { control: 'beatjump', deck: 'A', direction: 'forward' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x09 },
      controlType: 'button',
      target: { control: 'beatjump', deck: 'B', direction: 'back' },
    },
    {
      match: { message: 'note', channel: 2, number: 0x0a },
      controlType: 'button',
      target: { control: 'beatjump', deck: 'B', direction: 'forward' },
    },
    // Beatjump size on the SHIFT layer of the jump buttons. SHIFT is
    // hardware-layered: shifted controls emit on channel+3 (learned:
    // SHIFT+jump-back deck A = note ch 4 #9, vs ch 1 #9 unshifted).
    {
      match: { message: 'note', channel: 4, number: 0x09 },
      controlType: 'button',
      target: { control: 'beatjump-size', deck: 'A', change: 'halve' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 4, number: 0x0a },
      controlType: 'button',
      target: { control: 'beatjump-size', deck: 'A', change: 'double' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 5, number: 0x09 },
      controlType: 'button',
      target: { control: 'beatjump-size', deck: 'B', change: 'halve' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 5, number: 0x0a },
      controlType: 'button',
      target: { control: 'beatjump-size', deck: 'B', change: 'double' },
    },

    // Hot cues.
    {
      match: { message: 'note', channel: 6, number: 0x00 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 1 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x01 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 2 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x02 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 3 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x03 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 4 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x04 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 5 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x05 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 6 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x06 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 7 },
    },
    {
      match: { message: 'note', channel: 6, number: 0x07 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'A', pad: 8 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x00 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 1 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x01 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 2 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x02 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 3 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x03 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 4 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x04 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 5 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x05 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 6 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x06 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 7 },
    },
    {
      match: { message: 'note', channel: 7, number: 0x07 },
      controlType: 'button',
      target: { control: 'hot-cue', deck: 'B', pad: 8 },
    },

    // SHIFT+pad clears the slot's hot cue. SHIFT is hardware-layered:
    // shifted pads emit notes 0x08-0x0F on the same HOTCUE channels
    // (deck A shifted pad 1 = note 0x08 ch 6, hardware-learned; the other
    // 15 follow the layout — TODO(hardware-verify) at the next smoke test).
    ...shiftedPadClears('A', 6),
    ...shiftedPadClears('B', 7),
  ],

  // LED Feedback addresses. Ground truth: Mixxx's Inpulse 300 mapping
  // (mixxxdj/mixxx res/controllers/Hercules_DJControl_Inpulse_300.midi.xml,
  // "LED Outputs" section) — PLAY LED is note 0x07 / CUE 0x06 on the deck's
  // transport channel (status 0x91/0x92), velocity 0x7f lit / 0x00 dark;
  // hot cue pads are notes 0x00-0x07 on the pads' HOTCUE base-layer channel
  // (status 0x96/0x97), velocity 0x7e lit; the SHIFT-layer pads are the
  // same channels at notes 0x08-0x0F (Mixxx maps both layers to the same
  // hotcue_N_status, so shifted lights mirror the base layer). Other pad
  // modes are note-isolated and never written.
  // The device does not dump LED state on connect (tested); full sync on
  // connect is the app's job. TODO(hardware-verify): smoke-test on the MK2.
  feedback: {
    decks: {
      A: {
        play: { channel: 1, number: 0x07, onVelocity: 0x7f },
        cue: { channel: 1, number: 0x06, onVelocity: 0x7f },
        hotCuePads: Array.from({ length: 8 }, (_, i) => ({
          channel: 6,
          number: i,
          onVelocity: 0x7e,
        })),
        hotCuePadsShifted: Array.from({ length: 8 }, (_, i) => ({
          channel: 6,
          number: 0x08 + i,
          onVelocity: 0x7e,
        })),
      },
      B: {
        play: { channel: 2, number: 0x07, onVelocity: 0x7f },
        cue: { channel: 2, number: 0x06, onVelocity: 0x7f },
        hotCuePads: Array.from({ length: 8 }, (_, i) => ({
          channel: 7,
          number: i,
          onVelocity: 0x7e,
        })),
        hotCuePadsShifted: Array.from({ length: 8 }, (_, i) => ({
          channel: 7,
          number: 0x08 + i,
          onVelocity: 0x7e,
        })),
      },
    },
  },
};
