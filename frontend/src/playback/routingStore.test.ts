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

function fakeMixer(fail: { master?: string; cue?: string } = {}) {
  const masterSinks: { id: string | null; pair: { left: number; right: number } | null }[] = [];
  const cueSinks: { id: string | null; pair: { left: number; right: number } | null }[] = [];
  return {
    masterSinks,
    cueSinks,
    setMasterSinkId: async (id: string | null, pair: { left: number; right: number } | null = null) => {
      masterSinks.push({ id, pair });
      if (id === fail.master) throw new Error('master failed');
    },
    setCueSinkId: async (id: string | null, pair: { left: number; right: number } | null = null) => {
      cueSinks.push({ id, pair });
      if (id === fail.cue) throw new Error('cue failed');
    },
  };
}

function stubBrowserSeams(initialDeviceIds: string[]) {
  const storage = new Map<string, string>();
  let deviceIds = initialDeviceIds;
  let deviceChange: (() => void) | null = null;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  } as unknown as Storage);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: async () =>
        deviceIds.map((deviceId) => ({ kind: 'audiooutput', deviceId, label: deviceId })),
      addEventListener: (_event: string, listener: () => void) => {
        deviceChange = listener;
      },
      removeEventListener: (_event: string, listener: () => void) => {
        if (deviceChange === listener) deviceChange = null;
      },
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
  return {
    setDeviceIds(next: string[]) {
      deviceIds = next;
    },
    fireDeviceChange() {
      deviceChange?.();
    },
  };
}

async function loadStore(deviceIds: string[]) {
  vi.resetModules();
  const browser = stubBrowserSeams(deviceIds);
  return { store: await import('./routingStore'), browser };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('routingStore — sink application', () => {
  it('applies the resolved master and cue sinks to the Mixer', async () => {
    const { store } = await loadStore(['dev-speakers', 'dev-phones']);
    const primary = fakeMixer();

    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-speakers', label: 'Speakers' });
    store.setCueDevice({ deviceId: 'dev-phones', label: 'Phones' });
    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)).toEqual({ id: 'dev-speakers', pair: null });
      expect(primary.cueSinks.at(-1)).toEqual({ id: 'dev-phones', pair: null });
    });
  });

  it('applies selected output pairs to both master and cue', async () => {
    const { store } = await loadStore(['dev-inpulse']);
    const primary = fakeMixer();

    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'dev-inpulse', label: 'Inpulse (outs 1/2)', pair: { left: 0, right: 1 } });
    store.setCueDevice({ deviceId: 'dev-inpulse', label: 'Inpulse (outs 3/4)', pair: { left: 2, right: 3 } });
    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)).toEqual({ id: 'dev-inpulse', pair: { left: 0, right: 1 } });
      expect(primary.cueSinks.at(-1)).toEqual({ id: 'dev-inpulse', pair: { left: 2, right: 3 } });
    });
  });

  it('falls Master back independently and still applies Cue when the Master sink fails', async () => {
    const { store } = await loadStore(['broken-master', 'working-cue']);
    const primary = fakeMixer({ master: 'broken-master' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'broken-master', label: 'Broken' });
    store.setCueDevice({ deviceId: 'working-cue', label: 'Cue' });

    await vi.waitFor(() => {
      expect(primary.masterSinks).toContainEqual({ id: null, pair: null });
      expect(primary.cueSinks.at(-1)).toEqual({ id: 'working-cue', pair: null });
    });
  });

  it('disables a failed Cue route without changing the resolved Master route', async () => {
    const { store } = await loadStore(['working-master', 'broken-cue']);
    const primary = fakeMixer({ cue: 'broken-cue' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'working-master', label: 'Master' });
    store.setCueDevice({ deviceId: 'broken-cue', label: 'Cue' });

    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)).toEqual({ id: 'working-master', pair: null });
      expect(primary.cueSinks.at(-1)).toEqual({ id: 'broken-cue', pair: null });
    });
    expect(primary.masterSinks.filter(({ id }) => id === null)).toHaveLength(1);
  });

  it('disables only Cue on unplug and restores its saved route on replug', async () => {
    const { store, browser } = await loadStore(['master', 'cue']);
    const primary = fakeMixer();
    store.initAudioRouting(primary as never);
    await store.refreshRouting();
    store.setMasterDevice({ deviceId: 'master', label: 'Master' });
    store.setCueDevice({ deviceId: 'cue', label: 'Cue' });
    await vi.waitFor(() => expect(primary.cueSinks.at(-1)?.id).toBe('cue'));

    browser.setDeviceIds(['master']);
    browser.fireDeviceChange();
    await vi.waitFor(() => {
      expect(primary.masterSinks.at(-1)?.id).toBe('master');
      expect(primary.cueSinks.at(-1)?.id).toBeNull();
    });

    browser.setDeviceIds(['master', 'cue']);
    browser.fireDeviceChange();
    await vi.waitFor(() => expect(primary.cueSinks.at(-1)?.id).toBe('cue'));
  });
});
