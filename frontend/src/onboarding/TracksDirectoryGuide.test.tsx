// @vitest-environment jsdom
// Tracks directory guide (#276) at the HTTP seam: /api/config save,
// Scan task start, progress polling, summary; standalone vs sequence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { TracksDirectoryGuide } from './TracksDirectoryGuide';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Backend {
  tracksDirectory: string | null;
  statuses: unknown[];
  puts: unknown[];
  scans: number;
}

const NONE = { state: 'none', progress: null, summary: null, error: null };
const SUMMARY = {
  directory: '/music',
  files_scanned: 12,
  already_in_library: 2,
  imported: 10,
  errors: 0,
  error_messages: [],
};

function installFetch(b: Backend) {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  const config = () => ({ tracks_directory: b.tracksDirectory, export_enabled: false });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/config') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        b.puts.push(body);
        b.tracksDirectory = body.tracks_directory || null;
        return ok(config());
      }
      if (url.endsWith('/config')) return ok(config());
      if (url.endsWith('/tracks-directory/import')) {
        b.scans += 1;
        return ok({ task_id: 1 });
      }
      if (url.endsWith('/tracks-directory/status'))
        return ok(b.statuses.length > 1 ? b.statuses.shift() : b.statuses[0]);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(label));
  if (!b) throw new Error(`no button "${label}" in: ${container.textContent}`);
  return b as HTMLButtonElement;
}

function typePath(value: string) {
  const input = container.querySelector('input[aria-label="Tracks directory"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TracksDirectoryGuide', () => {
  it('saves a typed folder, scans with progress, then summarizes', async () => {
    const b: Backend = {
      tracksDirectory: null,
      statuses: [
        NONE,
        { state: 'running', progress: { phase: 'scanning', done: 5, total: 12 }, summary: null, error: null },
        { state: 'done', progress: null, summary: SUMMARY, error: null },
      ],
      puts: [],
      scans: 0,
    };
    installFetch(b);
    const onDone = vi.fn();
    act(() => root.render(<TracksDirectoryGuide onDone={onDone} onSkip={() => {}} pollMs={5} />));
    await flush();
    expect(button('Scan now').disabled).toBe(true);
    typePath('/music');
    await act(async () => button('Scan now').click());
    expect(b.puts).toEqual([{ tracks_directory: '/music' }]); // saved before scanning
    expect(b.scans).toBe(1);
    expect(container.querySelector('[data-testid=scan-progress]')).not.toBeNull();
    await flush(50);
    expect(container.querySelector('[data-testid=scan-summary]')?.textContent).toContain('Imported10');
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalled();
  });

  it('an already-set folder can be kept without scanning', async () => {
    installFetch({ tracksDirectory: '/music', statuses: [NONE], puts: [], scans: 0 });
    const onDone = vi.fn();
    act(() => root.render(<TracksDirectoryGuide onDone={onDone} onSkip={() => {}} />));
    await flush();
    act(() => button('Save without scanning').click());
    expect(onDone).toHaveBeenCalled();
  });

  it('a failed scan surfaces the error and keeps the folder editable', async () => {
    installFetch({
      tracksDirectory: '/nope',
      statuses: [NONE, { state: 'failed', progress: null, summary: null, error: 'No such folder' }],
      puts: [],
      scans: 0,
    });
    act(() => root.render(<TracksDirectoryGuide onDone={() => {}} pollMs={5} />));
    await flush();
    await act(async () => button('Scan now').click());
    await flush(30);
    expect(container.textContent).toContain('No such folder');
    expect(container.querySelector('input[aria-label="Tracks directory"]')).not.toBeNull();
    expect(() => button('Skip')).toThrow(); // standalone: no Skip
  });
});
