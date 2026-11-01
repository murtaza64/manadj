import type { PlaylistExportPlan, PlaylistFullExportReport } from '../types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outcome(value: unknown): value is string {
  return typeof value === 'string' && /^(exported|skipped|failed)(: .+)?$/.test(value);
}

// Validate evidence about the submitted plan, not merely JSON from HTTP200.
// The synthetic memorycues plan row is reported by the hotcues writer. An
// aborted track can lack later field outcomes, but must report a failure reason.
export function completePlaylistExportReceipt(value: unknown, plan: PlaylistExportPlan): value is PlaylistFullExportReport {
  if (!record(value) || value.playlist_name !== plan.playlist_name
      || !Array.isArray(value.results) || value.results.length !== 1) return false;
  const result: unknown = value.results[0];
  if (!record(result) || result.target !== plan.target
      || typeof result.status !== 'string' || !['exported', 'partial', 'failed'].includes(result.status)
      || typeof result.playlist_created !== 'boolean'
      || (result.error != null && typeof result.error !== 'string')
      || !Array.isArray(result.tracks) || result.tracks.length !== plan.tracks.length) return false;
  for (const key of ['tracks_total', 'tracks_exported', 'tracks_skipped', 'tracks_failed']) {
    if (!Number.isSafeInteger(result[key]) || (result[key] as number) < 0) return false;
  }
  if (result.tracks_total !== plan.tracks.length) return false;
  const expected = new Map(plan.tracks.map(track => [track.track_id, track]));
  const counts = { exported: 0, skipped: 0, failed: 0 };
  for (const track of result.tracks as unknown[]) {
    if (!record(track) || !Number.isSafeInteger(track.track_id)
        || typeof track.status !== 'string' || !['exported', 'skipped', 'failed'].includes(track.status)
        || (track.title !== null && typeof track.title !== 'string')
        || (track.reason !== null && typeof track.reason !== 'string')
        || !record(track.fields) || !Object.values(track.fields).every(outcome)) return false;
    const planned = expected.get(track.track_id as number);
    if (!planned) return false;
    expected.delete(track.track_id as number);
    counts[track.status as keyof typeof counts]++;
    if (!outcome(track.fields.playlist)) return false;
    const aborted = track.status === 'failed' && typeof track.reason === 'string' && track.reason.trim().length > 0;
    if (!aborted) {
      const fields = plan.scope === 'order' ? [] : planned.fields.map(field => field.field === 'memorycues' ? 'hotcues' : field.field);
      if (!fields.every(field => outcome((track.fields as Record<string, unknown>)[field]))) return false;
    }
  }
  return expected.size === 0 && result.tracks_exported === counts.exported
    && result.tracks_skipped === counts.skipped && result.tracks_failed === counts.failed;
}
