// Acquisition view formatting helpers (gh#342).
import type { ErrorKind, SourceItem } from '../../types';

export function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatSize(bytes: number | null): string {
  if (bytes == null) return '?';
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function remoteBasename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
}

export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** Compact "when liked" for the table: today / 3d / 2026-05-03. */
export function likedLabel(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString('sv');
}

export function errorKindLabel(kind: ErrorKind | null, item: SourceItem): string {
  switch (kind) {
    case 'drm':
      return 'DRM';
    case 'gone':
      return 'gone';
    case 'ratelimit':
      return 'rate limited';
    case 'peer':
      return item.download?.via === 'soulseek' ? 'peer' : 'failed';
    default:
      return 'failed';
  }
}

/** Whether the item is waiting on the operator to choose a target. */
export function needsTarget(item: SourceItem): boolean {
  return item.stage === 'failed' && !item.download?.cooling_down_until;
}

export function inFlight(item: SourceItem): boolean {
  return (
    item.stage === 'queued' ||
    item.stage === 'downloading' ||
    (item.stage === 'failed' && !!item.download?.cooling_down_until)
  );
}

/** Fulfilled within the last day, by recorded/asserted acquisition time. */
export function landedRecently(item: SourceItem): boolean {
  const at = item.provenance?.acquired_at;
  if (!at || item.stage !== 'fulfilled') return false;
  return Date.now() - new Date(at).getTime() < 86_400_000;
}

/** Attention order for status sorting: lower sorts first. */
export function statusRank(item: SourceItem): number {
  if (needsTarget(item)) return 0;
  if (item.stage === 'new' && item.correspondence?.status === 'proposed') return 1;
  if (item.stage === 'downloading') return 2;
  if (inFlight(item)) return 3;
  if (item.stage === 'new') return 4;
  if (item.stage === 'fulfilled') return 6;
  return 7; // ignored
}
