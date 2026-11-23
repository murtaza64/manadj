// Main-only reviewed transport. The caller supplies a shell-token-gated local
// snapshot provider, never renderer-authored payloads, database paths or URLs.
const crypto = require('node:crypto');
const { CloudFailure } = require('./policy');
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const fail = code => { throw new CloudFailure(code); };
const LIMITS = { parts: 256, partBytes: 262144, snapshotBytes: 67108864 };
class ReviewedUpload {
  constructor({ connection, prepare, clock = Date.now, makeID = crypto.randomUUID } = {}) {
    this.connection = connection; this.prepare = prepare; this.clock = clock; this.makeID = makeID;
    this.generation = 0; this.controller = null; this.snapshot = null; this.phase = 'idle'; this.error = null;
  }
  state() {
    const s = this.snapshot;
    return { phase: this.phase, error: this.error, ...(s ? { snapshotId: s.id, destination: s.destination,
      bytes: s.total, partCount: s.parts.length, rowCounts: { ...s.rowCounts }, omissions: [...s.omissions],
      reviewID: s.reviewID, reviewedSha256: s.manifestHash, expiresAt: s.expiresAt } : {}) };
  }
  active(generation) {
    if (this.generation !== generation || this.controller?.signal.aborted) fail('cloud_upload_cancelled');
  }
  async review() {
    if (['preparing', 'uploading', 'verifying'].includes(this.phase)) fail('cloud_upload_busy');
    const state = this.connection.publicState();
    if (state.phase !== 'connected' || !state.destination) fail('cloud_signin_required');
    const generation = ++this.generation, connectionGeneration = this.connection.generation;
    this.controller = new AbortController();
    this.phase = 'preparing'; this.error = null; this.snapshot = null;
    try {
      const source = await this.prepare({ signal: this.controller.signal }); this.active(generation);
      if (!source || !Array.isArray(source.parts) || !source.parts.length || source.parts.length > LIMITS.parts ||
          !source.rowCounts || typeof source.rowCounts !== 'object' || Array.isArray(source.rowCounts) ||
          !Array.isArray(source.omissions) || source.omissions.some(x => typeof x !== 'string' || x.length > 512)) fail('cloud_frozen_source_invalid');
      const { validatePart } = await import('../../cloud/library/part.mjs'); this.active(generation);
      const parts = []; let total = 0;
      for (const part of source.parts) {
        // Own a copy inaccessible to the provider and renderer after review.
        if (typeof part !== 'string') fail('cloud_frozen_source_invalid');
        let value; try { value = JSON.parse(part); } catch { fail('cloud_frozen_source_invalid'); }
        // Python preparation and JS number formatting can differ. Canonicalize
        // once here, before review/hash, then freeze only the reviewed JS bytes.
        if (part.trim() !== part) fail('cloud_frozen_source_invalid');
        const body = JSON.stringify(value), raw = Buffer.from(body, 'utf8'); total += raw.length;
        if (!raw.length || raw.length > LIMITS.partBytes || total > LIMITS.snapshotBytes) fail('cloud_snapshot_limit');
        try { validatePart(value); } catch { fail('cloud_frozen_source_invalid'); }
        parts.push({ body, raw, bytes: raw.length, sha256: hash(raw) });
      }
      // Recompute counts from exact frozen parts, do not trust provider summaries.
      const rowCounts = {};
      for (const part of parts) { const value = JSON.parse(part.body); rowCounts[value.table] = (rowCounts[value.table] || 0) + value.rows.length; }
      const id = this.makeID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) fail('cloud_frozen_source_invalid');
      const manifest = JSON.stringify({ schema: 'manadj-library-snapshot/v1', snapshotId: id,
        parts: parts.map(p => ({ bytes: p.bytes, sha256: p.sha256 })) });
      const currentConnection = this.connection.publicState();
      if (this.connection.generation !== connectionGeneration || currentConnection.phase !== 'connected' ||
          currentConnection.destination !== state.destination) fail('cloud_review_expired');
      this.snapshot = { id, parts, total, manifest, manifestHash: hash(manifest), destination: state.destination,
        rowCounts, omissions: [...source.omissions], reviewID: crypto.randomBytes(24).toString('hex'),
        connectionGeneration, expiresAt: this.clock() + 15 * 60000, receipt: null };
      this.phase = 'review'; return this.state();
    } catch (error) {
      if (generation === this.generation) { this.phase = 'failed'; this.error = error instanceof CloudFailure ? error.code : 'cloud_prepare_failed'; }
      throw error instanceof CloudFailure ? error : new CloudFailure('cloud_prepare_failed');
    }
  }
  checkReview(reviewID, digest) {
    const s = this.snapshot, connection = this.connection.publicState();
    if (!s || !['review', 'failed'].includes(this.phase) || reviewID !== s.reviewID || digest !== s.manifestHash ||
        this.clock() >= s.expiresAt || connection.phase !== 'connected' || connection.destination !== s.destination ||
        this.connection.generation !== s.connectionGeneration) fail('cloud_review_expired');
    return s;
  }
  assertReceipt(receipt, s, committed) {
    if (!receipt || receipt.schema !== 'manadj-library-snapshot/v1' || receipt.snapshotId !== s.id ||
        receipt.state !== (committed ? 'committed' : 'incomplete') || receipt.bytes !== s.total ||
        receipt.manifestSha256 !== s.manifestHash || !Array.isArray(receipt.parts) || receipt.parts.length !== s.parts.length ||
        typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))) fail('cloud_receipt_mismatch');
    receipt.parts.forEach((p, i) => {
      if (p.index !== i || p.bytes !== s.parts[i].bytes || p.sha256 !== s.parts[i].sha256 ||
          typeof p.stored !== 'boolean' || (committed && p.stored !== true)) fail('cloud_receipt_mismatch');
    });
  }
  async upload(reviewID, reviewedSha256) {
    const s = this.checkReview(reviewID, reviewedSha256), generation = ++this.generation;
    this.controller = new AbortController(); this.phase = 'uploading'; this.error = null;
    const request = async (path, options) => {
      this.active(generation);
      if (this.connection.generation !== s.connectionGeneration) fail('cloud_review_expired');
      const value = await this.connection.authenticated(path, { ...options, signal: this.controller.signal });
      this.active(generation); return value;
    };
    try {
      const started = await request('/v1/snapshots', { method: 'POST', body: s.manifest });
      // A retry after an ambiguous commit can already be committed.
      this.assertReceipt(started, s, started?.state === 'committed');
      for (let index = 0; index < s.parts.length; index++) {
        const part = s.parts[index];
        const value = await request(`/v1/snapshots/${s.id}/parts/${index}`, { method: 'PUT', body: part.body });
        if (!value || value.snapshotId !== s.id || value.index !== index || value.bytes !== part.bytes ||
            value.sha256 !== part.sha256 || value.stored !== true) fail('cloud_part_receipt_mismatch');
      }
      const receipt = await request(`/v1/snapshots/${s.id}/commit`, { method: 'POST', body: '{}' });
      this.assertReceipt(receipt, s, true); this.phase = 'verifying';
      const readReceipt = await request(`/v1/snapshots/${s.id}`, { method: 'GET' });
      this.assertReceipt(readReceipt, s, true);
      if (JSON.stringify(readReceipt) !== JSON.stringify(receipt)) fail('cloud_receipt_mismatch');
      for (let index = 0; index < s.parts.length; index++) {
        const result = await request(`/v1/snapshots/${s.id}/parts/${index}`, { method: 'GET', withBytes: true });
        const raw = result?.raw;
        if (!Buffer.isBuffer(raw) || raw.length !== s.parts[index].bytes || hash(raw) !== s.parts[index].sha256) fail('cloud_readback_mismatch');
      }
      this.active(generation); s.receipt = receipt; this.phase = 'verified'; return this.state();
    } catch (error) {
      if (generation === this.generation) { this.phase = 'failed'; this.error = error instanceof CloudFailure ? error.code : 'cloud_upload_failed'; }
      // Preserve the identical snapshot and review ID for an explicit retry. Never
      // automatically retry a mutation or prepare newer data behind the review.
      throw error instanceof CloudFailure ? error : new CloudFailure('cloud_upload_failed');
    }
  }
  cancel() {
    this.controller?.abort(); this.generation++; this.phase = this.snapshot ? 'failed' : 'idle';
    this.error = this.snapshot ? 'cloud_upload_cancelled' : null; return this.state();
  }
  clear() {
    this.controller?.abort(); this.generation++; this.snapshot = null; this.phase = 'idle'; this.error = null;
    return this.state(); // Local memory only. Never claims cloud deletion.
  }
}
module.exports = { ReviewedUpload };
