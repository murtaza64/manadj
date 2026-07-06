// @vitest-environment jsdom
// Needs-attention worklist (ADR 0024, native-analysis-accuracy 12) at the
// view seam: the row badge renders exactly when the server flags the track,
// and the library query asks the backend for the worklist view.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import TrackRow from './TrackRow';
import type { Track } from '../types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    filename: '/tracks/test.mp3',
    title: 'Test Track',
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    tags: [],
    ...overrides,
  } as Track;
}

const noop = () => {};

function renderRow(track: Track): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);
  const root = createRoot(tbody);
  act(() => {
    root.render(
      <TrackRow
        track={track}
        isSelected={false}
        isLoaded={false}
        onSelect={noop}
        onLoad={noop}
        getDragIds={() => [track.id]}
      />
    );
  });
  return { container, root };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
});

describe('needs-attention badge', () => {
  it('renders on a flagged track with the bail explanation', () => {
    const { container, root } = renderRow(makeTrack({ needs_attention: true }));
    cleanup.push(() => act(() => root.unmount()));

    const badge = container.querySelector('.needs-attention-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('!');
    expect(badge!.getAttribute('title')).toMatch(/bailed/i);
  });

  it('is absent when the track is not flagged (or the field is missing)', () => {
    for (const track of [makeTrack({ needs_attention: false }), makeTrack()]) {
      const { container, root } = renderRow(track);
      cleanup.push(() => act(() => root.unmount()));
      expect(container.querySelector('.needs-attention-badge')).toBeNull();
    }
  });
});

describe('worklist view wiring', () => {
  it('the library request carries needs_attention only for the worklist view', async () => {
    const { api } = await import('../api/client');
    const calls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({ items: [], total: 0, library_total: 0, page: 1, per_page: 1000, total_pages: 0 }),
      } as Response;
    }) as typeof fetch;

    await api.tracks.list(1, 1000, { needsAttention: true });
    await api.tracks.list(1, 1000, {});

    expect(calls[0]).toContain('needs_attention=true');
    expect(calls[1]).not.toContain('needs_attention');
  });
});
