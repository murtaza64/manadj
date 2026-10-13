/**
 * Offline re-detection harness (issue #138, map #114): replay every
 * persisted Session's `session_chunks` event log through the CURRENT
 * detector and diff the Takes it emits against the Takes already persisted
 * (the detector-of-the-day's verdicts). Read-only — it never writes; its
 * job is to make a detector change auditable before it lands.
 *
 * Usage (a backend must be serving the DB under test — a lane app is ideal):
 *   npx tsx scripts/redetect.ts                       # every session, summary
 *   npx tsx scripts/redetect.ts --base http://localhost:8277
 *   npx tsx scripts/redetect.ts --session 5508f67d    # one session, verbose
 *   npx tsx scripts/redetect.ts --session 5508f67d --from 72300 --to 72830
 *   npx tsx scripts/redetect.ts --json                # machine-readable diff
 *
 * A diff row is one of:
 *   MATCH   — a persisted Take and a re-emitted Take agree on (a,b) pair and
 *             window within MATCH_S; window drift is reported.
 *   OLD     — persisted, not re-emitted (the change dropped it — e.g. a
 *             folded cross-cut or a de-duplicated twin).
 *   NEW     — re-emitted, not persisted (the change added it).
 * Zero-length windows (window_start == window_end) are flagged inline —
 * they are the defect this issue exists to kill.
 */
import { initialCaptureState, reduceCapture } from '../src/capture/detector';
import type { CaptureEvent, DetectedTake } from '../src/capture/events';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const BASE = flag('--base') ?? 'http://localhost:8127';
const API = `${BASE}/api`;
const ONLY = flag('--session'); // uuid prefix
const FROM = flag('--from') ? Number(flag('--from')) : -Infinity;
const TO = flag('--to') ? Number(flag('--to')) : Infinity;
const JSON_OUT = args.includes('--json');

/** Pair + window must agree within this to count as the same Handover. */
const MATCH_S = 6;

