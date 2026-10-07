/**
 * Controller check guide — pure seams (tested): which shipped Mapping a MIDI
 * port belongs to, which binding a raw message hits ("press anything"), and
 * whether the model has a tunable jog calibration.
 */
import type { Binding, Mapping } from '../../midi/mapping';
import type { JogProfile } from '../../midi/jogCalibration';
import type { ControllerModel } from '../../midi/mappings';

export function modelForPort(
  portName: string,
  models: readonly ControllerModel[]
): ControllerModel | null {
  return models.find((m) => portName.includes(m.mapping.portNameMatch)) ?? null;
}

export interface DecodedMessage {
  message: 'note' | 'cc';
  channel: number;
  number: number;
  value: number;
}

/** Note on/off and CC only; everything else (clock, sysex, ...) is null. */
export function decodeMessage(bytes: ArrayLike<number>): DecodedMessage | null {
  if (bytes.length < 3) return null;
  const kind = bytes[0] >> 4;
  const channel = bytes[0] & 0x0f;
  if (kind === 0x8) return { message: 'note', channel, number: bytes[1], value: 0 };
  if (kind === 0x9) return { message: 'note', channel, number: bytes[1], value: bytes[2] };
  if (kind === 0xb) return { message: 'cc', channel, number: bytes[1], value: bytes[2] };
  return null;
}

/** The binding a message drives (a 14-bit LSB counts as its binding). */
export function bindingForMessage(mapping: Mapping, msg: DecodedMessage): Binding | null {
  return (
    mapping.bindings.find(
      (b) =>
        b.match.message === msg.message &&
        b.match.channel === msg.channel &&
        (b.match.number === msg.number ||
          (b.controlType === 'absolute' && b.lsbNumber === msg.number))
    ) ?? null
  );
}

/** Stable identity of a binding, for "controls confirmed" counting. */
export function bindingKey(b: Binding): string {
  return `${b.match.message}:${b.match.channel}:${b.match.number}`;
}

const words = (s: string) => s.replace(/-/g, ' ');

/** Human label for a binding's target, e.g. "Deck A · hot cue 3". */
export function describeBinding(b: Binding): string {
  const t = b.target as Record<string, unknown> & { control: string };
  const head = 'deck' in t ? `Deck ${t.deck}` : 'channel' in t ? `Channel ${t.channel}` : null;
  const extras = Object.entries(t)
    .filter(([k, v]) => !['control', 'deck', 'channel', 'layered'].includes(k) && v !== false)
    .map(([k, v]) => (v === true ? words(k) : words(String(v))));
  const body = [words(t.control), ...extras].join(' ');
  return head ? `${head} · ${body}` : body;
}

/** Jog profile a Mapping's bindings carry, if any. */
export function jogProfileOf(mapping: Mapping): JogProfile | null {
  for (const b of mapping.bindings) {
    if (b.controlType === 'relative' && b.jogProfile) return b.jogProfile;
  }
  return null;
}

/** Distinct physical controls in a Mapping. */
export function bindingCount(mapping: Mapping): number {
  return new Set(mapping.bindings.map(bindingKey)).size;
}
