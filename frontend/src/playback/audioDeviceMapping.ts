import type { OutputPair } from './routing';

export interface AudioRouteDefaults {
  master: OutputPair;
  cue: OutputPair;
}

/**
 * Hardware-specific audio-interface knowledge. A Mapping may recognize a
 * device before its physical channel order has been verified; in that case
 * routes stays null and callers must require an explicit output pair.
 */
export interface AudioDeviceMapping {
  model: 'inpulse-300-mk2' | 'ddj-grv6';
  matches: readonly string[];
  routes: AudioRouteDefaults | null;
  verification: 'verified' | 'required';
}

const AUDIO_DEVICE_MAPPINGS: readonly AudioDeviceMapping[] = [
  {
    model: 'inpulse-300-mk2',
    matches: ['djcontrol inpulse 300 mk2'],
    routes: {
      master: { left: 0, right: 1 },
      cue: { left: 2, right: 3 },
    },
    verification: 'verified',
  },
  {
    model: 'ddj-grv6',
    matches: ['ddj-grv6'],
    // Physical output order remains deliberately absent until the hardware
    // walkthrough records it. MIDI documentation is not an audio authority.
    routes: null,
    verification: 'required',
  },
];

export function audioDeviceMapping(label: string): AudioDeviceMapping | null {
  const normalized = label.trim().toLowerCase();
  return (
    AUDIO_DEVICE_MAPPINGS.find((mapping) =>
      mapping.matches.some((name) => normalized.includes(name))
    ) ?? null
  );
}

/** Defaults are usable only when every mapped channel exists on this probe. */
export function verifiedRouteDefaults(
  label: string,
  maxChannelCount: number
): AudioRouteDefaults | null {
  const routes = audioDeviceMapping(label)?.routes ?? null;
  if (!routes) return null;
  const highestChannel = Math.max(routes.master.right, routes.cue.right);
  return highestChannel < maxChannelCount ? routes : null;
}
