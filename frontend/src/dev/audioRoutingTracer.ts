/**
 * Dev-only console tracer (headphone-cue 01): proves device enumeration,
 * master sink switching, and the ADR 0017 MediaStream bridge end-to-end
 * before the Mixer grows a real Cue bus. No product UI — drive it from the
 * devtools console:
 *
 *   __routing.devices()            // list outputs (unlocks labels if needed)
 *   __routing.setMaster('inpulse') // master follows a sink change, live
 *   __routing.setMaster(null)      // back to the system default
 *   __routing.startCue('external') // 440 Hz test tone on a second device
 *   __routing.stopCue()
 *   __routing.setCue('inpulse')    // route the REAL Cue bus (PFL taps,
 *   __routing.setCue(null)         // headphone-cue 02) / disable it
 *
 * Device queries match by exact id or case-insensitive label substring.
 * Loaded lazily in dev only (DeckContext); never in the production bundle.
 */
import { listAudioOutputs } from '../playback/audioDevices';
import type { AudioOutputDevice } from '../playback/audioDevices';
import { CueBridge } from '../playback/cueBridge';
import type { Mixer } from '../playback/mixer';

const TONE_HZ = 440;
const TONE_GAIN = 0.1;

interface AudioRoutingTracer {
  devices(): Promise<AudioOutputDevice[]>;
  setMaster(query: string | null): Promise<void>;
  setCue(query: string | null): Promise<void>;
  startCue(query: string): Promise<void>;
  stopCue(): void;
}

declare global {
  interface Window {
    __routing?: AudioRoutingTracer;
  }
}

async function findOutput(query: string): Promise<AudioOutputDevice> {
  const devices = await listAudioOutputs();
  const device =
    devices.find((d) => d.deviceId === query) ??
    devices.find((d) => d.label.toLowerCase().includes(query.toLowerCase()));
  if (!device) {
    throw new Error(
      `no audio output matching "${query}" — have: ${devices.map((d) => d.label).join(', ')}`
    );
  }
  return device;
}

export function installAudioRoutingTracer(mixer: Mixer): void {
  let bridge: CueBridge | null = null;
  let tone: OscillatorNode | null = null;

  // portFor().ensureAudio() is the sanctioned way to reach the live context
  // (what a deck does); the tracer plays a deck-like role.
  const mainCtx = () => mixer.portFor('A').ensureAudio().ctx;

  window.__routing = {
    devices: async () => {
      const devices = await listAudioOutputs();
      console.table(devices);
      return devices;
    },

    setMaster: async (query) => {
      if (query === null) {
        await mixer.setMasterSinkId(null);
        console.log('[routing] master → system default');
        return;
      }
      const device = await findOutput(query);
      await mixer.setMasterSinkId(device.deviceId);
      console.log(`[routing] master → ${device.label}`);
    },

    setCue: async (query) => {
      if (query === null) {
        await mixer.setCueSinkId(null);
        console.log('[routing] cue bus disabled');
        return;
      }
      const device = await findOutput(query);
      await mixer.setCueSinkId(device.deviceId);
      console.log(`[routing] cue bus → ${device.label}`);
    },

    startCue: async (query) => {
      const device = await findOutput(query);
      const ctx = mainCtx();
      if (!bridge) bridge = new CueBridge(ctx);
      if (!tone) {
        tone = ctx.createOscillator();
        tone.frequency.value = TONE_HZ;
        const gain = ctx.createGain();
        gain.gain.value = TONE_GAIN;
        tone.connect(gain);
        gain.connect(bridge.input);
        tone.start();
      }
      await bridge.setSink(device.deviceId);
      console.log(
        `[routing] cue test tone → ${device.label}`,
        'main:',
        { baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency },
        'cue:',
        bridge.latencyInfo()
      );
    },

    stopCue: () => {
      tone?.stop();
      tone?.disconnect();
      tone = null;
      bridge?.stop();
      console.log('[routing] cue bridge stopped');
    },
  };

  console.log('[routing] tracer installed — try __routing.devices()');
}
