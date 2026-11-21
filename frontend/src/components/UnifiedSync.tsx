import { plural as pluralOf } from './plural';
import type {
  ExternalDrivePreview,
  ExternalDrivePreviewPlaylist,
  ExternalDriveImportResult,
  ExternalDriveFieldComparison,
} from '../api/client';

/** One place to see a connected drive against the library and queue what to
 * do about it. Today's supported direction is drive -> library only; the
 * drive is never written. Every queued item is bound to what the user saw
 * (ordered membership, target token) and rechecked right before it runs. */

export type RowState =
  | { kind: 'match'; label: string }
  | { kind: 'unknown'; label: string }
  | { kind: 'work'; label: string; action: 'copy' | 'update' | 'pair' }
  | { kind: 'blocked'; label: string };

/** Green only when the paired library playlist holds exactly the USB's
 * tracks (content-verified) in the same order. Not a claim about cues or
 * other fields, and the pairing is by name, so the label says so. */
export function classifyPlaylist(pl: ExternalDrivePreviewPlaylist, hasDestination: boolean): RowState {
  const m = pl.membership;
  if (!m) return { kind: 'unknown', label: 'Not checked yet' };
  if (m.counterpart_status === 'ambiguous-name') {
    return { kind: 'blocked', label: 'Several library playlists share this name' };
  }
  if (!hasDestination) return { kind: 'blocked', label: 'No library folder to copy into' };
  if (m.counterpart_status === 'no-local-playlist') {
    if (pl.track_count === 0) return { kind: 'blocked', label: 'Empty playlist' };
    return { kind: 'work', label: pl.folder_not_representable ? 'Not in your library (folder not kept)' : 'Not in your library', action: 'copy' };
  }
  if (m.counterpart_status === 'candidate-name-match') {
    // Same name as a library playlist, but the drive playlist is in a folder. Never
    // paired, never green: the user must choose the pairing by name.
    const where = `Drive folder "${pl.folder_path}". Same name as your library playlist "${m.candidate_name}", not paired`;
    const hasChange = m.adds_new > 0 || m.adds_in_library > 0 || m.order_differs === true;
    return hasChange ? { kind: 'work', label: where, action: 'pair' } : { kind: 'unknown', label: `${where}. Nothing to pull` };
  }
  const identical =
    m.adds_new === 0 && m.adds_in_library === 0 && m.uncertain_members === 0 && m.removes === 0;
  if (identical && m.order_differs === false) {
    return { kind: 'match', label: 'Tracks and order match (paired by name)' };
  }
  if (identical && m.order_differs === null) {
    return { kind: 'unknown', label: 'Same tracks, order not checked' };
  }
  // Nothing Apply could actually change: never offer it as a zero-track "success".
  const hasChange = m.adds_new > 0 || m.adds_in_library > 0 || m.order_differs === true;
  if (!hasChange) {
    if (m.uncertain_members > 0) {
      return { kind: 'unknown', label: `${m.uncertain_members} track${m.uncertain_members === 1 ? '' : 's'} can't be confirmed by audio. Nothing safe to apply.` };
    }
    return { kind: 'unknown', label: 'Your library has extra tracks. Nothing to pull from the drive.' };
  }
  return { kind: 'work', label: 'Differs from your library', action: 'update' };
}

export function describeChange(pl: ExternalDrivePreviewPlaylist): string {
  const m = pl.membership;
  if (!m) return '';
  if (m.counterpart_status === 'no-local-playlist') {
    return `Copy playlist: ${pluralOf(pl.track_count, 'track')}, ${pl.new_count} to import`;
  }
  const parts: string[] = m.counterpart_status === 'candidate-name-match' ? [`pairs with library playlist "${m.candidate_name}"`] : [];
  if (m.adds_new) parts.push(`${m.adds_new} imported`);
  if (m.adds_in_library) parts.push(`${m.adds_in_library} added from library`);
  if (m.order_differs) parts.push('order matched to USB');
  if (m.removes) parts.push(`${m.removes} local-only kept`);
  if (m.uncertain_members) parts.push(`${m.uncertain_members} unverified skipped`);
  return parts.join(', ') || 'No changes';
}

export type QueueItem =
  | { key: string; kind: 'copy'; playlistId: number; name: string; snapshot: string }
  | { key: string; kind: 'update'; playlistId: number; name: string; snapshot: string; counterpartId: number; token: string }
  | { key: string; kind: 'tracks'; name: string; snapshot: string; ordinals: number[] }
  | { key: string; kind: 'fields'; name: string; snapshot: string; changes: FieldChoice[] };

export type FieldChoice = { track_id: number; field: string; label: string; drive: string | number | null; library: string | number | null };

export const fieldsSnapshot = (cmp: ExternalDriveFieldComparison, changes: { track_id: number; field: string }[]) =>
  changes.map((c) => { const f = cmp.tracks.find((t) => t.track_id === c.track_id)?.fields.find((x) => x.field === c.field); return f ? `${c.track_id}:${c.field}:${f.drive}|${f.library}` : `${c.track_id}:${c.field}:gone`; }).join(';');

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function describeResult(kind: 'copy' | 'update' | 'tracks', res: ExternalDriveImportResult): string {
  if (res.errors?.length) {
    const first = res.errors[0];
    return `Stopped with ${plural(res.errors.length, 'error')}: ${typeof first === 'string' ? first : JSON.stringify(first)}`;
  }
  if (kind === 'copy' && res.playlist) {
    const p = res.playlist;
    return `Created playlist "${p.name}" in your library with ${plural(p.member_count, 'track')}` +
      (p.imported ? `, ${plural(p.imported, 'new track')} copied in` : ', all already in your library') +
      (p.skipped_uncertain ? `. ${plural(p.skipped_uncertain, 'track')} left out (not confirmed by audio)` : '') + '.';
  }
  if (kind === 'update' && res.playlist_update) {
    const u = res.playlist_update;
    return `Updated "${u.name}": ${plural(u.added_imported + u.added_from_library, 'track')} added, now ${plural(u.member_count, 'track')}` +
      (u.skipped_uncertain ? `. ${plural(u.skipped_uncertain, 'track')} left out (not confirmed by audio)` : '') + '.';
  }
  return res.imported ? `${plural(res.imported, 'track')} copied into your library.` : 'Nothing needed copying.';
}

export type ItemResult = { key: string; name: string; status: 'done' | 'held' | 'failed'; detail: string };

export const snapshotOfPlaylist = (pl: ExternalDrivePreviewPlaylist) =>
  `${(pl.track_ordinals ?? []).join(',')}|${pl.membership?.counterpart_id ?? pl.membership?.candidate_id ?? ''}|${pl.membership?.target_token ?? ''}`;
export const snapshotOfTracks = (p: ExternalDrivePreview) =>
  p.entries.filter((e) => e.status === 'new').map((e) => `${e.ordinal}:${e.device_path}`).join(',');

