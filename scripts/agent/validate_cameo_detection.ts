/**
 * One-off validation runner (#140): replay every real Session's event log
 * through the v4 detector and report the settled verdicts — Handovers vs
 * Guest engagements (Cameo Takes). Run from frontend/:
 *
 *   npx tsx ../scripts/agent/validate_cameo_detection.ts <events-dir> [out.json]
 *
 * where <events-dir> holds one JSON array of capture events per Session
 * (file name = session id). With [out.json], additionally writes every
 * settled GUEST verdict (full evidence slice) keyed by session id — the
 * sandbox-seeding input (what live detection would have persisted).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialCaptureState, reduceCaptureBatch } from '../../frontend/src/capture/detector';
import type { CaptureEvent } from '../../frontend/src/capture/events';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx validate_cameo_detection.ts <events-dir>');
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')));

let totalGuests = 0;
let totalHandovers = 0;
const emitted: { sessionId: number; take: unknown }[] = [];
for (const f of files) {
  const sid = f.replace('.json', '');
  const events = JSON.parse(readFileSync(join(dir, f), 'utf8')) as CaptureEvent[];
  const state = initialCaptureState();
  const takes = reduceCaptureBatch(state, events);
  const guests = takes.filter((t) => t.kind === 'guest');
  const handovers = takes.filter((t) => t.kind === 'handover');
  totalGuests += guests.length;
  totalHandovers += handovers.length;
  for (const g of guests) emitted.push({ sessionId: Number(sid), take: g });
  if (guests.length === 0) continue;
  console.log(`session ${sid}: ${handovers.length} handovers, ${guests.length} guest engagements`);
  for (const g of guests) {
    const len = (g.windowEndS - g.windowStartS).toFixed(1);
    console.log(
      `  guest ${g.incomingTrackId} over host ${g.outgoingTrackId}` +
        ` [decks ${g.incomingDeck} over ${g.outgoingDeck}]` +
        ` window ${g.windowStartS.toFixed(1)}..${g.windowEndS.toFixed(1)} (${len}s)` +
        ` conf ${g.confidence} engagement ${g.engagementUuid.slice(0, 8)}`
    );
  }
}
console.log(`\nTOTAL: ${totalHandovers} handovers, ${totalGuests} guest engagements across ${files.length} sessions`);

const out = process.argv[3];
if (out) {
  writeFileSync(out, JSON.stringify(emitted));
  console.log(`wrote ${emitted.length} guest takes to ${out}`);
}