interface SessionRow {
  uuid: string;
  started_at: string;
  ended_at: string | null;
}
interface TakeRow {
  a_track_id: number;
  b_track_id: number;
  window_start_s: number;
  window_end_s: number;
  confidence: number;
  session_uuid: string | null;
  origin: string;
}
interface TrackRow {
  id: number;
  title: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** The track library is paginated ({ items, total_pages }); pull it whole. */
async function allTracks(): Promise<TrackRow[]> {
  const first = await get<{ items: TrackRow[]; total_pages: number }>('/tracks/?per_page=500&page=1');
  const out = [...first.items];
  for (let p = 2; p <= first.total_pages; p++) {
    const page = await get<{ items: TrackRow[] }>(`/tracks/?per_page=500&page=${p}`);
    out.push(...page.items);
  }
  return out;
}

function replay(events: CaptureEvent[]): DetectedTake[] {
  let state = initialCaptureState();
  const found: DetectedTake[] = [];
  for (const e of events) {
    const [next, takes] = reduceCapture(state, e);
    state = next;
    found.push(...takes);
  }
  return found;
}

type DiffKind = 'MATCH' | 'OLD' | 'NEW';
interface DiffRow {
  kind: DiffKind;
  a: number;
  b: number;
  oldStart?: number;
  oldEnd?: number;
  newStart?: number;
  newEnd?: number;
  oldZero?: boolean;
  newZero?: boolean;
}

/** Greedy pair-and-window match of persisted vs re-emitted Takes. */
function diff(persisted: TakeRow[], emitted: DetectedTake[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const usedNew = new Set<number>();
  for (const o of persisted) {
    let hit = -1;
    for (let i = 0; i < emitted.length; i++) {
      if (usedNew.has(i)) continue;
      const n = emitted[i];
      if (
        n.outgoingTrackId === o.a_track_id &&
        n.incomingTrackId === o.b_track_id &&
        Math.abs(n.windowStartS - o.window_start_s) < MATCH_S
      ) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      usedNew.add(hit);
      const n = emitted[hit];
      rows.push({
        kind: 'MATCH',
        a: o.a_track_id,
        b: o.b_track_id,
        oldStart: o.window_start_s,
        oldEnd: o.window_end_s,
        newStart: n.windowStartS,
        newEnd: n.windowEndS,
        oldZero: o.window_start_s === o.window_end_s,
        newZero: n.windowStartS === n.windowEndS,
      });
    } else {
      rows.push({
        kind: 'OLD',
        a: o.a_track_id,
        b: o.b_track_id,
        oldStart: o.window_start_s,
        oldEnd: o.window_end_s,
        oldZero: o.window_start_s === o.window_end_s,
      });
    }
  }
  for (let i = 0; i < emitted.length; i++) {
    if (usedNew.has(i)) continue;
    const n = emitted[i];
    rows.push({
      kind: 'NEW',
      a: n.outgoingTrackId,
      b: n.incomingTrackId,
      newStart: n.windowStartS,
      newEnd: n.windowEndS,
      newZero: n.windowStartS === n.windowEndS,
    });
  }
  rows.sort((x, y) => (x.oldStart ?? x.newStart ?? 0) - (y.oldStart ?? y.newStart ?? 0));
  return rows;
}

async function main(): Promise<void> {
  const sessions = await get<SessionRow[]>('/sessions');
  const takes = await get<TakeRow[]>('/takes');
  const tracks = await allTracks();
  const title = new Map(tracks.map((t) => [t.id, t.title]));
  const nm = (id: number) => `${title.get(id) ?? '?'} (${id})`;

  const bySession = new Map<string, TakeRow[]>();
  for (const t of takes) {
    if (t.session_uuid === null) continue;
    const l = bySession.get(t.session_uuid) ?? [];
    l.push(t);
    bySession.set(t.session_uuid, l);
  }

  const jsonReport: unknown[] = [];
  let totOld = 0;
  let totNew = 0;
  let totZeroOld = 0;
  let totZeroNew = 0;
  let totDupOld = 0;

  for (const sess of sessions) {
    if (ONLY && !sess.uuid.startsWith(ONLY)) continue;
    if (sess.ended_at === null) continue; // live session: sink still running
    const detail = await get<{ events: CaptureEvent[] }>(`/sessions/${sess.uuid}`);
    const emitted = replay(detail.events).filter((t) => t.windowStartS >= FROM && t.windowStartS <= TO);
    const persisted = (bySession.get(sess.uuid) ?? []).filter(
      (t) => t.window_start_s >= FROM && t.window_start_s <= TO
    );
    const rows = diff(persisted, emitted);
    const olds = rows.filter((r) => r.kind === 'OLD').length;
    const news = rows.filter((r) => r.kind === 'NEW').length;
    const zeroOld = persisted.filter((t) => t.window_start_s === t.window_end_s).length;
    const zeroNew = emitted.filter((t) => t.windowStartS === t.windowEndS).length;
    // Duplicate ordered pairs among persisted takes (same a,b within MATCH_S).
    const dupOld = countDuplicates(persisted);
    totOld += olds;
    totNew += news;
    totZeroOld += zeroOld;
    totZeroNew += zeroNew;
    totDupOld += dupOld;

    if (JSON_OUT) {
      jsonReport.push({ uuid: sess.uuid, started_at: sess.started_at, rows });
      continue;
    }

    const verbose = Boolean(ONLY);
    if (!verbose && olds === 0 && news === 0 && zeroOld === 0 && zeroNew === 0 && dupOld === 0)
      continue;
    console.log(
      `\n=== session ${sess.uuid.slice(0, 8)} ${sess.started_at.slice(0, 16)}  ` +
        `persisted ${persisted.length}, re-emitted ${emitted.length}  ` +
        `[OLD ${olds} / NEW ${news} / zero old ${zeroOld} new ${zeroNew} / dup old ${dupOld}]`
    );
    if (verbose) {
      for (const r of rows) {
        const oldw = r.oldStart !== undefined ? `${fmt(r.oldStart)}\u2192${fmt(r.oldEnd!)}` : '—';
        const neww = r.newStart !== undefined ? `${fmt(r.newStart)}\u2192${fmt(r.newEnd!)}` : '—';
        const drift =
          r.kind === 'MATCH'
            ? `  \u0394start ${fmt(r.newStart! - r.oldStart!)} \u0394end ${fmt(r.newEnd! - r.oldEnd!)}`
            : '';
        const zflag = r.oldZero ? ' [OLD ZERO]' : r.newZero ? ' [NEW ZERO]' : '';
        console.log(
          `  ${r.kind.padEnd(5)} ${nm(r.a)} \u2192 ${nm(r.b)}` +
            `\n         old ${oldw}   new ${neww}${drift}${zflag}`
        );
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(jsonReport, null, 2));
    return;
  }
  console.log(
    `\nTOTAL across sessions${ONLY ? ` (filter ${ONLY})` : ''}: ` +
      `OLD-only ${totOld}, NEW-only ${totNew}, ` +
      `zero-length old ${totZeroOld} \u2192 new ${totZeroNew}, ` +
      `duplicate ordered-pairs old ${totDupOld}`
  );
}

function countDuplicates(takes: TakeRow[]): number {
  const seen = new Map<string, number[]>();
  for (const t of takes) {
    const k = `${t.a_track_id}>${t.b_track_id}`;
    const l = seen.get(k) ?? [];
    l.push(t.window_start_s);
    seen.set(k, l);
  }
  let dups = 0;
  for (const starts of seen.values()) {
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] - starts[i - 1] < MATCH_S) dups++;
    }
  }
  return dups;
}

function fmt(n: number): string {
  return n.toFixed(1);
}

void main();
