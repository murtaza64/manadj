/**
 * Visualizer preset ratings (#401), desktop side: thumbs verdicts posted to
 * /api/ga/ratings (GA solo events, docs/visualizer-ga.md) + live tallies.
 *
 * One verdict per (surface, preset, context) per app run: rating the same
 * preset again in the same place replaces the verdict (same uuid) instead of
 * stacking votes.
 */
import { useSyncExternalStore } from 'react';
import { API_BASE } from '../api/client';

export type RatingOutcome = 'like' | 'dislike' | 'neutral';
export type RatingSource = 'viz' | 'clip-editor' | 'reviewer';

export interface PresetTally {
  likes: number;
  dislikes: number;
  neutral: number;
  score: number;
  last: { outcome: RatingOutcome; at: number; source: string } | null;
}

interface State {
  tallies: Record<string, PresetTally>;
  /** This run's verdicts by verdict key. */
  mine: Record<string, RatingOutcome>;
}

let state: State = { tallies: {}, mine: {} };
let loaded = false;
const listeners = new Set<() => void>();
const uuids = new Map<string, string>();

function emit(next: State) {
  state = next;
  for (const l of listeners) l();
}

/** GA id of a preset: curated ids are rated as their g00 seed. */
export function gaPresetId(id: string): string {
  return /^g\d+-/.test(id) ? id : `g00-${id}`;
}

export function verdictKey(source: RatingSource, presetId: string, contextKey: string): string {
  return `${source}|${gaPresetId(presetId)}|${contextKey}`;
}

async function refresh(): Promise<void> {
  try {
    const r = await fetch(`${API_BASE}/ga/ratings`);
    if (r.ok) emit({ ...state, tallies: ((await r.json()) as { presets: Record<string, PresetTally> }).presets });
  } catch {
    // tallies are decoration; rating still works
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!loaded) {
    loaded = true;
    void refresh();
  }
  return () => listeners.delete(l);
}

export function usePresetRatings(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function tallyFor(tallies: Record<string, PresetTally>, presetId: string): PresetTally | null {
  return tallies[gaPresetId(presetId)] ?? tallies[presetId] ?? null;
}

export interface RateArgs {
  presetId: string;
  outcome: RatingOutcome;
  source: RatingSource;
  /** Identifies "the same place" (clip source, video…); same key = replace. */
  contextKey: string;
  context?: Record<string, unknown>;
  params?: Record<string, number>;
}

export async function ratePreset(a: RateArgs): Promise<void> {
  const key = verdictKey(a.source, a.presetId, a.contextKey);
  let uuid = uuids.get(key);
  if (!uuid) {
    uuid = crypto.randomUUID();
    uuids.set(key, uuid);
  }
  const prev = state.mine[key];
  emit({ ...state, mine: { ...state.mine, [key]: a.outcome } });
  try {
    const r = await fetch(`${API_BASE}/ga/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset: a.presetId, outcome: a.outcome, source: a.source, uuid,
        rated_at_ms: Date.now(), context: a.context, params: a.params,
      }),
    });
    if (!r.ok) throw new Error(`rating failed (${r.status})`);
    const body = (await r.json()) as { presets: Record<string, PresetTally> };
    emit({ ...state, tallies: body.presets });
  } catch (err) {
    const mine = { ...state.mine };
    if (prev) mine[key] = prev; else delete mine[key];
    emit({ ...state, mine });
    throw err;
  }
}

/** Test seam. */
export function _resetPresetRatings(): void {
  state = { tallies: {}, mine: {} };
  loaded = false;
  uuids.clear();
}
