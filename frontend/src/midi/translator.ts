import type { MidiAction } from './actions';
import type { Mapping } from './mapping';

/**
 * The tested seam (PRD testing decisions, ADR 0002): raw MIDI messages +
 * a Mapping in, domain actions out. Pure — no Web MIDI, no engine. The
 * adapter folds decoder state per port; tests fold it over synthetic
 * message arrays.
 *
 * Decoders: buttons (note on/off → down/up edges, binding resolution,
 * unmapped-message silence) and absolutes (7-bit CC, 14-bit MSB/LSB
 * assembly). Relative tick decoding lands in the jog slice. No modifier
 * layer: SHIFT is hardware-layered on this device (shifted controls emit
 * distinct messages), so shifted functions are ordinary bindings.
 */

export interface DecoderState {
  /**
   * Buttons currently held, keyed by channel:number. Dedupes repeated
   * note-ons (hardware key repeat) and swallows stray note-offs (e.g. a
   * release arriving on a fresh state after replug).
   */
  readonly heldButtons: ReadonlySet<string>;
  /**
   * Last seen MSB per 14-bit absolute control, keyed channel:msbNumber.
   * The action emits on the LSB (the Inpulse sends MSB,LSB pairs per move);
   * the MSB persists so LSB-only refinements keep working.
   */
  readonly pendingMsb: ReadonlyMap<string, number>;
}

export function initialDecoderState(): DecoderState {
  return { heldButtons: new Set(), pendingMsb: new Map() };
}

export interface TranslateResult {
  actions: readonly MidiAction[];
  state: DecoderState;
}

// Status-byte high nibbles.
const NOTE_OFF = 0x8;
const NOTE_ON = 0x9;
const CONTROL_CHANGE = 0xb;

const FULL_14_BIT = 0x3fff; // (127 << 7) | 127

/** State key for a physical control: channel + primary (MSB/note) number. */
function controlKey(channel: number, number: number): string {
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

  const binding = mapping.bindings.find((b) => {
    if (b.match.message !== messageType || b.match.channel !== channel) return false;
    if (b.match.number === number) return true;
    // A 14-bit absolute binding also owns its LSB CC number.
    return (
      messageType === 'cc' &&
      b.controlType === 'absolute' &&
      b.bits === 14 &&
      b.lsbNumber === number
    );
  });
  if (!binding) return silence;

  switch (binding.controlType) {
    case 'button': {
      // Buttons arrive as notes on this hardware; a CC-driven button would
      // be a later decoder, not a mapping change.
      if (messageType !== 'note') return silence;
      // Note-on with velocity 0 is note-off by MIDI convention.
      const isDown = kind === NOTE_ON && value > 0;
      const key = controlKey(channel, number);
      if (isDown === state.heldButtons.has(key)) return silence;
      const heldButtons = new Set(state.heldButtons);
      if (isDown) heldButtons.add(key);
      else heldButtons.delete(key);
      return {
        actions: [{ kind: 'button', target: binding.target, edge: isDown ? 'down' : 'up' }],
        state: { ...state, heldButtons },
      };
    }
    case 'absolute': {
      if (messageType !== 'cc') return silence;
      if (binding.bits === 7) {
        return {
          actions: [{ kind: 'absolute', target: binding.target, value: value / 127 }],
          state,
        };
      }
      const msbKey = controlKey(channel, binding.match.number);
      if (number === binding.match.number) {
        // MSB half: remember it, emit nothing until the LSB lands.
        const pendingMsb = new Map(state.pendingMsb);
        pendingMsb.set(msbKey, value);
        return { actions: [], state: { ...state, pendingMsb } };
      }
      const msb = state.pendingMsb.get(msbKey);
      if (msb === undefined) return silence; // LSB before any MSB: drop
      return {
        actions: [
          {
            kind: 'absolute',
            target: binding.target,
            value: ((msb << 7) | value) / FULL_14_BIT,
          },
        ],
        state,
      };
    }
    // Relative tick decoding lands in the jog slice; bound-but-undecoded
    // is silent, same as unmapped.
    case 'relative':
      return silence;
  }
}
