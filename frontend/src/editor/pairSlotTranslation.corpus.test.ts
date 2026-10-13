/**
 * Corpus round-trip check (#204 exit test, against REAL artifacts): every
 * existing Transition in a live library must survive the pair→slot
 * projection and a no-edit save BYTE-IDENTICALLY (ADR 0037's lossless
 * invariant, proven on the actual inventory rather than fixtures).
 *
 * Env-gated so the unit suite stays hermetic: set CORPUS_API to a running
 * backend (e.g. the lane app's) to run it; skipped otherwise.
 *
 *   CORPUS_API=http://localhost:8457 npx vitest run \
 *     src/editor/pairSlotTranslation.corpus.test.ts
 */
import { describe, expect, it } from 'vitest';
import { editsToTransition, transitionToProjection } from './pairSlotTranslation';
import { emptyEdits } from '../routines/routineDraft';
import type { Transition } from './mixModel';

const API = process.env.CORPUS_API;

interface TransitionRow {
  a_track_id: number;
  b_track_id: number;
  uuid: string;
  name: string;
  data: Transition;
}

describe.skipIf(!API)('pairSlotTranslation — real-corpus round-trip', () => {
  it('every existing Transition survives projection + no-edit save byte-identically', async () => {
    const rows = (await (await fetch(`${API}/api/transitions`)).json()) as TransitionRow[];
    expect(rows.length).toBeGreaterThan(0);

    const bpmCache = new Map<number, number | null>();
    const bpmOf = async (id: number): Promise<number | null> => {
      if (!bpmCache.has(id)) {
        const t = (await (await fetch(`${API}/api/tracks/${id}`)).json()) as {
          bpm?: number | null;
        };
        bpmCache.set(id, t.bpm ?? null);
      }
      return bpmCache.get(id)!;
    };

    for (const row of rows) {
      const original = row.data;
      const proj = transitionToProjection({
        uuid: row.uuid,
        name: row.name,
        transition: original,
        trackAId: row.a_track_id,
        trackBId: row.b_track_id,
        bpmA: await bpmOf(row.a_track_id),
        bpmB: await bpmOf(row.b_track_id),
      });
      const saved = editsToTransition(emptyEdits(), {
        original,
        durationBeats: proj.detail.duration_beats,
        secPerBeat: proj.secPerBeat,
      });
      // Byte-identical: same values AND same serialization (key order
      // survives the clone-spread, so the persisted payload is unchanged).
      expect(saved, `${row.a_track_id}→${row.b_track_id} "${row.name}" (${row.uuid})`).toEqual(
        original
      );
      expect(JSON.stringify(saved)).toBe(JSON.stringify(original));
      // And the projection itself is a playable 2-slot detail.
      expect(proj.detail.cast).toEqual([row.a_track_id, row.b_track_id]);
      expect(proj.detail.duration_beats).toBeGreaterThan(0);
    }
  });
});
