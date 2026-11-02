import type { FieldContext, FieldName, FieldScope } from '../api/fieldReview';

export type SyncWorkspaceRequest =
  | { kind: 'fields'; trackIds: number[]; scope: FieldScope; label: string; fields?: FieldName[]; surface?: FieldContext['surface']; direction?: FieldContext['direction'] }
  | { kind: 'playlist'; playlistName: string };
export type WorkspaceEnvelope = SyncWorkspaceRequest & { sequence: number };
export const OPEN_SYNC_WORKSPACE_EVENT = 'manadj:open-sync-workspace';
let pending: WorkspaceEnvelope | null = null;
let sequence = 0;
let busy = false;

export function openSyncWorkspace(request: SyncWorkspaceRequest): boolean {
  if (busy) return false;
  if (request.kind === 'fields' && (!request.trackIds.length || request.trackIds.length > 10000
    || request.trackIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || !['selected', 'filtered', 'all'].includes(request.scope))) throw new Error('Capture a nonempty exact field scope (maximum10000 tracks).');
  if (request.kind === 'playlist' && !request.playlistName.trim()) throw new Error('Capture a playlist name.');
  pending = structuredClone({ ...request, sequence: ++sequence });
  window.dispatchEvent(new CustomEvent(OPEN_SYNC_WORKSPACE_EVENT));
  return true;
}
export function peekSyncWorkspace(): WorkspaceEnvelope | null { return pending ? structuredClone(pending) : null; }
export function takeSyncWorkspace(): WorkspaceEnvelope | null {
  const request = peekSyncWorkspace(); pending = null; return request;
}
export function setSyncWorkspaceBusy(value: boolean): void { busy = value; }
