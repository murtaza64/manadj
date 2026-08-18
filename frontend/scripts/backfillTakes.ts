/**
 * Backfill Takes from stored Sessions (four-deck-performance 38, ADR 0033's
 * re-analyzability payoff): replay every persisted Session's event log
 * through the CURRENT detector and persist the Takes it finds that the
 * detector of the day missed (the >2-audible gate, the missing C/D pairs).
 *
 * Usage (backend must be running):
 *   npx tsx scripts/backfillTakes.ts                # dry run against :8127
 *   npx tsx scripts/backfillTakes.ts --apply
 *   npx tsx scripts/backfillTakes.ts --base http://localhost:8177 --apply
 *
 * Dedup: an emitted take is skipped when the session already has a take
 * with the same (a,b) track pair whose window starts within DEDUP_S —
 * covers both live-detected takes and re-runs of this script (idempotent).
 * Inserted takes carry origin 'backfill'.
 */
import { initialCaptureState, reduceCapture } from '../src/capture/detector';
import type { CaptureEvent, DetectedTake } from '../src/capture/events';

const DEDUP_S = 10;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : 'http://localhost:8127';
const API = `${BASE}/api`;

interface SessionRow {
  uuid: string;
  started_at: string;
  ended_at: string | null;
}
interface TakeRow {
  uuid: string;
  a_track_id: number;
  b_track_id: number;
  window_start_s: number;
  session_uuid: string | null;
  origin: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  const sessions = await get<SessionRow[]>('/sessions');
  const existing = await get<TakeRow[]>('/takes');
  const bySession = new Map<string, TakeRow[]>();
  for (const t of existing) {
    if (t.session_uuid === null) continue;
    const list = bySession.get(t.session_uuid) ?? [];
    list.push(t);
    bySession.set(t.session_uuid, list);
  }

  let totalNew = 0;
  let totalDuped = 0;
  for (const sess of [...sessions].reverse()) {
    // Never touch a live (unended) session: its sink is still detecting.
    if (sess.ended_at === null) {
      console.log(`  ${sess.uuid.slice(0, 8)}  LIVE — skipped`);
      continue;
    }
    const detail = await get<{ events: CaptureEvent[] }>(`/sessions/${sess.uuid}`);
    let state = initialCaptureState();
    const found: DetectedTake[] = [];
    for (const e of detail.events) {
      const [next, takes] = reduceCapture(state, e);
      state = next;
      found.push(...takes);
    }
    const have = bySession.get(sess.uuid) ?? [];
    const fresh = found.filter(
      (t) =>
        !have.some(
          (h) =>
            h.a_track_id === t.outgoingTrackId &&
            h.b_track_id === t.incomingTrackId &&
            Math.abs(h.window_start_s - t.windowStartS) < DEDUP_S
        )
    );
    totalNew += fresh.length;
    totalDuped += found.length - fresh.length;
    const pairs = fresh
      .map((t) => `${t.outgoingDeck}>${t.incomingDeck}`)
      .reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }), {});
    console.log(
      `  ${sess.uuid.slice(0, 8)} ${sess.started_at.slice(0, 16)}  ` +
        `detected ${found.length}, already-have ${found.length - fresh.length}, ` +
        `NEW ${fresh.length}  ${JSON.stringify(pairs)}`
    );
    if (APPLY) {
      for (const t of fresh) {
        const res = await fetch(`${API}/takes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uuid: crypto.randomUUID(),
            a_track_id: t.outgoingTrackId,
            b_track_id: t.incomingTrackId,
            window_start_s: t.windowStartS,
            window_end_s: t.windowEndS,
            confidence: t.confidence,
            detector_version: t.detectorVersion,
            params: t.params,
            events: t.events,
            session_uuid: sess.uuid,
            origin: 'backfill',
          }),
        });
        if (!res.ok) {
          console.error(`    POST take failed (${res.status}): ${await res.text()}`);
        }
      }
    }
  }
  console.log(
    `\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${totalNew} new takes` +
      ` (${totalDuped} already present, skipped)`
  );
}

void main();
