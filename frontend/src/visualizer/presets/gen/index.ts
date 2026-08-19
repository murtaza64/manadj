/**
 * Genepool candidate loader (realtime-visualization 06). Candidates are
 * self-contained preset modules named `gNN-<slug>.candidate.ts`, default-
 * exporting a VisualizerPreset. They are auto-discovered here (no registry
 * edits — conflict-free parallel generation) and loaded ONLY by the arena;
 * the curated switcher never sees them. Promotion moves a file out of
 * gen/ into presets/ through normal review (docs/visualizer-ga.md).
 */

import type { VisualizerPreset } from '../types';

const modules = import.meta.glob<{ default: VisualizerPreset }>('./*.candidate.ts');

interface GenManifest {
  candidates: Record<string, { rating: number; status: string; score?: number }>;
}
const manifestModules = import.meta.glob('./genepool.json', { eager: true }) as Record<
  string,
  { default: GenManifest }
>;
const manifest = manifestModules['./genepool.json']?.default ?? { candidates: {} };

/** Candidate id = filename stem (e.g. `g01-ember-collapse`). */
export function candidateIds(): string[] {
  return Object.keys(modules)
    .map((path) => path.replace('./', '').replace('.candidate.ts', ''))
    .sort();
}

export interface CandidateListing {
  id: string;
  rating: number;
  /** Thumbs-native score (v3): (wins+approvals) - (losses+rejections). */
  score: number;
}

/**
 * Alive presets, best score first (thumbs-native v3; legacy Elo rating is
 * the tiebreaker). ALL presets are equal now (human, 2026-08-18): the
 * curated set lives here as its g00-* seeds — there is no separate
 * first-class tier. Dead fossils keep their files but stay out of the
 * switcher.
 */
export function aliveCandidateListings(): CandidateListing[] {
  const available = new Set(candidateIds());
  return Object.entries(manifest.candidates)
    .filter(([id, c]) => c.status === 'alive' && available.has(id))
    .map(([id, c]) => ({ id, rating: c.rating, score: c.score ?? 0 }))
    .sort((a, b) => b.score - a.score || b.rating - a.rating || a.id.localeCompare(b.id));
}

/** Post-load cache so synchronous render paths (layer building, param UIs)
 * can resolve gen presets once ensureCandidate has run. */
const cache = new Map<string, VisualizerPreset>();

export function getCachedCandidate(id: string): VisualizerPreset | null {
  return cache.get(id) ?? null;
}

export function isCandidateId(id: string): boolean {
  return `./${id}.candidate.ts` in modules;
}

export async function ensureCandidate(id: string): Promise<VisualizerPreset | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const preset = await loadCandidate(id);
  if (preset) cache.set(id, preset);
  return preset;
}

export async function loadCandidate(id: string): Promise<VisualizerPreset | null> {
  const loader = modules[`./${id}.candidate.ts`];
  if (!loader) return null;
  try {
    const module = await loader();
    // The manifest/arena key is the filename stem regardless of what the
    // module claims — agents can't collide ids by accident.
    return { ...module.default, id };
  } catch (error) {
    console.warn(`[genepool] candidate ${id} failed to load`, error);
    return null;
  }
}
