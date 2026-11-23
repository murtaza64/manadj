const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ReviewedUpload } = require('./upload');
const { CloudFailure } = require('./policy');
const schema = 'manadj-library-snapshot/v1', id = '12345678-1234-4234-8234-123456789012';
const part = JSON.stringify({ schema, table: 'tracks', rows: [{ id: 1, title: 'Synthetic fixture', artist: 'Synthetic' }] });
const part2 = JSON.stringify({ schema, table: 'sessions', rows: [{ id: 1, uuid: 'synthetic-session' }] });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const calls = [], parts = new Map(); let manifest = null, receipt = null, prepared = 0, now = 10000, connected = true;
  const connection = { generation: 1, publicState: () => ({ phase: connected ? 'connected' : 'disconnected', destination: 'https://synthetic.example' }),
    async authenticated(path, options) {
      calls.push({ path, ...options });
      if (options.signal.aborted) throw new CloudFailure('cloud_operation_cancelled');
      if (path === '/v1/snapshots') {
        manifest = JSON.parse(options.body);
        receipt ??= { schema, snapshotId: manifest.snapshotId, state: 'incomplete', bytes: manifest.parts.reduce((n, p) => n + p.bytes, 0),
          createdAt: '2026-11-22T22:00:00Z', manifestSha256: hash(options.body), parts: manifest.parts.map((p, index) => ({ index, ...p, stored: false })) };
        return structuredClone(receipt);
      }
      const match = /\/parts\/(\d+)$/.exec(path);
      if (match) {
        const index = Number(match[1]);
        if (options.method === 'PUT') {
          if (parts.has(index)) assert.equal(parts.get(index), options.body);
          parts.set(index, options.body); receipt.parts[index].stored = true;
          return { snapshotId: manifest.snapshotId, index, bytes: Buffer.byteLength(options.body), sha256: hash(options.body), stored: true };
        }
        return { raw: Buffer.from(parts.get(index)), value: JSON.parse(parts.get(index)) };
      }
      if (path.endsWith('/commit')) { assert.ok(receipt.parts.every(p => p.stored)); receipt.state = 'committed'; }
      return structuredClone(receipt);
    } };
  const source = { parts: [part, part2], rowCounts: { intentionally_wrong: 999 }, omissions: ['No audio, secrets, paths or peer projections'] };
  const upload = new ReviewedUpload({ connection, prepare: async () => { prepared++; return source; }, clock: () => now, makeID: () => id });
  return { upload, connection, source, calls, parts, advance: n => { now += n; }, getPrepared: () => prepared, disconnect: () => { connected = false; connection.generation++; } };
}
test('review freezes and validates local metadata, computes exact byte totals/counts, makes no cloud request', async () => {
  const f = fixture(), state = await f.upload.review();
  assert.equal(state.phase, 'review'); assert.equal(state.snapshotId, id);
  assert.equal(state.bytes, Buffer.byteLength(part) + Buffer.byteLength(part2)); assert.equal(state.partCount, 2);
  assert.deepEqual(state.rowCounts, { tracks: 1, sessions: 1 }); assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(state).includes('Synthetic fixture'));
  assert.ok(!JSON.stringify(state).includes('synthetic-session'));
  f.source.parts[0] = 'changed'; f.source.omissions.push('changed');
  assert.equal(f.upload.state().omissions.length, 1);
  await f.upload.upload(state.reviewID, state.reviewedSha256); assert.equal(f.parts.get(0), part);
});
test('only exact reviewed snapshot can upload, then commit and both receipt/part readbacks verify', async () => {
  const f = fixture(), state = await f.upload.review();
  const result = await f.upload.upload(state.reviewID, state.reviewedSha256);
  assert.equal(result.phase, 'verified'); assert.equal(result.snapshotId, state.snapshotId);
  assert.deepEqual(f.calls.map(x => x.method), ['POST', 'PUT', 'PUT', 'POST', 'GET', 'GET', 'GET']);
  assert.ok(f.calls.every(x => x.signal instanceof AbortSignal));
  await assert.rejects(f.upload.upload(state.reviewID, state.reviewedSha256), { code: 'cloud_review_expired' });
});
test('review ID/digest mismatch, expiry, disconnected account and generation change prevent any write', async () => {
  for (const mode of ['id', 'digest', 'expiry', 'disconnect', 'generation']) {
    const f = fixture(), state = await f.upload.review();
    if (mode === 'expiry') f.advance(15 * 60000);
    if (mode === 'disconnect') f.disconnect();
    if (mode === 'generation') f.connection.generation++;
    await assert.rejects(f.upload.upload(mode === 'id' ? 'bad' : state.reviewID, mode === 'digest' ? 'bad' : state.reviewedSha256), { code: 'cloud_review_expired' });
    assert.equal(f.calls.length, 0);
  }
});
test('new review invalidates prior review and never silently re-exports during Upload', async () => {
  const f = fixture(), first = await f.upload.review(), second = await f.upload.review();
  assert.notEqual(first.reviewID, second.reviewID);
  await assert.rejects(f.upload.upload(first.reviewID, first.reviewedSha256), { code: 'cloud_review_expired' });
  await f.upload.upload(second.reviewID, second.reviewedSha256); assert.equal(f.getPrepared(), 2);
});
test('raw audio/bad schema, oversized parts and invalid provider summary are rejected visibly', async () => {
  for (const mutation of [s => { s.parts = ['binary-audio']; }, s => { s.parts = [JSON.stringify({ schema, table: 'settings', rows: [{ secret: 'x' }] })]; },
    s => { s.parts = [JSON.stringify({ schema, table: 'tracks', rows: [{ path: '/Users/example/music.mp3' }] })]; },
    s => { s.parts = [part + ' ']; }, s => { s.parts = Array(257).fill(part); }, s => { s.parts = ['x'.repeat(262145)]; },
    s => { s.rowCounts = null; }, s => { s.omissions = ['x'.repeat(513)]; }]) {
    const f = fixture(); mutation(f.source);
    await assert.rejects(f.upload.review(), err => ['cloud_frozen_source_invalid', 'cloud_snapshot_limit'].includes(err.code));
    assert.equal(f.calls.length, 0); assert.equal(f.upload.state().phase, 'failed');
  }
});
test('changed begin/part/commit/read-receipt values fail, never mark verified', async () => {
  for (const stage of ['begin', 'part', 'commit', 'read']) {
    const f = fixture(), reviewed = await f.upload.review(), request = f.connection.authenticated;
    f.connection.authenticated = async (path, options) => {
      const value = await request(path, options);
      if (stage === 'begin' && path === '/v1/snapshots') value.manifestSha256 = 'a'.repeat(64);
      if (stage === 'part' && options.method === 'PUT') value.sha256 = 'b'.repeat(64);
      if (stage === 'commit' && path.endsWith('/commit')) value.parts[0].stored = false;
      if (stage === 'read' && options.method === 'GET' && !path.includes('/parts/')) value.createdAt = '2026-11-22T22:00:01Z';
      return value;
    };
    await assert.rejects(f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256)); assert.equal(f.upload.state().phase, 'failed');
  }
});
test('changed downloaded bytes fail independent client SHA256 even with matching parsed values', async () => {
  const f = fixture(), reviewed = await f.upload.review(), request = f.connection.authenticated;
  f.connection.authenticated = async (path, options) => {
    const value = await request(path, options);
    if (options.method === 'GET' && path.includes('/parts/')) value.raw = Buffer.from(part + ' ');
    return value;
  };
  await assert.rejects(f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256), { code: 'cloud_readback_mismatch' });
  assert.equal(f.upload.state().phase, 'failed');
});
test('partial network failure preserves exact snapshot for explicit retry, no automatic mutation replay', async () => {
  const f = fixture(), reviewed = await f.upload.review(), request = f.connection.authenticated; let fail = true;
  f.connection.authenticated = async (path, options) => {
    if (path.endsWith('/parts/1') && options.method === 'PUT' && fail) { fail = false; throw new Error('private diagnostic'); }
    return request(path, options);
  };
  await assert.rejects(f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256), { code: 'cloud_upload_failed' });
  assert.equal(f.calls.filter(x => x.path.endsWith('/parts/0') && x.method === 'PUT').length, 1);
  const failed = f.upload.state(); assert.equal(failed.snapshotId, reviewed.snapshotId); assert.equal(failed.reviewedSha256, reviewed.reviewedSha256);
  assert.equal((await f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256)).phase, 'verified');
  assert.equal(f.getPrepared(), 1); assert.equal(f.calls.filter(x => x.path === '/v1/snapshots').length, 2);
  assert.equal(f.calls.filter(x => x.path === '/v1/snapshots')[0].body, f.calls.filter(x => x.path === '/v1/snapshots')[1].body);
});
test('ambiguous committed success can be retried with identical frozen bytes and verified', async () => {
  const f = fixture(), reviewed = await f.upload.review(), request = f.connection.authenticated; let fail = true;
  f.connection.authenticated = async (path, options) => {
    const value = await request(path, options);
    if (path.endsWith('/commit') && fail) { fail = false; throw new Error('lost response'); }
    return value;
  };
  await assert.rejects(f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256));
  assert.equal((await f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256)).phase, 'verified');
});
test('cancel during prepare prevents stale review from becoming available', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.upload.prepare = async () => { entered.resolve(); await release.promise; return f.source; };
  const work = f.upload.review(); await entered.promise; f.upload.cancel(); release.resolve();
  await assert.rejects(work, { code: 'cloud_upload_cancelled' }); assert.equal(f.upload.state().phase, 'idle'); assert.equal(f.calls.length, 0);
});
test('cancel during upload preserves failed review without marking success or deleting anything', async () => {
  const f = fixture(), reviewed = await f.upload.review(), entered = deferred(), release = deferred(), request = f.connection.authenticated;
  f.connection.authenticated = async (path, options) => { if (options.method === 'PUT') { entered.resolve(); await release.promise; } return request(path, options); };
  const work = f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256); await entered.promise;
  f.upload.cancel(); release.resolve(); await assert.rejects(work);
  assert.equal(f.upload.state().phase, 'failed'); assert.equal(f.upload.state().snapshotId, reviewed.snapshotId);
  assert.ok(!f.calls.some(x => x.method === 'DELETE')); assert.ok(!f.calls.some(x => x.path.endsWith('/commit')));
});
test('local clear removes review memory, not cloud objects or connection', async () => {
  const f = fixture(), reviewed = await f.upload.review(); await f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256);
  const calls = f.calls.length; assert.deepEqual(f.upload.clear(), { phase: 'idle', error: null });
  assert.equal(f.calls.length, calls); assert.equal(f.parts.size, 2); assert.equal(f.connection.publicState().phase, 'connected');
});
test('connection replacement during preparation invalidates review before any upload', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.upload.prepare = async () => { entered.resolve(); await release.promise; return f.source; };
  const work = f.upload.review(); await entered.promise; f.connection.generation++; release.resolve();
  await assert.rejects(work, { code: 'cloud_review_expired' });
  assert.equal(f.upload.state().phase, 'failed'); assert.equal(f.upload.state().snapshotId, undefined);
  assert.equal(f.calls.length, 0);
});
test('concurrent upload is rejected without duplicating mutations', async () => {
  const f = fixture(), reviewed = await f.upload.review(), entered = deferred(), release = deferred(), request = f.connection.authenticated;
  f.connection.authenticated = async (path, options) => {
    if (path === '/v1/snapshots') { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  const work = f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256); await entered.promise;
  await assert.rejects(f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256), { code: 'cloud_review_expired' });
  release.resolve(); assert.equal((await work).phase, 'verified');
  assert.equal(f.calls.filter(c => c.path === '/v1/snapshots').length, 1);
});
test('cancel during readback never reports verified and preserves exact retry', async () => {
  const f = fixture(), reviewed = await f.upload.review(), entered = deferred(), release = deferred(), request = f.connection.authenticated;
  f.connection.authenticated = async (path, options) => {
    if (options.method === 'GET' && path.includes('/parts/')) { entered.resolve(); await release.promise; }
    return request(path, options);
  };
  const work = f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256); await entered.promise;
  f.upload.cancel(); release.resolve(); await assert.rejects(work);
  assert.equal(f.upload.state().phase, 'failed'); assert.equal(f.upload.state().reviewID, reviewed.reviewID);
  assert.ok(!f.calls.some(c => c.method === 'DELETE'));
  f.connection.authenticated = request;
  assert.equal((await f.upload.upload(reviewed.reviewID, reviewed.reviewedSha256)).phase, 'verified');
});
