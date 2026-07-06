import type { ButtonTarget } from '../actions';
import type { Binding, LoopPadLamp, Mapping } from '../mapping';

/** The shifted pad layer of a deck's HOTCUE mode: notes 0x08-0x0F. */
function shiftedPadClears(deck: 'A' | 'B', channel: number): Binding[] {
  return Array.from({ length: 8 }, (_, i) => ({
    match: { message: 'note' as const, channel, number: 0x08 + i },
    controlType: 'button' as const,
    target: { control: 'hot-cue-clear' as const, deck, pad: i + 1 },
  }));
}

/**
 * The SAMPLER pad mode, repurposed as grid editing (midi-performance-ops
 * 05; PRD: the label lies deliberately — manadj will never have a sampler,
 * and a mode never pressed mid-performance protects stored data). Base
 * notes 0x30-0x37 on the deck's pad channel per Mixxx's
 * Hercules_DJControl_Inpulse_300.midi.xml (hardware-verified 2026-07-06).
 *
 * Layout: top row mirrors the on-screen grid-edit triple (nudge left /
 * anchor / — / nudge right), bottom row the BPM cluster (shrink / grow /
 * halve / double). Pad 3 (0x32) deliberately unbound: silent and dark.
 */
function gridEditPads(deck: 'A' | 'B', channel: number): Binding[] {
  const targets: (ButtonTarget | null)[] = [
    { control: 'grid-nudge', deck, direction: 'earlier' }, // pad 1
    { control: 'grid-anchor', deck }, // pad 2
    null, // pad 3: silent
    { control: 'grid-nudge', deck, direction: 'later' }, // pad 4
    { control: 'grid-bpm', deck, change: 'shrink' }, // pad 5
    { control: 'grid-bpm', deck, change: 'grow' }, // pad 6
    { control: 'grid-bpm', deck, change: 'halve' }, // pad 7
    { control: 'grid-bpm', deck, change: 'double' }, // pad 8
  ];
  return targets.flatMap((target, i) =>
    target === null
      ? []
      : [
          {
            match: { message: 'note' as const, channel, number: 0x30 + i },
            controlType: 'button' as const,
            target,
          },
        ]
  );
}

/**
 * LOOP pad mode preset ladders (midi-performance-ops 02): the base page
 * walks 1–128 beats, the shifted page holds the stutter/dotted sizes —
 * fractions ascending across the top row (pads 1–3), the dotted 3/4 alone
 * on the bottom row (pad 5, review nit 2026-07-06). Entry points over the
 * dyadic loop domain, not the domain (CONTEXT.md: Active loop). `null` =
 * unbound pad — silent, dark. One source for both the bindings and the
 * lamp addresses below.
 */
const LOOP_LADDER_BASE = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const LOOP_LADDER_SHIFTED = [0.125, 0.25, 0.5, null, 0.75, null, null, null] as const;
const LOOP_PADS_BASE_FIRST_NOTE = 0x10;
const LOOP_PADS_SHIFTED_FIRST_NOTE = 0x18;

/** A deck's LOOP-mode pads: base page notes 0x10-0x17 / shifted page notes
 * 0x18-0x1F on the deck's pad channel, per Mixxx's Inpulse 300 file.
 * Unbound ladder slots (null) get no binding. */
function loopPadBindings(deck: 'A' | 'B', channel: number): Binding[] {
  const page = (ladder: readonly (number | null)[], firstNote: number): Binding[] =>
    ladder.flatMap((beats, i) =>
      beats === null
        ? []
        : [
            {
              match: { message: 'note' as const, channel, number: firstNote + i },
              controlType: 'button' as const,
              target: { control: 'loop-preset' as const, deck, beats },
            },
          ]
    );
  return [
    ...page(LOOP_LADDER_BASE, LOOP_PADS_BASE_FIRST_NOTE),
    ...page(LOOP_LADDER_SHIFTED, LOOP_PADS_SHIFTED_FIRST_NOTE),
  ];
}

/** A deck's LOOP-mode pad lamps, addresses mirroring the bindings —
 * unbound pads get no lamp and are never written. */
