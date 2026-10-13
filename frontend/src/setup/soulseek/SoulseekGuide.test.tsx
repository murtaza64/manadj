// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SoulseekStatus } from './soulseekApi';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  restart: vi.fn(),
}));
vi.mock('./soulseekApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./soulseekApi')>()),
  soulseekApi: api,
}));
vi.mock('../../api/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));

import SoulseekGuide from './SoulseekGuide';
import { getGuide, guideStatus } from '../guides';
import SoulseekSettings from './SoulseekSettings';
import { SOULSEEK_GUIDE_ID } from './register';

const licence = { name: 'slskd', version: '0.26.0', license: 'AGPL-3.0', source_url: 'https://github.com/slskd/slskd/tree/0.26.0' };

function status(over: Partial<SoulseekStatus> = {}): SoulseekStatus {
  return {
    mode: 'unconfigured', binary_available: true, username: null, process: null,
    server: null, issue: null, web_url: null, licence, ...over,
  };
}
const managed = (over: Partial<SoulseekStatus> = {}) =>
  status({ mode: 'managed', username: 'alice', process: 'running', web_url: 'http://127.0.0.1:5130', ...over });
const server = (logged_in: boolean, connecting = false) => ({ connected: logged_in, logged_in, connecting, state: '' });

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.values(api).forEach((fn) => fn.mockReset());
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function render(props = { onDone: vi.fn(), onSkip: vi.fn() }) {
  act(() => root.render(<SoulseekGuide {...props} />));
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

it('registers as the order-50 guide, not started by default', () => {
  const guide = getGuide(SOULSEEK_GUIDE_ID);
  expect(guide?.order).toBe(50);
  expect(guide?.status()).toBe('not-started');
});

it('connects: credentials -> logging in -> connected enables Done', async () => {
  api.status.mockResolvedValueOnce(status());
  const props = await render();
  expect(button('Done').disabled).toBe(true);
  expect(host.textContent).toContain('AGPL-3.0');

  const [user, pass] = host.querySelectorAll('input');
  type(user as HTMLInputElement, 'alice');
  type(pass as HTMLInputElement, 'pw');
  api.connect.mockResolvedValueOnce(managed({ process: 'starting' }));
  await act(async () => button('Connect').click());
  await flush();
  expect(api.connect).toHaveBeenCalledWith('alice', 'pw');
  expect(host.textContent).toContain('Starting slskd');

  api.status.mockResolvedValueOnce(managed({ server: server(false, true) }));
  await act(async () => vi.advanceTimersByTime(1000));
  await flush();
  expect(host.textContent).toContain('Logging in to Soulseek as alice');

  api.status.mockResolvedValueOnce(managed({ server: server(true) }));
  await act(async () => vi.advanceTimersByTime(1000));
  await flush();
  expect(host.textContent).toContain('Connected to Soulseek as alice');
  expect(button('Done').disabled).toBe(false);
  act(() => button('Done').click());
  expect(props.onDone).toHaveBeenCalled();
});

it('surfaces a login failure with slskd\'s message and offers re-entry', async () => {
  api.status.mockResolvedValueOnce(managed({ server: server(false), issue: 'Failed to log in: INVALIDPASS' }));
  await render();
  expect(host.textContent).toContain("Couldn't log in as alice. slskd says: Failed to log in: INVALIDPASS");
  act(() => button('Re-enter account').click());
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('alice');
});

it('external slskd: nothing to set up, Done allowed', async () => {
  api.status.mockResolvedValueOnce(status({ mode: 'external', web_url: 'http://localhost:5030' }));
  await render();
  expect(host.textContent).toContain('Using your own slskd at http://localhost:5030');
  expect(host.querySelector('input')).toBeNull();
  expect(button('Done').disabled).toBe(false);
});

it('binary missing: explains, no form', async () => {
  api.status.mockResolvedValueOnce(status({ binary_available: false }));
  await render();
  expect(host.textContent).toContain("slskd isn't included in this build");
  expect(host.querySelector('input')).toBeNull();
});

it('standalone Settings host persists skip', async () => {
  api.status.mockResolvedValue(status());
  act(() => root.render(<SoulseekSettings />));
  await flush();
  await act(async () => vi.advanceTimersByTime(0));
  await flush();
  expect(host.textContent).toContain('Guide status: Not started');
  act(() => button('Skip').click());
  expect(guideStatus(SOULSEEK_GUIDE_ID)).toBe('skipped');
  expect(host.textContent).toContain('Guide status: Skipped');
});
