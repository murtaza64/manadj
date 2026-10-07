/**
 * Drop import (#297): files/folders dragged in from the filesystem are Disk
 * Imported in place. Paths come from the Electron preload bridge; browsers
 * expose no paths, so a drop there only explains itself.
 */

import { isTrackDrag } from '../selection/trackDrag';
import type { DropImportResult } from '../types';

export const DESKTOP_ONLY_MESSAGE = 'Drop import needs the desktop app (no file paths in the browser)';

/** True when a drag carries OS files (usable from dragover). */
export function isFileDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes('Files') && !isTrackDrag(dt);
}

/** Absolute paths of the dropped files, or null when the bridge is absent. */
export function droppedPaths(
  dt: DataTransfer,
  bridge: FileDropBridge | undefined = window.manadjFiles,
): string[] | null {
  if (!bridge) return null;
  const paths: string[] = [];
  for (const file of Array.from(dt.files)) {
    try {
      const path = bridge.pathForFile(file);
      if (path) paths.push(path);
    } catch {
      // not a filesystem-backed File
    }
  }
  return paths;
}

/** Toast text for a drop import result. */
export function dropResultMessage(result: DropImportResult, toPlaylist = false): string {
  const parts: string[] = [];
  if (result.imported > 0) {
    parts.push(`Imported ${result.imported} track${result.imported === 1 ? '' : 's'}${toPlaylist ? ' to playlist' : ''}`);
  }
  if (result.skipped > 0) parts.push(`${result.skipped} already in library`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (parts.length === 0) return 'No audio files in drop';
  return parts.join(' · ');
}
