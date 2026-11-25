import { bytes, LIMITS, SCHEMA, reject, validID, validHash, integer, exact } from './contracts.mjs';
export const CONTROL_KEY = 'library-v1/control.json';
export const DELETE_BATCH_PARTS = 8;
const dayString = now => new Date(now).toISOString().slice(0, 10);
export class Ledger {
  constructor(bucket, owner, now = Date.now()) { this.bucket = bucket; this.owner = owner; this.day = dayString(now); }
  async load() {
    const object = await this.bucket.get(CONTROL_KEY);
    if (!object) return { state: { version: 1, owner: this.owner, day: this.day, writes: 0, reads: 0, snapshots: [] }, etag: null };
    if (!integer(object.size, 1, LIMITS.controlBytes)) reject(503, 'control_invalid');
    let state; try { state = JSON.parse(await object.text()); } catch { reject(503, 'control_invalid'); }
    this.validate(state);
    return { state, etag: object.etag };
  }
  validate(s) {
    if (!exact(s, ['version', 'owner', 'day', 'writes', 'reads', 'snapshots']) || s.version !== 1 || s.owner !== this.owner ||
        typeof s.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.day) ||
        !integer(s.writes, 0, LIMITS.writes) || !integer(s.reads, 0, LIMITS.reads) ||
        !Array.isArray(s.snapshots) || s.snapshots.length > LIMITS.snapshots) reject(503, 'control_invalid');
    let total = 0; const ids = new Set();
    for (const x of s.snapshots) {
      const shape = ['id', 'manifestHash', 'total', 'createdAt', 'committed', 'deleting', 'parts'];
      if (!(exact(x, shape) || exact(x, [...shape, 'deleteNext'])) ||
          (Object.hasOwn(x, 'deleteNext') && (!x.deleting || !integer(x.deleteNext, 0, x.parts?.length ?? -1))) || !validID(x.id) || ids.has(x.id) ||
          !validHash(x.manifestHash) || !integer(x.total, 1, LIMITS.snapshotBytes) ||
          typeof x.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(x.createdAt) || typeof x.committed !== 'boolean' ||
          typeof x.deleting !== 'boolean' ||
          !Array.isArray(x.parts) || !integer(x.parts.length, 1, LIMITS.parts)) reject(503, 'control_invalid');
      let partTotal = 0;
      for (const p of x.parts) {
        if (!Array.isArray(p) || p.length !== 3 || !integer(p[0], 1, LIMITS.partBytes) || !validHash(p[1]) ||
            typeof p[2] !== 'boolean' || (x.committed && !p[2])) reject(503, 'control_invalid');
        partTotal += p[0];
      }
      if (partTotal !== x.total) reject(503, 'control_invalid');
      ids.add(x.id); total += x.total;
    }
    if (total > LIMITS.storedBytes || bytes(s).length > LIMITS.controlBytes) reject(503, 'control_invalid');
  }
  async change(operation) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { state, etag } = await this.load();
      const result = operation(state);
      this.validate(state);
      const stored = await this.bucket.put(CONTROL_KEY, bytes(state), {
        onlyIf: new Headers(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${etag}"` }),
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      });
      if (stored) return result;
    }
    reject(409, 'control_busy_retry');
  }
  // Read-only counter view for /v1/status preflight; never debits or writes.
  // A day that moved on reads as zero, exactly what the next debit would see.
  async usage() {
    const { state } = await this.load();
    if (state.day !== this.day) return { day: this.day, writes: 0, reads: 0 };
    return { day: state.day, writes: state.writes, reads: state.reads };
  }
  debit(s, kind) {
    if (this.day < s.day) reject(503, 'clock_invalid');
    if (this.day !== s.day) { s.day = this.day; s.writes = 0; s.reads = 0; }
    if (s[kind] >= LIMITS[kind]) reject(429, 'daily_limit');
    s[kind]++;
  }
  async begin(manifest, hash, total, now) {
    return this.change(s => {
      this.debit(s, 'writes');
      const found = s.snapshots.find(x => x.id === manifest.snapshotId);
      if (found) {
        // A deleting snapshot can never be retried back into existence. The
        // deletion finishes and a fresh id is required for new data.
        if (found.deleting) reject(409, 'snapshot_deleting');
        if (found.manifestHash !== hash) reject(409, 'snapshot_immutable');
        return receipt(found);
      }
      if (s.snapshots.length >= LIMITS.snapshots || s.snapshots.reduce((n, x) => n + x.total, 0) + total > LIMITS.storedBytes) reject(409, 'storage_limit');
      const x = { id: manifest.snapshotId, manifestHash: hash, total, createdAt: new Date(now).toISOString(),
        committed: false, deleting: false, parts: manifest.parts.map(p => [p.bytes, p.sha256, false]) };
      s.snapshots.push(x); return receipt(x);
    });
  }
  async reservePart(id, index, size, hash) {
    return this.change(s => {
      this.debit(s, 'writes');
      const x = s.snapshots.find(x => x.id === id);
      if (!x) reject(404, 'snapshot_not_found');
      if (x.deleting) reject(409, 'snapshot_deleting');
      if (!x.parts[index]) reject(404, 'snapshot_not_found');
      const p = x.parts[index];
      if (p[0] !== size || p[1] !== hash) reject(409, 'part_immutable');
      // Identical retries remain possible after commit. No new bytes can be admitted.
      return { stored: p[2] };
    });
  }
  async markStored(id, index, size, hash) {
    return this.change(s => {
      const x = s.snapshots.find(x => x.id === id), p = x?.parts[index];
      if (x?.deleting) reject(409, 'snapshot_deleting');
      if (!p || p[0] !== size || p[1] !== hash) reject(409, 'part_immutable');
      p[2] = true; return { stored: true };
    });
  }
  async commit(id) {
    return this.change(s => {
      this.debit(s, 'writes');
      const x = s.snapshots.find(x => x.id === id);
      if (!x) reject(404, 'snapshot_not_found');
      if (x.deleting) reject(409, 'snapshot_deleting');
      if (x.parts.some(p => !p[2])) reject(409, 'snapshot_incomplete');
      x.committed = true; return receipt(x);
    });
  }
  async read(id = null, index = null) {
    return this.change(s => {
      this.debit(s, 'reads');
      if (id === null) return s.snapshots.map(x => ({ snapshotId: x.id,
        state: x.deleting ? 'deleting' : x.committed ? 'committed' : 'incomplete',
        bytes: x.total, createdAt: x.createdAt, parts: x.parts.length }));
      const x = s.snapshots.find(x => x.id === id);
      if (x?.deleting) reject(409, 'snapshot_deleting');
      if (!x || !x.committed) reject(404, 'snapshot_not_found');
      if (index !== null && !x.parts[index]) reject(404, 'part_not_found');
      return index === null ? receipt(x) : { bytes: x.parts[index][0], sha256: x.parts[index][1] };
    });
  }
  // Explicit owner deletion, phase one: tombstone the entry first so a crash
  // or concurrency race never leaves a readable snapshot with missing parts.
  async startDelete(id) {
    return this.change(s => {
      this.debit(s, 'writes');
      const x = s.snapshots.find(x => x.id === id);
      if (!x) return { found: false, parts: 0, bytes: 0 };
      const summary = { found: true, parts: x.parts.length, bytes: x.total, next: x.deleteNext ?? 0 };
      x.deleting = true; return summary;
    });
  }
  // Phase two runs only after every part object is verified absent, so the
  // reservation bytes/slots are released last and a retry can always resume.
  async finishDelete(id, verifiedThrough) {
    return this.change(s => {
      this.debit(s, 'writes');
      const at = s.snapshots.findIndex(x => x.id === id);
      if (at < 0) return { found: false };
      if (!s.snapshots[at].deleting) reject(409, 'snapshot_delete_not_started');
      const x = s.snapshots[at], next = x.deleteNext ?? 0;
      if (!integer(verifiedThrough, next, Math.min(x.parts.length, next + DELETE_BATCH_PARTS))) {
        // A concurrent delete may already have advanced farther. Never move
        // the cursor backwards or release unverified parts.
        if (!integer(verifiedThrough, 0, next)) reject(409, 'snapshot_delete_progress_invalid');
      }
      x.deleteNext = Math.max(next, verifiedThrough);
      if (x.deleteNext < x.parts.length) return { found: true, deleted: false, next: x.deleteNext };
      s.snapshots.splice(at, 1); return { found: true, deleted: true };
    });
  }
}
export function receipt(x) {
  return { schema: SCHEMA, snapshotId: x.id, state: x.deleting ? 'deleting' : x.committed ? 'committed' : 'incomplete', bytes: x.total,
    createdAt: x.createdAt, manifestSha256: x.manifestHash,
    parts: x.parts.map((p, index) => ({ index, bytes: p[0], sha256: p[1], stored: p[2] })) };
}
export const partKey = (id, index) => `library-v1/snapshots/${id}/${index}.json`;
