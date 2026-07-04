/**
 * Track drag payload (playlist-editing 02): rows drag the whole selection.
 *
 * Payload carries the ordered track-id list under 'application/x-manadj-tracks'
 * and the source pane under 'application/x-manadj-track-source' — drop
 * targets branch on source (e.g. a playlist pane reorders only drags that
 * started in it).
 */

export const TRACKS_MIME = 'application/x-manadj-tracks';
const SOURCE_MIME = 'application/x-manadj-track-source';

/** Where a track drag started (drop targets branch on this). */
export type TrackDragSource = 'playlist-pane' | 'library';

export function setTrackDragPayload(
  dt: DataTransfer,
  ids: readonly number[],
  source: TrackDragSource = 'library'
): void {
  dt.setData(TRACKS_MIME, JSON.stringify(ids));
  dt.setData(SOURCE_MIME, source);
  dt.effectAllowed = 'copy';
}

/** True when a drag carries tracks (usable from dragover, where data is unreadable). */
export function isTrackDrag(dt: DataTransfer): boolean {
  return dt.types.includes(TRACKS_MIME);
}

export function readTrackDragPayload(dt: DataTransfer): number[] {
  const raw = dt.getData(TRACKS_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) return parsed;
  } catch {
    // malformed payload
  }
  return [];
}

export function readTrackDragSource(dt: DataTransfer): TrackDragSource {
  return dt.getData(SOURCE_MIME) === 'playlist-pane' ? 'playlist-pane' : 'library';
}