function loopPadLamps(
  channel: number,
  firstNote: number,
  ladder: readonly (number | null)[]
): LoopPadLamp[] {
  return ladder.flatMap((beats, i) =>
    beats === null ? [] : [{ channel, number: firstNote + i, onVelocity: 0x7e, beats }]
  );
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

    // Pitch faders. DJ polarity: fader down = faster, so the raw CC (which
    // grows upward) is inverted (hardware-verified 2026-07-05).
    {
      match: { message: 'cc', channel: 1, number: 0x08 },
      controlType: 'absolute',
      target: { control: 'pitch', deck: 'A' },
      bits: 14,
      lsbNumber: 0x28,
      invert: true,
    },
    {
      match: { message: 'cc', channel: 2, number: 0x08 },
      controlType: 'absolute',
      target: { control: 'pitch', deck: 'B' },
      bits: 14,
      lsbNumber: 0x28,
      invert: true,
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
    // SHIFT layer of the jump (IN/OUT) buttons: the state-disambiguated
    // overload (midi-performance-ops 03) — loop resize while a loop runs,
    // beatjump-size when idle (its original, unchanged meaning). SHIFT is
    // hardware-layered: shifted controls emit on channel+3 (learned:
    // SHIFT+jump-back deck A = note ch 4 #9, vs ch 1 #9 unshifted).
    {
      match: { message: 'note', channel: 4, number: 0x09 },
      controlType: 'button',
      target: { control: 'loop-or-jump-size', deck: 'A', change: 'halve' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 4, number: 0x0a },
      controlType: 'button',
      target: { control: 'loop-or-jump-size', deck: 'A', change: 'double' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 5, number: 0x09 },
      controlType: 'button',
      target: { control: 'loop-or-jump-size', deck: 'B', change: 'halve' },
    },
    {
      // TODO(hardware-verify): inferred from the ch+3 shift pattern.
      match: { message: 'note', channel: 5, number: 0x0a },
      controlType: 'button',
      target: { control: 'loop-or-jump-size', deck: 'B', change: 'double' },
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

    // Grid editing on the SAMPLER pad mode (midi-performance-ops 05):
    // notes 0x30-0x37 on the pad channels, per Mixxx (hardware-verified
    // 2026-07-06).
    ...gridEditPads('A', 6),
    ...gridEditPads('B', 7),

    // Q buttons (midi-performance-ops 07): either deck's Q toggles the ONE
    // app-wide Quantize — the hardware's per-deck placement is two handles
    // on one switch, so both bind to the same deck-less target. Mixxx's
    // Inpulse 300 file puts Q at note 0x02 on the deck transport channels.
    {
      // From Mixxx's Inpulse 300 XML (Q = note 0x02); hardware-verified 2026-07-06.
      match: { message: 'note', channel: 1, number: 0x02 },
      controlType: 'button',
      target: { control: 'quantize' },
    },
    {
      // From Mixxx's Inpulse 300 XML (Q = note 0x02); hardware-verified 2026-07-06.
      match: { message: 'note', channel: 2, number: 0x02 },
      controlType: 'button',
      target: { control: 'quantize' },
    },
    // SHIFT+Q = that deck's Key Lock (time guard unshifted, pitch guard
    // shifted — one physical home). Shifted controls emit on channel+3.
    {
      // Inferred from the ch+3 shift pattern; hardware-verified 2026-07-06.
      match: { message: 'note', channel: 4, number: 0x02 },
      controlType: 'button',
      target: { control: 'key-lock', deck: 'A' },
    },
    {
      // Inferred from the ch+3 shift pattern; hardware-verified 2026-07-06.
      match: { message: 'note', channel: 5, number: 0x02 },
      controlType: 'button',
      target: { control: 'key-lock', deck: 'B' },
    },

    // Assistant button (midi-performance-ops 08): the Follow macro — all
    // on (playing Decks, or both when nothing plays) / all off.
    // Hardware-learned 2026-07-06 via the inspector: note 0x03 on the
    // browse channel (0). SHIFT+assistant not captured; unbound.
    {
      match: { message: 'note', channel: 0, number: 0x03 },
      controlType: 'button',
      target: { control: 'follow-macro' },
    },

    // LOOP pad mode (midi-performance-ops 02): size presets, engage/
    // release/resize semantics live behind the loop-preset target. Pad
    // modes are note-isolated on this device; per Mixxx's Inpulse 300 file
    // the LOOP pads emit notes 0x10-0x17 (base) / 0x18-0x1F (shifted) on
    // the same pad channels as HOTCUE mode.
    // TODO(hardware-verify): inferred from Mixxx, not yet learned on the
    // MK2 — smoke-test both pages at the next hands-on session.
    ...loopPadBindings('A', 6),
    ...loopPadBindings('B', 7),
  ],

  // LED Feedback addresses. Ground truth: Mixxx's Inpulse 300 mapping
  // (mixxxdj/mixxx res/controllers/Hercules_DJControl_Inpulse_300.midi.xml,
  // "LED Outputs" section) — PLAY LED is note 0x07 / CUE 0x06 on the deck's
  // transport channel (status 0x91/0x92), velocity 0x7f lit / 0x00 dark;
  // PFL (headphone) LED echoes its button note 0x0C on the same channels
  // (headphone-cue 05); hot cue pads are notes 0x00-0x07 on the pads'
  // HOTCUE base-layer channel (status 0x96/0x97), velocity 0x7e lit; the
  // SHIFT-layer pads are the same channels at notes 0x08-0x0F (Mixxx maps
  // both layers to the same hotcue_N_status, so shifted lights mirror the
  // base layer). LOOP-mode pad lamps echo their notes (0x10-0x17 base;
  // shifted page 0x18-0x1A + 0x1C — midi-performance-ops 02); the unbound
  // shifted pads (4, 6-8) are never written. Other pad modes are note-isolated and
  // never written. The device does not dump LED state on connect (tested);
  // full sync on connect is the app's job. TODO(hardware-verify):
  // smoke-test on the MK2, including the LOOP pad lamp addresses.
  feedback: {
    decks: {
      A: {
        play: { channel: 1, number: 0x07, onVelocity: 0x7f },
        cue: { channel: 1, number: 0x06, onVelocity: 0x7f },
        pfl: { channel: 1, number: 0x0c, onVelocity: 0x7f },
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
        // Grid-edit (SAMPLER) pad lamps echo their button notes 0x30-0x37
        // on the pad channel, like every other pad lamp on this device
        // (hardware-verified 2026-07-06).
        gridPads: Array.from({ length: 8 }, (_, i) => ({
          channel: 6,
          number: 0x30 + i,
          onVelocity: 0x7e,
        })),
        // Q lamp mirrors app-wide Quantize; the button's own note (0x02)
        // on the transport channel. Hardware-verified 2026-07-06.
        quantize: { channel: 1, number: 0x02, onVelocity: 0x7f },
        // Key Lock lamp (midi-performance-ops 07): the shifted-Q address
        // (ch+3, same note). Probe outcome: REAL — hardware-verified
        // 2026-07-06. Mixxx drives no output here, but the device does
        // light it: the Q lamp shows the deck's Key Lock while SHIFT is
        // held, Quantize unshifted (one lamp never tells two truths —
        // the layers are separate lights).
        keyLockShifted: { channel: 4, number: 0x02, onVelocity: 0x7f },
        loopPads: loopPadLamps(6, LOOP_PADS_BASE_FIRST_NOTE, LOOP_LADDER_BASE),
        loopPadsShifted: loopPadLamps(6, LOOP_PADS_SHIFTED_FIRST_NOTE, LOOP_LADDER_SHIFTED),
      },
      B: {
        play: { channel: 2, number: 0x07, onVelocity: 0x7f },
        cue: { channel: 2, number: 0x06, onVelocity: 0x7f },
        pfl: { channel: 2, number: 0x0c, onVelocity: 0x7f },
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
        // Hardware-verified 2026-07-06.
        gridPads: Array.from({ length: 8 }, (_, i) => ({
          channel: 7,
          number: 0x30 + i,
          onVelocity: 0x7e,
        })),
        // Hardware-verified 2026-07-06.
        quantize: { channel: 2, number: 0x02, onVelocity: 0x7f },
        // Same as deck A: probe REAL, hardware-verified 2026-07-06.
        keyLockShifted: { channel: 5, number: 0x02, onVelocity: 0x7f },
        loopPads: loopPadLamps(7, LOOP_PADS_BASE_FIRST_NOTE, LOOP_LADDER_BASE),
        loopPadsShifted: loopPadLamps(7, LOOP_PADS_SHIFTED_FIRST_NOTE, LOOP_LADDER_SHIFTED),
      },
    },
    // Assistant lamp (midi-performance-ops 08): lit iff any Deck follows.
    // The button's own address — lamps on this device echo their button's
    // note (PLAY/CUE/PFL all do). Hardware-verified 2026-07-06 (macro and
    // lamp both confirmed on device).
    assistant: { channel: 0, number: 0x03, onVelocity: 0x7f },
  },
};
