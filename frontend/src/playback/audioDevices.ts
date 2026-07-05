/**
 * Audio output enumeration (headphone-cue 01).
 *
 * Chrome gates device labels — and every non-default device id — behind a
 * media-capture permission grant: without one, enumerateDevices() returns
 * blank labels and only default entries, useless for a routing picker. When
 * the list looks locked we request a throwaway microphone stream once (the
 * documented unlock), stop it immediately, and re-enumerate.
 *
 * The desktop shell pre-grants "media" and "speaker-selection"
 * (desktop/main.js) so this never prompts there; a plain browser tab shows
 * one mic prompt the first time. Hands-on-verified glue (ADR 0002) — the
 * tested seam is resolveRouting (routing.ts).
 */

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

function outputsOf(devices: MediaDeviceInfo[]): AudioOutputDevice[] {
  return devices
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== '')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  const locked = (outputs: AudioOutputDevice[]) =>
    outputs.length === 0 || outputs.some((d) => d.label === '');

  const first = outputsOf(await navigator.mediaDevices.enumerateDevices());
  if (!locked(first)) return first;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    console.warn('[audioDevices] media permission denied — output list stays locked', err);
    return first;
  }
  return outputsOf(await navigator.mediaDevices.enumerateDevices());
}

/**
 * Fires on plug/unplug (and on permission changes). Returns an unsubscribe.
 */
export function onAudioDevicesChanged(listener: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', listener);
  return () => navigator.mediaDevices.removeEventListener('devicechange', listener);
}
