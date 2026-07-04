/**
 * Track drag payload (playlist-editing 02): rows drag the whole selection.
 *
 * Payload carries the ordered track-id list under 'application/x-manadj-tracks'
 * plus a legacy single 'trackId' entry (first id) for older drop targets.
 */

export const TRACKS_MIME = 'application/x-manadj-tracks';

export function setTrackDragPayload(dt: DataTransfer, ids: readonly number[]): void {
  dt.setData(TRACKS_MIME, JSON.stringify(ids));
  if (ids.length > 0) dt.setData('trackId', String(ids[0]));
  dt.effectAllowed = 'copy';
}

/** True when a drag carries tracks (usable from dragover, where data is unreadable). */
export function isTrackDrag(dt: DataTransfer): boolean {
  return dt.types.includes(TRACKS_MIME) || dt.types.includes('trackId');
}

export function readTrackDragPayload(dt: DataTransfer): number[] {
  const multi = dt.getData(TRACKS_MIME);
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) return parsed;
    } catch {
      // fall through to the legacy payload
    }
  }
  const single = parseInt(dt.getData('trackId'), 10);
  return Number.isFinite(single) && single > 0 ? [single] : [];
}
