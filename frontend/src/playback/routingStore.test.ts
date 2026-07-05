/**
 * Routing store — sink application to THE Mixer. (The secondary-mixer
 * registry these tests originally covered — ADR 0021 — was retired by
 * ADR 0022: there is exactly one Mixer now.)
 *
 * Fakes at the true seams (ADR 0002): localStorage, mediaDevices
 * enumeration, and AudioContext construction (the channel-count probe);
 * the mixer is a recording fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeMixer() {
  const masterSinks: (string | null)[] = [];
  const cueSinks: (string | null)[] = [];
  return {
    masterSinks,
    cueSinks,
    setMasterSinkId: async (id: string | null) => void masterSinks.push(id),
    setCueSinkId: async (id: string | null) => void cueSinks.push(id),
  };
}

function stubBrowserSeams(deviceIds: string[]) {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  } as unknown as Storage);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: async () =>
        deviceIds.map((deviceId) => ({ kind: 'audiooutput', deviceId, label: deviceId })),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = { maxChannelCount: 2 };
      async setSinkId() {}
      async close() {}
    }
  );
}

async function loadStore(deviceIds: string[]) {
  vi.resetModules();
  stubBrowserSeams(deviceIds);
  return await import('./routingStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routingStore — sink application', () => {
  it('applies the resolved master and cue sinks to the Mixer', async () => {
    const store = await loadStore(['dev-speakers', 'dev-phones']);
    const primary = fakeMixer();

    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-speakers', label: 'Speakers' });
    store.setCueDevice({ deviceId: 'dev-phones', label: 'Phones' });
    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)).toBe('dev-speakers');
      expect(primary.cueSinks.at(-1)).toBe('dev-phones');
    });
  });
});
