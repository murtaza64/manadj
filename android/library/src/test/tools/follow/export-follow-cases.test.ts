// Follow golden fixture, stage 2 (desktop frontend): runs the desktop's real
// Follow pipeline — FollowRanking.derive/project (rankedFollow.ts), Known
// strengths (links/known.ts), Match score/Affinity floor/Temperature draw
// (matchScore.ts) — over stage 1's snapshot + backend candidate sets, with
// the same glue useRankedFollow.ts applies. From frontend/ of a main checkout:
//   FOLLOW_GOLDEN_DIR=<dir> npx vitest run --dir ../android/library/src/test/tools/follow
// Reads <dir>/{snapshot,candidates,cases}.json, writes <dir>/expected.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { join } from 'node:path';
import { FollowRanking } from '../../../../../../frontend/src/follow/rankedFollow';
import { knownStrengthOf } from '../../../../../../frontend/src/links/known';
import { linkKeyOf, linkedIdsOf } from '../../../../../../frontend/src/links/linkStore';
import { engineIdToOpenKey } from '../../../../../../frontend/src/utils/keyUtils';
import type { PairInfo } from '../../../../../../frontend/src/editor/transitionIndex';
import type { Track } from '../../../../../../frontend/src/types';

test('export follow golden cases', () => {
const dir = process.env.FOLLOW_GOLDEN_DIR!;
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const snapshot = read('snapshot.json');
const candidateSets: Record<string, number[]> = read('candidates.json');
const cases: { refs: number[]; thr: number; knownOnly: boolean; temperature: number; seed: number }[] = read('cases.json');

// Input check: the snapshot's key_openkey must be the desktop's engineIdToOpenKey.
for (const t of snapshot.tracks) {
  if ((t.key == null ? null : engineIdToOpenKey(t.key)) !== t.key_openkey) {
    throw new Error(`key_openkey mismatch on track ${t.id}: ${t.key} → ${t.key_openkey}`);
  }
}

// API Track rows as the desktop list serves them (served bpm = snapshot bpm).
const tracks: Track[] = snapshot.tracks.map((t: any) => ({
  id: t.id, filename: t.file_name, title: t.title, artist: t.artist ?? undefined, key: t.key ?? undefined,
  bpm: t.bpm ?? undefined, energy: t.energy ?? undefined, created_at: t.date_added, updated_at: t.date_added,
  tags: t.tag_ids.map((id: number) => ({ id })),
}) as unknown as Track);
const byId = new Map(tracks.map((t) => [t.id, t]));

// Transition index (editor/transitionIndex.ts shape): per ordered pair, count + preferred.
const from = new Map<number, Map<number, PairInfo>>();
for (const e of snapshot.transitions) {
  if (!from.has(e.a)) from.set(e.a, new Map());
  from.get(e.a)!.set(e.b, { count: e.count, preferred: e.favorite });
}
const links = new Set<string>(snapshot.links.map(([a, b]: [number, number]) => linkKeyOf(a, b)));

const out = cases.map((c) => {
  const ranking = new FollowRanking();
  // useRankedFollow.ts: references → { track, candidates, known }.
  const references = c.refs.map((id) => {
    const reference = byId.get(id)!;
    const fromRef = from.get(id) ?? new Map<number, PairInfo>();
    const known = new Map<number, number>();
    for (const cand of [...fromRef.keys(), ...linkedIdsOf(links, id)]) {
      known.set(cand, knownStrengthOf(fromRef, links, id, cand)!);
    }
    const ids = candidateSets[`${id}:${c.thr}`];
    return { track: reference, candidates: ids.map((i) => byId.get(i)!), known };
  });
  const derived = ranking.derive(references, { knownOnly: c.knownOnly, bpmThresholdPercent: c.thr });
  const ordered = derived.project(tracks, true, c.temperature, c.seed);
  return {
    ...c,
    rows: ordered.map((t) => ({
      id: t.id,
      label: derived.groupLabelFor!(t),
      score: derived.scoreFor ? derived.scoreFor(t) : null,
    })),
  };
});
writeFileSync(join(dir, 'expected.json'), JSON.stringify(out));
console.log(`${out.length} cases, ${out.reduce((n, c) => n + c.rows.length, 0)} rows`);
});
