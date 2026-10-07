// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SoundCloudStatus } from './soundcloudApi';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ status: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('./soundcloudApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./soundcloudApi')>()),
  soundcloudApi: api,
}));
const qc = vi.hoisted(() => ({ setQueryData: vi.fn() }));
vi.mock('../../api/queryClient', () => ({ queryClient: qc }));

import SoundCloudGuide from './SoundCloudGuide';
import SoundCloudSettings from './SoundCloudSettings';
import { getGuide, guideStatus } from '../guides';
import { SOUNDCLOUD_GUIDE_ID } from './register';

const disconnected: SoundCloudStatus = { connected: false, token_source: null, account: null, error: null };
const connected = (source: SoundCloudStatus['token_source'] = 'secrets'): SoundCloudStatus => ({
  connected: true, token_source: source, account: { username: 'djalice', likes_count: 1234 }, error: null,
});

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
  act(() => root.render(<SoundCloudGuide {...props} />));
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

it('registers as the order-40 guide', () => {
  expect(getGuide(SOUNDCLOUD_GUIDE_ID)?.order).toBe(40);
  expect(getGuide(SOUNDCLOUD_GUIDE_ID)?.status()).toBe('not-started');
});

it('paste token -> validated account shown, status cached for the Acquisition gate, Done enabled', async () => {
  api.status.mockResolvedValueOnce(disconnected);
  const props = await render();
  expect(host.textContent).toContain('oauth_token');
  expect(host.querySelector('.sc-shot-hit')).not.toBeNull();
  expect(button('Done').disabled).toBe(true);

  type(host.querySelector('input[aria-label="oauth_token"]') as HTMLInputElement, ' 2-abc ');
  api.connect.mockResolvedValueOnce(connected());
  await act(async () => button('Connect').click());
  await flush();
  expect(api.connect).toHaveBeenCalledWith('2-abc');
  expect(host.textContent).toContain('Connected as djalice · 1,234 likes.');
  expect(qc.setQueryData).toHaveBeenCalledWith(['soundcloudStatus'], connected());
  expect(host.querySelector('.sc-steps')).toBeNull();
  act(() => button('Done').click());
  expect(props.onDone).toHaveBeenCalled();
});

it('rejected token keeps the steps and shows the reason', async () => {
  api.status.mockResolvedValueOnce(disconnected);
  await render();
  type(host.querySelector('input[aria-label="oauth_token"]') as HTMLInputElement, 'nope');
  api.connect.mockRejectedValueOnce(new Error('SoundCloud rejected the token (HTTP 401)'));
  await act(async () => button('Connect').click());
  await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('rejected the token');
  expect(host.querySelector('.sc-steps')).not.toBeNull();
});

it('expired stored token: error plus the steps to paste a fresh one', async () => {
  api.status.mockResolvedValueOnce({ ...disconnected, token_source: 'secrets', error: 'The token may have expired' });
  await render();
  expect(host.textContent).toContain('The token may have expired');
  expect(host.querySelector('input[aria-label="oauth_token"]')).not.toBeNull();
});

it('token from the process environment: read-only, no Disconnect', async () => {
  api.status.mockResolvedValueOnce(connected('env'));
  await render();
  expect(host.textContent).toContain("Using the token from manaDJ's environment");
  expect(button('Disconnect')).toBeUndefined();
});

it('standalone Settings host persists skip', async () => {
  api.status.mockResolvedValue(disconnected);
  act(() => root.render(<SoundCloudSettings />));
  await flush();
  act(() => button('Skip').click());
  expect(guideStatus(SOUNDCLOUD_GUIDE_ID)).toBe('skipped');
  expect(host.textContent).toContain('Guide status: Skipped');
});
