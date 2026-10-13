import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DESKTOP_ONLY_MESSAGE, droppedPaths, dropResultMessage, isFileDrag } from './fileDrop';

/** Import an OS-file drop in place; optionally append to a playlist. */
export function useFileDropImport() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useCallback(
    async (dt: DataTransfer, playlistId: number | null = null) => {
      // DataTransfer is only readable during the drop event: resolve paths
      // before the first await.
      const paths = droppedPaths(dt);
      if (paths === null) {
        showToast(DESKTOP_ONLY_MESSAGE);
        return;
      }
      if (paths.length === 0) return;
      showToast('Importing dropped files…');
      try {
        const result = await api.libraryImport.dropImport({ paths, playlist_id: playlistId });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['track'] }),
          queryClient.invalidateQueries({ queryKey: ['tracks'] }),
          queryClient.invalidateQueries({ queryKey: ['playlist'] }),
          queryClient.invalidateQueries({ queryKey: ['playlists'] }),
        ]);
        showToast(dropResultMessage(result, playlistId !== null));
      } catch {
        showToast('Drop import failed');
      }
    },
    [queryClient, showToast],
  );
}

export interface FileDropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Drop-target handlers for OS-file drags. Compose with existing handlers:
 * each returns true when it consumed the event (a file drag).
 */
export function useFileDropTarget(onFiles: (dt: DataTransfer) => void) {
  const [rect, setRect] = useState<FileDropRect | null>(null);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>): boolean => {
    if (!isFileDrag(e.dataTransfer)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const r = e.currentTarget.getBoundingClientRect();
    setRect((cur) =>
      cur && cur.top === r.top && cur.left === r.left && cur.width === r.width && cur.height === r.height
        ? cur
        : { top: r.top, left: r.left, width: r.width, height: r.height },
    );
    return true;
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRect(null);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>): boolean => {
      if (!isFileDrag(e.dataTransfer)) return false;
      e.preventDefault();
      setRect(null);
      onFiles(e.dataTransfer);
      return true;
    },
    [onFiles],
  );

  return { rect, onDragOver, onDragLeave, onDrop };
}

/**
 * Swallow OS-file drops that miss every drop target: browsers/Electron
 * otherwise navigate the window to the dropped file.
 */
export function useSuppressStrayFileDrops() {
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => {
      if (!isFileDrag(e.dataTransfer) || e.defaultPrevented) return; // a target took it
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);
}
