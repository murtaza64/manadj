import { BACKEND_URL } from './client';
import type { PlaylistExportFieldPlan } from '../types';

export type FieldScope = 'selected' | 'filtered' | 'all';
export type FieldName = 'title' | 'artist' | 'key' | 'bpm' | 'energy' | 'tags' | 'hotcues' | 'beatgrid' | 'maincue';
export type FieldContext = { track_ids: number[]; scope: FieldScope; surface: 'engine' | 'rekordbox'; direction: 'import' | 'export'; fields: FieldName[] };
export type FieldChange = Omit<PlaylistExportFieldPlan, 'action'> & { action: 'skip' | 'blocked' | 'fill' | 'consent' };
export type FieldPlan = FieldContext & { token: string; destination: string; executable: boolean; warnings: string[]; tracks: { track_id: number; title: string | null; filename: string; fields: FieldChange[] }[] };
export type FieldOutcome = { field: string; status: 'applied' | 'skipped' | 'failed' | 'unknown'; reason?: string; detail?: unknown };
export type FieldReceipt = FieldContext & { token: string; destination: string; status: string; verification: string; tracks: { track_id: number; title: string | null; fields: FieldOutcome[] }[] };

export function supportedFields(surface: FieldContext['surface'], direction: FieldContext['direction']): FieldName[] {
  if (direction === 'import') return surface === 'engine' ? ['title', 'artist', 'energy', 'key', 'hotcues', 'beatgrid', 'maincue'] : ['title', 'artist', 'energy', 'key', 'hotcues', 'beatgrid'];
  return surface === 'engine' ? ['energy', 'key', 'hotcues', 'beatgrid', 'maincue'] : ['key', 'hotcues', 'beatgrid', 'maincue'];
}

export class FieldRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function completeReceipt(value: unknown, plan: FieldPlan): value is FieldReceipt {
  if (!object(value) || value.token !== plan.token || value.destination !== plan.destination
      || value.direction !== plan.direction || value.surface !== plan.surface || value.scope !== plan.scope
      || JSON.stringify(value.track_ids) !== JSON.stringify(plan.track_ids) || JSON.stringify(value.fields) !== JSON.stringify(plan.fields)
      || typeof value.status !== 'string' || !['complete', 'partial', 'unknown'].includes(value.status)
      || typeof value.verification !== 'string' || !Array.isArray(value.tracks) || value.tracks.length !== plan.tracks.length) return false;
  const ids = new Set(plan.track_ids);
  for (const row of value.tracks as unknown[]) {
    if (!object(row) || typeof row.track_id !== 'number' || !ids.delete(row.track_id)
        || (row.title !== null && typeof row.title !== 'string') || !Array.isArray(row.fields) || row.fields.length !== plan.fields.length) return false;
    const fields = new Set<string>(plan.fields);
    for (const field of row.fields as unknown[]) {
      if (!object(field) || typeof field.field !== 'string' || !fields.delete(field.field)
          || typeof field.status !== 'string' || !['applied', 'skipped', 'failed', 'unknown'].includes(field.status)
          || (field.reason != null && typeof field.reason !== 'string')) return false;
    }
    if (fields.size) return false;
  }
  return ids.size === 0;
}

async function post(path: string, body: unknown) {
  return fetch(`${BACKEND_URL}/api/sync/fields/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export const fieldReview = {
  async plan(context: FieldContext): Promise<FieldPlan> {
    const response = await post('plan', context);
    const body = await response.json();
    if (!response.ok) throw new FieldRequestError(body?.detail?.message || 'Field plan unavailable', body?.detail?.code || 'rejected');
    return body;
  },
  async execute(plan: FieldPlan, replacements: { track_id: number; field: string }[]): Promise<FieldReceipt> {
    let response: Response;
    try {
      const { track_ids, scope, surface, direction, fields, token } = plan;
      response = await post('execute', { track_ids, scope, surface, direction, fields, token, replacements });
    } catch {
      throw new FieldRequestError('Connection lost. Outcome unknown; inspect before repeating.', 'unknown');
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && completeReceipt(body, plan)) return body;
    if (response.ok || response.status >= 500) throw new FieldRequestError('Incomplete receipt. Outcome unknown; do not repeat blindly.', 'unknown');
    const detail = object(body) && object(body.detail) ? body.detail : {};
    throw new FieldRequestError(typeof detail.message === 'string' ? detail.message : 'Operation not started', typeof detail.code === 'string' ? detail.code : 'rejected');
  },
};
