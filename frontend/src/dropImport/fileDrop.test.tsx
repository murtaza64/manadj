// @vitest-environment jsdom
/**
 * Drop import (#297): OS files dropped onto the track table / a playlist
 * row Disk Import in place via the Electron path bridge. API faked at the
 * client seam (ADR 0002); sidebar, hook, and toasts are real.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlaylistSidebar from '../components/PlaylistSidebar';
import { ToastProvider } from '../components/Toast';
import { droppedPaths, dropResultMessage, isFileDrag } from './fileDrop';
import FileDropOverlay from './FileDropOverlay';
import { useFileDropImport, useFileDropTarget } from './useFileDropImport';
import type { DropImportResult } from '../types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
});

const dropImport = vi.hoisted(() =>
  vi.fn(async (): Promise<DropImportResult> => ({
    imported: 2, skipped: 1, failed: 0, ignored: 3,
    error_messages: [], track_ids: [5, 6], playlist_added: 2,
  })),
);

vi.mock('../api/client', () => ({
  api: {
    playlists: { list: vi.fn(async () => [{ id: 10, name: 'Warmup', color: null, display_order: 0 }]) },
    sets: { list: vi.fn(async () => []) },
    libraryImport: { dropImport },
  },
}));

const result = (over: Partial<DropImportResult>): DropImportResult => ({
  imported: 0, skipped: 0, failed: 0, ignored: 0, error_messages: [], track_ids: [], playlist_added: 0,
  ...over,
});

function fileTransfer(names: string[]): DataTransfer {
  const files = names.map((n) => new File(['x'], n));
  return { types: ['Files'], files, dropEffect: 'none' } as unknown as DataTransfer;
}

const bridge = { pathForFile: (f: File) => `/music/${f.name}` };

describe('fileDrop helpers', () => {
  it('detects OS file drags but not internal track drags', () => {
    expect(isFileDrag(fileTransfer([]))).toBe(true);
    expect(isFileDrag({ types: ['Files', 'application/x-manadj-tracks'] } as unknown as DataTransfer)).toBe(false);
    expect(isFileDrag({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
  });

  it('resolves paths via the bridge; null without it', () => {
    const dt = fileTransfer(['a.mp3', 'Album']);
    expect(droppedPaths(dt, bridge)).toEqual(['/music/a.mp3', '/music/Album']);
    expect(droppedPaths(dt, undefined)).toBeNull();
  });

  it('summarises imported / skipped / failed counts', () => {
    expect(dropResultMessage(result({ imported: 3, skipped: 2, failed: 1 }))).toBe(
      'Imported 3 tracks · 2 already in library · 1 failed',
    );
    expect(dropResultMessage(result({ imported: 1 }), true)).toBe('Imported 1 track to playlist');
    expect(dropResultMessage(result({ ignored: 4 }))).toBe('No audio files in drop');
  });
});

let root: Root | null = null;
let host: HTMLDivElement;

async function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <ToastProvider>{node}</ToastProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function drag(target: Element, type: string, dt: DataTransfer) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const toasts = () => Array.from(document.querySelectorAll('.toast-notice')).map((t) => t.textContent);

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  delete window.manadjFiles;
  dropImport.mockClear();
});

function DropTable({ playlistId }: { playlistId: number | null }) {
  const importFiles = useFileDropImport();
  const target = useFileDropTarget((dt) => void importFiles(dt, playlistId));
  return (
    <div
      data-testid="table"
      onDragOver={target.onDragOver}
      onDragLeave={target.onDragLeave}
      onDrop={target.onDrop}
    >
      <FileDropOverlay rect={target.rect} label="Drop to import" />
    </div>
  );
}

describe('track table drop', () => {
  it('shows the overlay and imports dropped paths with a result toast', async () => {
    window.manadjFiles = bridge;
    await render(<DropTable playlistId={null} />);
    const table = host.querySelector('[data-testid="table"]')!;
    const dt = fileTransfer(['a.mp3', 'Album']);
    const over = drag(table, 'dragover', dt);
    expect(over.defaultPrevented).toBe(true);
    expect(host.querySelector('[data-testid="file-drop-overlay"]')).not.toBeNull();

    drag(table, 'drop', dt);
    await flush();
    expect(host.querySelector('[data-testid="file-drop-overlay"]')).toBeNull();
    expect(dropImport).toHaveBeenCalledWith({ paths: ['/music/a.mp3', '/music/Album'], playlist_id: null });
    expect(toasts()).toContain('Imported 2 tracks · 1 already in library');
  });

  it('explains the desktop-app requirement in a browser', async () => {
    await render(<DropTable playlistId={null} />);
    drag(host.querySelector('[data-testid="table"]')!, 'drop', fileTransfer(['a.mp3']));
    await flush();
    expect(dropImport).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatch(/desktop app/);
  });
});

describe('playlist row drop', () => {
  it('imports and appends to the dropped-on playlist', async () => {
    window.manadjFiles = bridge;
    const ImportingSidebar = () => {
      const importFiles = useFileDropImport();
      return (
        <PlaylistSidebar
          selectedView="all"
          selectedPlaylistId={null}
          onSelectView={() => {}}
          onSelectPlaylist={() => {}}
          onTrackDrop={() => {}}
          onFileDrop={(id, dt) => void importFiles(dt, id)}
          selectedSetId={null}
          onSelectSet={() => {}}
        />
      );
    };
    await render(<ImportingSidebar />);
    const row = host.querySelector('[data-entry-key="playlist:10"]')!;
    const dt = fileTransfer(['b.flac']);
    expect(drag(row, 'dragover', dt).defaultPrevented).toBe(true);
    drag(row, 'drop', dt);
    await flush();
    expect(dropImport).toHaveBeenCalledWith({ paths: ['/music/b.flac'], playlist_id: 10 });
    expect(toasts()).toContain('Imported 2 tracks to playlist · 1 already in library');
  });
});
