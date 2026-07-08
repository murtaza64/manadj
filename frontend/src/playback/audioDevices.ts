/**
 * Audio output enumeration (headphone-cue 01).
 *
 * Chrome gates device labels — and every non-default device id — behind a
 * media-capture permission grant: without one, enumerateDevices() returns
 * blank labels and only default entries, useless for a routing picker. When
 * the list looks locked we request a throwaway microphone stream once (the
 * documented unlock), stop it immediately, and re-enumerate.
 *
 * Channel counts: enumerateDevices() says nothing about output channels,
 * but the CUE picker splits multichannel interfaces into stereo pairs
 * (explicit-output-pairs follow-up), so each device is probed once — open
 * a context, apply the sink, read destination.maxChannelCount, close — and
 * cached for the session. Probes that fail or stall report stereo.
 *
 * The desktop shell pre-grants "media" and "speaker-selection"
 * (desktop/main.js) so this never prompts there; a plain browser tab shows
 * one mic prompt the first time. Hands-on-verified glue (ADR 0002) — the
 * tested seams are routing.ts's resolveRouting/outputPairOptions.
 */

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  /** Output channels the device exposes (probed; stereo when unknown). */
  maxChannelCount: number;
}

const PROBE_TIMEOUT_MS = 2000;
const channelCountCache = new Map<string, number>();

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function probeMaxChannelCount(deviceId: string): Promise<number> {
  const cached = channelCountCache.get(deviceId);
  if (cached !== undefined) return cached;
  const ctx = new AudioContext();
  try {
    const count = await withTimeout(
      ctx.setSinkId(deviceId).then(() => ctx.destination.maxChannelCount),
      PROBE_TIMEOUT_MS,
      2
    );
    channelCountCache.set(deviceId, count);
    return count;
  } catch {
    return 2; // vanished mid-probe or unsupported: treat as plain stereo
  } finally {
    void ctx.close();
  }
}

async function outputsOf(devices: MediaDeviceInfo[]): Promise<AudioOutputDevice[]> {
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== '');
  const result: AudioOutputDevice[] = [];
  // Sequential on purpose: one probe context at a time.
  for (const d of outputs) {
    result.push({
      deviceId: d.deviceId,
      label: d.label,
      maxChannelCount: await probeMaxChannelCount(d.deviceId),
    });
  }
  return result;
}

export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  const locked = (devices: MediaDeviceInfo[]) => {
    const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== '');
    return outputs.length === 0 || outputs.some((d) => d.label === '');
  };

  const first = await navigator.mediaDevices.enumerateDevices();
  if (!locked(first)) return outputsOf(first);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    console.warn('[audioDevices] media permission denied — output list stays locked', err);
    return outputsOf(first);
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
