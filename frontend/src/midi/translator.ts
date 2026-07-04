import type { MidiAction } from './actions';
import type { Mapping } from './mapping';

/**
 * The tested seam (PRD testing decisions, ADR 0002): raw MIDI messages +
 * a Mapping in, domain actions out. Pure — no Web MIDI, no engine. The
 * adapter folds decoder state per port; tests fold it over synthetic
 * message arrays.
 *
 * This slice decodes buttons only: note on/off → down/up edges, binding
 * resolution (channel + message type + number), unmapped-message silence.
 * Later slices add 7/14-bit absolute assembly, relative tick decoding, and
 * modifier layers — DecoderState and the return shape are already threaded
 * so those land without reshaping this signature.
 */

export interface DecoderState {
  /**
   * Buttons currently held, keyed by channel:number. Dedupes repeated
   * note-ons (hardware key repeat) and swallows stray note-offs (e.g. a
   * release arriving on a fresh state after replug).
   */
  readonly heldButtons: ReadonlySet<string>;
  // Later slices: pending 14-bit MSBs, active named modifiers.
}

export function initialDecoderState(): DecoderState {
  return { heldButtons: new Set() };
}

export interface TranslateResult {
  actions: readonly MidiAction[];
  state: DecoderState;
}

// Status-byte high nibbles.
const NOTE_OFF = 0x8;
const NOTE_ON = 0x9;
const CONTROL_CHANGE = 0xb;

function buttonKey(channel: number, number: number): string {
  return `${channel}:${number}`;
}

export function translateMidiMessage(
  data: Uint8Array | readonly number[],
  state: DecoderState,
  mapping: Mapping
): TranslateResult {
  const silence: TranslateResult = { actions: [], state };
  if (data.length < 3) return silence;

  const status = data[0];
  const number = data[1];
  const value = data[2];
  const kind = status >> 4;
  const channel = status & 0x0f;

  const messageType =
    kind === NOTE_ON || kind === NOTE_OFF ? 'note' : kind === CONTROL_CHANGE ? 'cc' : null;
  if (messageType === null) return silence;

  const binding = mapping.bindings.find(
    (b) =>
      b.match.message === messageType &&
      b.match.channel === channel &&
      b.match.number === number &&
      // Modifier layers land in a later slice; gated bindings never fire yet.
      b.modifier === undefined
  );
  if (!binding) return silence;

  switch (binding.controlType) {
    case 'button': {
      // Buttons arrive as notes on this hardware; a CC-driven button would
      // be a later decoder, not a mapping change.
      if (messageType !== 'note') return silence;
      // Note-on with velocity 0 is note-off by MIDI convention.
      const isDown = kind === NOTE_ON && value > 0;
      const key = buttonKey(channel, number);
      if (isDown === state.heldButtons.has(key)) return silence;
      const heldButtons = new Set(state.heldButtons);
      if (isDown) heldButtons.add(key);
      else heldButtons.delete(key);
      return {
        actions: [{ kind: 'button', target: binding.target, edge: isDown ? 'down' : 'up' }],
        state: { heldButtons },
      };
    }
    // Decoders for these land in later slices; bound-but-undecoded is
    // silent, same as unmapped.
    case 'absolute':
    case 'relative':
      return silence;
  }
}
