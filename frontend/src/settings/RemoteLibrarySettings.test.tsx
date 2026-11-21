// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteLibrarySettings from './RemoteLibrarySettings';
import { api, type RemoteMirrorPreview } from '../api/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api/client', () => ({
  api: { remoteMirror: { preview: vi.fn() } },
}));

const previewMock = api.remoteMirror.preview as ReturnType<typeof vi.fn>;

const OK_PREVIEW: RemoteMirrorPreview = {
  status: 'ok',
  computed_at: '2026-11-20T19:00:00+00:00',
  duration_ms: 4200,
  roots: ['/music'],
  tracks: 3,
  files: 2,
  upload_bytes: 5 * 1024 * 1024 * 1024,
  unchanged: 0,
  changed: 0,
  missing: [{ track_id: 9, reason: 'audio file missing' }],
  missing_total: 1,
  collisions: ['Song.mp3'],
  collision_total: 1,
};

describe('RemoteLibrarySettings', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const render = async () => {
    const client = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <RemoteLibrarySettings />
        </QueryClientProvider>,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previewMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('runs the preview only on demand and shows the plan', async () => {
    previewMock.mockResolvedValue(OK_PREVIEW);
    await render();
    expect(previewMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Read-only');

    const button = container.querySelector('button')!;
    await act(async () => button.click());
    await vi.waitFor(() => expect(container.textContent).toContain('5.0 GB'));
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('3'); // tracks
    expect(container.textContent).toContain('5.0 GB');
    expect(container.textContent).toContain('audio file missing');
    expect(container.textContent).toContain('Song.mp3');
  });

  it('points at Library settings when no tracks folder is configured', async () => {
    previewMock.mockResolvedValue({ ...OK_PREVIEW, status: 'no_tracks_root' });
    await render();
    await act(async () => container.querySelector('button')!.click());
    await vi.waitFor(() => expect(container.textContent).toContain('Set your tracks folder'));
  });

  it('surfaces a failed scan', async () => {
    previewMock.mockRejectedValue(new Error('Failed to run the mirror preview (500)'));
    await render();
    await act(async () => container.querySelector('button')!.click());
    await vi.waitFor(() => expect(container.textContent).toContain('Could not run the preview'));
  });
});
