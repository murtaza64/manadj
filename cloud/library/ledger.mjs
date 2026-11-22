import { bytes, LIMITS, SCHEMA, reject, validID, validHash, integer, exact } from './contracts.mjs';
export const CONTROL_KEY = 'library-v1/control.json';
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
      if (!exact(x, ['id', 'manifestHash', 'total', 'createdAt', 'committed', 'parts']) || !validID(x.id) || ids.has(x.id) ||
          !validHash(x.manifestHash) || !integer(x.total, 1, LIMITS.snapshotBytes) ||
          typeof x.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(x.createdAt) || typeof x.committed !== 'boolean' ||
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
        if (found.manifestHash !== hash) reject(409, 'snapshot_immutable');
        return receipt(found);
      }
      if (s.snapshots.length >= LIMITS.snapshots || s.snapshots.reduce((n, x) => n + x.total, 0) + total > LIMITS.storedBytes) reject(409, 'storage_limit');
      const x = { id: manifest.snapshotId, manifestHash: hash, total, createdAt: new Date(now).toISOString(),
        committed: false, parts: manifest.parts.map(p => [p.bytes, p.sha256, false]) };
      s.snapshots.push(x); return receipt(x);
    });
  }
  async reservePart(id, index, size, hash) {
    return this.change(s => {
      this.debit(s, 'writes');
      const x = s.snapshots.find(x => x.id === id);
      if (!x || !x.parts[index]) reject(404, 'snapshot_not_found');
      const p = x.parts[index];
      if (p[0] !== size || p[1] !== hash) reject(409, 'part_immutable');
      // Identical retries remain possible after commit. No new bytes can be admitted.
      return { stored: p[2] };
    });
  }
  async markStored(id, index, size, hash) {
    return this.change(s => {
      const x = s.snapshots.find(x => x.id === id), p = x?.parts[index];
      if (!p || p[0] !== size || p[1] !== hash) reject(409, 'part_immutable');
      p[2] = true; return { stored: true };
    });
  }
  async commit(id) {
    return this.change(s => {
      this.debit(s, 'writes');
      const x = s.snapshots.find(x => x.id === id);
      if (!x) reject(404, 'snapshot_not_found');
      if (x.parts.some(p => !p[2])) reject(409, 'snapshot_incomplete');
      x.committed = true; return receipt(x);
    });
  }
  async read(id = null, index = null) {
    return this.change(s => {
      this.debit(s, 'reads');
      if (id === null) return s.snapshots.map(x => ({ snapshotId: x.id, state: x.committed ? 'committed' : 'incomplete',
        bytes: x.total, createdAt: x.createdAt, parts: x.parts.length }));
      const x = s.snapshots.find(x => x.id === id);
      if (!x || !x.committed) reject(404, 'snapshot_not_found');
      if (index !== null && !x.parts[index]) reject(404, 'part_not_found');
      return index === null ? receipt(x) : { bytes: x.parts[index][0], sha256: x.parts[index][1] };
    });
  }
}
export function receipt(x) {
  return { schema: SCHEMA, snapshotId: x.id, state: x.committed ? 'committed' : 'incomplete', bytes: x.total,
    createdAt: x.createdAt, manifestSha256: x.manifestHash,
    parts: x.parts.map((p, index) => ({ index, bytes: p[0], sha256: p[1], stored: p[2] })) };
}
export const partKey = (id, index) => `library-v1/snapshots/${id}/${index}.json`;
