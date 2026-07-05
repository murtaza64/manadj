/**
 * Routing store — secondary-mixer registry (headphone-cue 06 regression).
 * The Transition editor's private Mixer must receive the routed MASTER
 * sink (it played to the system default — "editor comes out of the
 * headphones"). Cue stays exclusive to the primary mixer.
 *
 * Fakes at the true seams (ADR 0002): localStorage, mediaDevices
 * enumeration, and AudioContext construction (the channel-count probe);
 * mixers are DeckAudioPort-style recording fakes.
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

describe('routingStore — secondary mixers (headphone-cue 06)', () => {
  it('applies the resolved master sink to registered secondary mixers, never the cue sink', async () => {
    const store = await loadStore(['dev-speakers', 'dev-phones']);
    const primary = fakeMixer();
    const secondary = fakeMixer();

    store.initAudioRouting(primary as never);
    store.registerRoutedMixer(secondary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-speakers', label: 'Speakers' });
    store.setCueDevice({ deviceId: 'dev-phones', label: 'Phones' });
    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)).toBe('dev-speakers');
      expect(primary.cueSinks.at(-1)).toBe('dev-phones');
    });

    // The regression: the secondary mixer must follow the master device…
    await vi.waitFor(() => {
      expect(secondary.masterSinks.at(-1)).toBe('dev-speakers');
    });
    // …and must never be given the cue sink (no second cue bridge).
    expect(secondary.cueSinks).toEqual([]);
  });

  it('applies the current master sink immediately on late registration', async () => {
    const store = await loadStore(['dev-speakers']);
    const primary = fakeMixer();
    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-speakers', label: 'Speakers' });
    await vi.waitFor(() => expect(primary.masterSinks.at(-1)).toBe('dev-speakers'));

    const late = fakeMixer();
    store.registerRoutedMixer(late as never);
    await vi.waitFor(() => expect(late.masterSinks.at(-1)).toBe('dev-speakers'));
  });

  it('unregistering stops further applications', async () => {
    const store = await loadStore(['dev-speakers', 'dev-other']);
    const primary = fakeMixer();
    const secondary = fakeMixer();
    store.initAudioRouting(primary as never);
    const unregister = store.registerRoutedMixer(secondary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-speakers', label: 'Speakers' });
    await vi.waitFor(() => expect(secondary.masterSinks.at(-1)).toBe('dev-speakers'));

    unregister();
    store.setMasterDevice({ deviceId: 'dev-other', label: 'Other' });
    await vi.waitFor(() => expect(primary.masterSinks.at(-1)).toBe('dev-other'));
    expect(secondary.masterSinks.at(-1)).toBe('dev-speakers');
  });
});
