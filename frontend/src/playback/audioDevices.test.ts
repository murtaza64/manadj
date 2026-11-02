import { afterEach, expect, it, vi } from 'vitest';
import { listAudioOutputs, onAudioDevicesChanged } from './audioDevices';

afterEach(() => vi.unstubAllGlobals());

it('allows read-only HTTP LAN views when secure media device APIs are absent', async () => {
  vi.stubGlobal('navigator', {});
  const listener = vi.fn();
  const stop = onAudioDevicesChanged(listener);
  await expect(listAudioOutputs()).resolves.toEqual([]);
  expect(() => stop()).not.toThrow();
  expect(listener).not.toHaveBeenCalled();
});

it('unsubscribes from the same available device registry', () => {
  const devices = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('navigator', { mediaDevices: devices });
  const listener = vi.fn();
  const stop = onAudioDevicesChanged(listener);
  expect(devices.addEventListener).toHaveBeenCalledWith('devicechange', listener);
  vi.stubGlobal('navigator', {});
  stop();
  expect(devices.removeEventListener).toHaveBeenCalledWith('devicechange', listener);
});
