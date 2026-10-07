// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpotifyStatus } from './spotifyApi';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  status: vi.fn(),
  setClientId: vi.fn(),
  forgetClient: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('./spotifyApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spotifyApi')>()),
  spotifyApi: api,
}));
const qc = vi.hoisted(() => ({ setQueryData: vi.fn() }));
vi.mock('../../api/queryClient', () => ({ queryClient: qc }));

import SpotifyGuide from './SpotifyGuide';
import SpotifySettings from './SpotifySettings';
import { getGuide, guideStatus } from '../guides';
import { SPOTIFY_GUIDE_ID } from './register';

const base: SpotifyStatus = {
  state: 'no_client',
  client_id: null,
  redirect_uri: 'http://127.0.0.1/api/spotify/callback',
  redirect_uri_exact: 'http://127.0.0.1:8127/api/spotify/callback',
  scopes: ['user-library-read'],
  account: null,
  error: null,
};
const disconnected: SpotifyStatus = { ...base, state: 'disconnected', client_id: 'abc123' };
const connected: SpotifyStatus = {
  ...disconnected,
  state: 'connected',
  account: { id: 'dj1', display_name: 'DJ One' },
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
  qc.setQueryData.mockReset();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function render() {
  const props = { onDone: vi.fn(), onSkip: vi.fn() };
  act(() => root.render(<SpotifyGuide {...props} />));
  await flush();
  return props;
}
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('registers as the order-45 guide', () => {
  expect(getGuide(SPOTIFY_GUIDE_ID)?.order).toBe(45);
  expect(getGuide(SPOTIFY_GUIDE_ID)?.status()).toBe('not-started');
});

it('walks app creation: redirect URI shown, Client ID saved, Connect opens sign-in and polls', async () => {
  api.status.mockResolvedValueOnce(base);
  const props = await render();
  expect(host.querySelector('[aria-label="Redirect URI"]')?.textContent).toBe(
    'http://127.0.0.1/api/spotify/callback',
  );
  expect(host.textContent).toContain('Web API');
  expect(button('Connect').disabled).toBe(true);
  expect(button('Done').disabled).toBe(true);

  type(host.querySelector('input[aria-label="Client ID"]') as HTMLInputElement, ' abc123 ');
  api.setClientId.mockResolvedValueOnce(disconnected);
  await act(async () => button('Save').click());
  await flush();
  expect(api.setClientId).toHaveBeenCalledWith('abc123');
  expect(button('Connect').disabled).toBe(false);

  vi.useFakeTimers();
  const open = vi.fn();
  vi.stubGlobal('open', open);
  api.connect.mockResolvedValueOnce({ authorize_url: 'https://accounts.spotify.com/authorize?x', redirect_uri: '' });
  await act(async () => button('Connect').click());
  await flush();
  expect(open).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?x', '_blank');
  expect(host.textContent).toContain('Waiting for Spotify sign-in');

  api.status.mockResolvedValue(connected);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await flush();
  expect(host.textContent).toContain('Connected as DJ One.');
  expect(qc.setQueryData).toHaveBeenCalledWith(['spotifyStatus'], connected);
  act(() => button('Done').click());
  expect(props.onDone).toHaveBeenCalled();
});

it('reconnect state shows the reason and a Reconnect button', async () => {
  api.status.mockResolvedValueOnce({ ...disconnected, state: 'reconnect', error: 'Spotify no longer accepts' });
  await render();
  expect(host.textContent).toContain('Spotify no longer accepts');
  expect(button('Reconnect')).toBeDefined();
  expect(host.querySelector('.sc-steps')).toBeNull();
});

it('standalone Settings host persists skip', async () => {
  api.status.mockResolvedValue(base);
  act(() => root.render(<SpotifySettings />));
  await flush();
  act(() => button('Skip').click());
  expect(guideStatus(SPOTIFY_GUIDE_ID)).toBe('skipped');
  expect(host.textContent).toContain('Guide status: Skipped');
});
