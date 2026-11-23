import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { LIMITS, SCHEMA, bytes, digest, readJSON, validateManifest, authorizeOwner } from './contracts.mjs';
import { createHandler } from './worker.mjs';
import { Bucket } from './test_bucket.mjs';
import { Ledger, CONTROL_KEY, partKey } from './ledger.mjs';
import { validatePart } from './part.mjs';
const ORIGIN = 'https://library.example.test', ID = '12345678-1234-4234-8234-123456789012';
const ID2 = '22345678-1234-4234-8234-123456789012', NOW = Date.parse('2026-11-22T18:00:00Z');
function fixture() {
  const bucket = new Bucket(), env = { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: bucket };
  const handler = createHandler({ authorize: async request => {
    if (request.headers.get('authorization') !== 'Bearer synthetic-test') throw Object.assign(new Error(), {});
    return { sub: 'synthetic-owner' };
  }, clock: () => NOW });
  const call = (path, method = 'GET', value, headers = {}) => handler(new Request(ORIGIN + path, { method,
    headers: { authorization: 'Bearer synthetic-test', ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(value === undefined ? {} : { body: typeof value === 'string' ? value : JSON.stringify(value) }) }), env);
  return { bucket, env, handler, call };
}
const part = (title = 'Synthetic track') => ({ schema: SCHEMA, table: 'tracks', rows: [{ id: 1, title, artist: 'Synthetic artist' }] });
async function manifest(id = ID, values = [part()]) {
  return { schema: SCHEMA, snapshotId: id, parts: await Promise.all(values.map(async v => ({ bytes: bytes(v).length, sha256: await digest(bytes(v)) }))) };
}
async function prepare(f, values = [part()], id = ID) {
  const m = await manifest(id, values); assert.equal((await f.call('/v1/snapshots', 'POST', m)).status, 201); return m;
}
async function complete(f, values = [part()], id = ID) {
  const m = await prepare(f, values, id);
  for (let index = 0; index < values.length; index++) assert.equal((await f.call(`/v1/snapshots/${id}/parts/${index}`, 'PUT', values[index])).status, 200);
  assert.equal((await f.call(`/v1/snapshots/${id}/commit`, 'POST', {})).status, 200); return m;
}
test('default and false disabled switch never calls authorization, storage or consumes a request body', async () => {
  for (const setting of [undefined, 'false', true, 'TRUE']) {
    const f = fixture(); f.env.SNAPSHOTS_ENABLED = setting;
    f.env.LIBRARY_BUCKET = new Proxy({}, { get() { throw new Error('storage touched'); } });
    const handler = createHandler({ authorize() { throw new Error('authorization touched'); } });
    const result = await handler(new Request(ORIGIN + '/v1/snapshots', { method: 'POST', body: 'not-json' }), f.env);
    assert.equal(result.status, 503); assert.equal((await result.json()).error, 'snapshots_disabled');
  }
});
test('disabled status verifies owner without touching R2', async () => {
  const f = fixture(); f.env.SNAPSHOTS_ENABLED = 'false';
  assert.deepEqual(await (await f.call('/v1/status')).json(), { authenticated: true, snapshotsEnabled: false, limits: LIMITS, usage: null });
  assert.equal(f.bucket.calls.length, 0);
});
test('complete frozen parts, exact retry, immutable receipt and byte-identical readback', async () => {
  const f = fixture(), values = [part(), { schema: SCHEMA, table: 'session_chunks', rows: [{ id: 1, events_json: [{ t: 1, kind: 'load', trackId: 1 }] }] }];
  const m = await complete(f, values);
  const first = await f.call(`/v1/snapshots/${ID}`), etag = first.headers.get('etag'), receipt = await first.json();
  assert.equal(receipt.state, 'committed'); assert.equal(receipt.manifestSha256, await digest(bytes(m)));
  assert.equal(receipt.bytes, m.parts.reduce((n, p) => n + p.bytes, 0));
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', values[0])).status, 200);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part('changed'))).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).headers.get('etag'), etag);
  assert.deepEqual(await (await f.call(`/v1/snapshots/${ID}`)).json(), receipt);
  for (let i = 0; i < values.length; i++) {
    const result = await f.call(`/v1/snapshots/${ID}/parts/${i}`);
    assert.equal(result.status, 200); assert.equal(await result.text(), JSON.stringify(values[i]));
    assert.equal(result.headers.get('access-control-allow-origin'), null);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});
test('incomplete reservations consume slots and bytes, cannot commit or read', async () => {
  const f = fixture(); await prepare(f);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}`)).status, 404);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`)).status, 404);
  const data = await (await f.call('/v1/snapshots')).json();
  assert.equal(data.snapshots[0].state, 'incomplete'); assert.ok(data.snapshots[0].bytes > 0);
});
test('manifest retry same id is idempotent; changed manifest cannot reserve new data', async () => {
  const f = fixture(), m = await prepare(f);
  assert.equal((await f.call('/v1/snapshots', 'POST', m)).status, 201);
  assert.equal((await f.call('/v1/snapshots', 'POST', await manifest(ID, [part('changed')]))).status, 409);
  assert.equal((await (await f.call('/v1/snapshots')).json()).snapshots.length, 1);
});
test('one final snapshot slot under racing independent handlers is atomic', async () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) await prepare(f, [part()], `${'f2345678'}-1234-4234-8234-1234567890${i.toString().padStart(2, '0')}`);
  const results = await Promise.all([f.call('/v1/snapshots', 'POST', await manifest(ID)), f.call('/v1/snapshots', 'POST', await manifest(ID2))]);
  assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
  assert.equal((await (await f.call('/v1/snapshots')).json()).snapshots.length, 10);
});
test('concurrent identical part requests cannot overwrite one another', async () => {
  const f = fixture(); await prepare(f);
  const results = await Promise.all(Array.from({ length: 2 }, () => f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())));
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 200);
  assert.equal((await f.bucket.get(partKey(ID, 0))).size, bytes(part()).length);
});
test('failed part put retains reservation and never marks stored', async () => {
  const f = fixture(); await prepare(f);
  f.bucket.hook = async key => { if (key !== CONTROL_KEY) throw new Error('synthetic failure'); };
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 503);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 409);
  const { state } = await new Ledger(f.bucket, 'synthetic-owner', NOW).load();
  assert.equal(state.snapshots.length, 1); assert.equal(state.snapshots[0].parts[0][2], false);
});
test('lost acknowledgement after object commit reconciles exact existing bytes on retry', async () => {
  const f = fixture(); await prepare(f);
  const original = f.bucket.put.bind(f.bucket); let fail = true;
  f.bucket.put = async (key, value, options) => {
    const result = await original(key, value, options);
    if (key !== CONTROL_KEY && fail) { fail = false; throw new Error('synthetic lost response'); }
    return result;
  };
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 503);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 200);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 200);
});
test('conflicting object after ambiguous write is not adopted', async () => {
  const f = fixture(); await prepare(f);
  await f.bucket.put(partKey(ID, 0), bytes(part('foreign')), { onlyIf: new Headers({ 'if-none-match': '*' }), customMetadata: {} });
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 409);
});
test('readback detects corruption or disappearance, never returns mismatched data', async () => {
  const f = fixture(); await complete(f);
  f.bucket.objects.get(partKey(ID, 0)).raw[5] ^= 1;
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`)).status, 503);
  f.bucket.objects.delete(partKey(ID, 0));
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`)).status, 503);
});
test('persistent daily write/read limits survive new Ledger instances and reset only forward UTC', async () => {
  const f = fixture(), m = await manifest();
  await new Ledger(f.bucket, 'synthetic-owner', NOW).begin(m, await digest(bytes(m)), m.parts[0].bytes, NOW);
  const control = f.bucket.objects.get(CONTROL_KEY), state = JSON.parse(new TextDecoder().decode(control.raw));
  state.writes = 511; state.reads = 4095; control.raw = bytes(state);
  assert.equal((await f.call('/v1/snapshots', 'POST', m)).status, 201);
  assert.equal((await f.call('/v1/snapshots', 'POST', m)).status, 429);
  assert.equal((await f.call('/v1/snapshots')).status, 200);
  assert.equal((await f.call('/v1/snapshots')).status, 429);
  await assert.rejects(() => new Ledger(f.bucket, 'synthetic-owner', NOW - 86400000).read(), /clock_invalid/);
  await new Ledger(f.bucket, 'synthetic-owner', NOW + 86400000).read();
  const next = await new Ledger(f.bucket, 'synthetic-owner', NOW + 86400000).load();
  assert.equal(next.state.reads, 1); assert.equal(next.state.writes, 0); assert.equal(next.state.snapshots.length, 1);
});
test('bounded CAS contention returns retryable failure without unbounded loops', async () => {
  const f = fixture(); f.bucket.put = async () => null;
  assert.equal((await f.call('/v1/snapshots', 'POST', await manifest())).status, 409);
  assert.equal(f.bucket.calls.length, 3); // three reads, with fake put deliberately not recording
});
test('corrupt, oversize and foreign-owner control state fail closed', async () => {
  for (const mode of ['corrupt', 'large', 'foreign']) {
    const f = fixture(); await prepare(f);
    const obj = f.bucket.objects.get(CONTROL_KEY);
    if (mode === 'corrupt') obj.raw = new TextEncoder().encode('{');
    if (mode === 'large') obj.raw = new Uint8Array(LIMITS.controlBytes + 1);
    if (mode === 'foreign') { const x = JSON.parse(new TextDecoder().decode(obj.raw)); x.owner = 'other'; obj.raw = bytes(x); }
    assert.equal((await f.call('/v1/snapshots')).status, 503);
  }
});
test('strict routes, methods and browser Origin never write data', async () => {
  const f = fixture(); await complete(f); const count = f.bucket.calls.length;
  for (const path of ['/v1/snapshots?all=1', `/v1/snapshots/${ID}/parts/00`, `/v1/snapshots/${ID}/parts/256`, '/anything']) assert.equal((await f.call(path)).status, 404);
  assert.equal((await f.call('/v1/snapshots', 'DELETE')).status, 405);
  assert.equal((await f.call('/v1/snapshots', 'OPTIONS')).status, 405);
  assert.equal((await f.call('/v1/snapshots', 'POST', await manifest(), { origin: 'https://hostile.invalid' })).status, 403);
  assert.equal(f.bucket.calls.length, count);
});
test('raw JSON only, byte limits, bad UTF8, duplicate keys and alternate JSON fail', async () => {
  const req = (body, headers = {}) => new Request(ORIGIN, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  await assert.rejects(() => readJSON(req('{}', { 'content-encoding': 'gzip' })), /raw_json_required/);
  await assert.rejects(() => readJSON(req('{}', { 'content-type': 'application/zip' })), /raw_json_required/);
  await assert.rejects(() => readJSON(req('x'.repeat(LIMITS.partBytes + 1))), /body_limit/);
  await assert.rejects(() => readJSON(req('{}', { 'content-length': '999999' })), /body_limit/);
  await assert.rejects(() => readJSON(req('{}', { 'content-length': '1' })), /body_length/);
  await assert.rejects(() => readJSON(req(new Uint8Array([0xff]))), /json_invalid/);
  for (const body of ['{ "a":1}', '{"a":1,"a":2}', '{"a":1e999}', '{"a":1}\n']) await assert.rejects(() => readJSON(req(body)), /canonical_json_required/);
});
test('bounded stream reader cancels chunked overflow without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(LIMITS.partBytes)); }, cancel() { cancelled = true; } });
  const req = new Request(ORIGIN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' });
  await assert.rejects(() => readJSON(req), /body_limit/); assert.equal(cancelled, true);
});
test('manifest boundaries and unknown fields fail rather than truncate or expand', async () => {
  const m = await manifest(); assert.ok(validateManifest(m));
  for (const bad of [{ ...m, audio: 'x' }, { ...m, parts: [] }, { ...m, snapshotId: '../x' },
    { ...m, parts: Array(257).fill(m.parts[0]) }, { ...m, parts: [{ bytes: LIMITS.partBytes + 1, sha256: 'a'.repeat(64) }] }]) assert.throws(() => validateManifest(bad));
  assert.equal(validateManifest({ ...m, parts: Array(256).fill({ bytes: LIMITS.partBytes, sha256: 'a'.repeat(64) }) }), LIMITS.snapshotBytes);
});
test('metadata DTO rejects audio, paths, settings, peer tables, unknown structured strings and deep JSON', () => {
  validatePart(part());
  for (const value of [ { ...part(), table: 'peer_history' }, { ...part(), audio: 'x' },
    { ...part(), rows: [{ id: 1, path: '/Users/example/music.mp3' }] }, { ...part(), rows: [{ id: 1, title: '/Users/example/music.mp3' }] },
    { schema: SCHEMA, table: 'session_chunks', rows: [{ events_json: [{ kind: 'https://outside.invalid' }] }] },
    { schema: SCHEMA, table: 'session_chunks', rows: [{ events_json: { password: 'x' } }] } ]) assert.throws(() => validatePart(value));
  let nested = 1; for (let i = 0; i < 20; i++) nested = [nested];
  assert.throws(() => validatePart({ schema: SCHEMA, table: 'session_chunks', rows: [{ events_json: nested }] }), /structured_metadata_limit/);
});

const AUD = 'a'.repeat(64), ISSUER = 'https://synthetic-team.cloudflareaccess.com';
const ownerConfig = { ACCESS_ISSUER: ISSUER, ACCESS_AUD: AUD, OWNER_EMAIL: 'owner@example.test' };
const pair = await generateKeyPair('RS256');
async function token(overrides = {}, header = {}) {
  return new SignJWT({ email: ownerConfig.OWNER_EMAIL, type: 'app', sub: 'synthetic-owner', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key', typ: 'JWT', ...header }).setIssuer(overrides.iss || ISSUER)
    .setAudience(overrides.aud || [AUD]).setIssuedAt(overrides.iat ?? Math.floor(NOW / 1000) - 1)
    .setNotBefore(overrides.nbf ?? Math.floor(NOW / 1000) - 1).setExpirationTime(overrides.exp ?? Math.floor(NOW / 1000) + 900).sign(pair.privateKey);
}
const assertAuth = jwt => authorizeOwner(new Request(ORIGIN, { headers: { 'cf-access-jwt-assertion': jwt } }), ownerConfig,
  { keyResolver: pair.publicKey, now: NOW });
test('signed owner application assertion accepted; opaque native Bearer alone is not an assertion', async () => {
  assert.deepEqual(await assertAuth(await token()), { sub: 'synthetic-owner' });
  await assert.rejects(() => authorizeOwner(new Request(ORIGIN, { headers: { authorization: 'Bearer oauth:synthetic' } }), ownerConfig,
    { keyResolver: pair.publicKey, now: NOW }), /owner_auth_required/);
});
test('wrong owner/audience/issuer, expired/future, service/global assertions and header URLs fail closed', async () => {
  for (const overrides of [{ email: 'other@example.test' }, { aud: ['b'.repeat(64)] }, { iss: 'https://other.cloudflareaccess.com' },
    { exp: Math.floor(NOW / 1000) - 1 }, { nbf: Math.floor(NOW / 1000) + 1 }, { iat: Math.floor(NOW / 1000) + 1 },
    { sub: '' }, { type: 'org' }, { common_name: 'synthetic-service' }]) {
    const jwt = await token(overrides); await assert.rejects(() => assertAuth(jwt), /owner_auth_required/);
  }
  for (const header of [{ jku: 'https://hostile.invalid/keys' }, { kid: '' }, { x5u: 'https://hostile.invalid/cert' }]) {
    const jwt = await token({}, header); await assert.rejects(() => assertAuth(jwt), /owner_auth_required/);
  }
});
test('signature tampering, missing owner config and attacker issuer configuration are rejected', async () => {
  const jwt = await token(); await assert.rejects(() => assertAuth(jwt.slice(0, -10) + 'AAAAAAAAAA'), /owner_auth_required/);
  for (const env of [{ ...ownerConfig, OWNER_EMAIL: '' }, { ...ownerConfig, ACCESS_ISSUER: 'https://hostile.invalid' }, { ...ownerConfig, ACCESS_AUD: '' }])
    await assert.rejects(() => authorizeOwner(new Request(ORIGIN), env, { keyResolver: pair.publicKey, now: NOW }), /owner_configuration_missing/);
});

test('real signed non-owner/missing assertion are denied before R2 on all routes', async () => {
  const f = fixture(); Object.assign(f.env, ownerConfig);
  const handler = createHandler({ authorize: (req, env) => authorizeOwner(req, env, { keyResolver: pair.publicKey, now: NOW }), clock: () => NOW });
  for (const assertion of [null, await token({ email: 'other@example.test' })]) {
    for (const path of ['/v1/status', '/v1/snapshots', `/v1/snapshots/${ID}`, `/v1/snapshots/${ID}/parts/0`, `/v1/snapshots/${ID}/commit`]) {
      const result = await handler(new Request(ORIGIN + path, { headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {} }), f.env);
      assert.equal(result.status, 401); assert.equal((await result.json()).error, 'owner_auth_required');
    }
  }
  assert.equal(f.bucket.calls.length, 0);
});
test('required claim omissions and algorithm substitution fail authentication', async () => {
  const payload = { iss: ISSUER, aud: [AUD], exp: Math.floor(NOW / 1000) + 900, iat: Math.floor(NOW / 1000) - 1,
    nbf: Math.floor(NOW / 1000) - 1, email: ownerConfig.OWNER_EMAIL, sub: 'synthetic-owner', type: 'app' };
  for (const missing of Object.keys(payload)) {
    const p = { ...payload }; delete p[missing];
    const jwt = await new SignJWT(p).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(pair.privateKey);
    await assert.rejects(() => assertAuth(jwt), /owner_auth_required/);
  }
  const jwt = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256', kid: 'synthetic-key' }).sign(new Uint8Array(32));
  await assert.rejects(() => assertAuth(jwt), /owner_auth_required/);
});
test('two competing last daily admissions cannot exceed either quota', async () => {
  for (const kind of ['writes', 'reads']) {
    const f = fixture(), m = await prepare(f);
    const obj = f.bucket.objects.get(CONTROL_KEY), state = JSON.parse(new TextDecoder().decode(obj.raw));
    state[kind] = LIMITS[kind] - 1; obj.raw = bytes(state);
    const results = await Promise.all(Array.from({ length: 2 }, () => kind === 'writes' ? f.call('/v1/snapshots', 'POST', m) : f.call('/v1/snapshots')));
    assert.deepEqual(results.map(r => r.status).sort(), kind === 'writes' ? [201, 429] : [200, 429]);
    const final = await new Ledger(f.bucket, 'synthetic-owner', NOW).load(); assert.equal(final.state[kind], LIMITS[kind]);
  }
});
test('all ten maximum-size incomplete snapshots fit bounded control, eleventh fails', async () => {
  const bucket = new Bucket();
  for (let i = 0; i < 10; i++) {
    const id = `f2345678-1234-4234-8234-1234567890${i.toString().padStart(2, '0')}`;
    const m = { schema: SCHEMA, snapshotId: id, parts: Array.from({ length: 256 }, () => ({ bytes: LIMITS.partBytes, sha256: 'a'.repeat(64) })) };
    await new Ledger(bucket, 'synthetic-owner', NOW).begin(m, await digest(bytes(m)), validateManifest(m), NOW);
  }
  const ledger = new Ledger(bucket, 'synthetic-owner', NOW), { state } = await ledger.load();
  assert.equal(state.snapshots.reduce((n, x) => n + x.total, 0), LIMITS.storedBytes);
  assert.ok(bytes(state).length < LIMITS.controlBytes); assert.ok(bytes(state).length < 300000);
  const m = await manifest(); await assert.rejects(() => ledger.begin(m, 'b'.repeat(64), validateManifest(m), NOW), /storage_limit/);
  assert.equal((await ledger.load()).state.snapshots.length, 10);
});
test('exact byte boundary accepted, byte over rejected and UTF8 BOM rejected', async () => {
  const body = JSON.stringify({ a: 'x'.repeat(LIMITS.partBytes - 8) }); assert.equal(new TextEncoder().encode(body).length, LIMITS.partBytes);
  const req = value => new Request(ORIGIN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: value });
  assert.equal((await readJSON(req(body))).raw.length, LIMITS.partBytes);
  await assert.rejects(() => readJSON(req(body + ' ')), /body_limit/);
  await assert.rejects(() => readJSON(req(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))), /json_invalid/);
});
test('missing storage binding and changed direct origin fail without storage access', async () => {
  const f = fixture(); delete f.env.LIBRARY_BUCKET;
  assert.equal((await f.call('/v1/snapshots')).status, 503);
  f.env.LIBRARY_ORIGIN = 'https://different.example.test';
  assert.equal((await f.call('/v1/snapshots')).status, 404);
  assert.equal(f.bucket.calls.length, 0);
});
test('a lost control finalization never falsely commits and exact retry can finish', async () => {
  const f = fixture(); await prepare(f);
  let failMark = true;
  f.bucket.hook = async (key, value) => {
    if (key === CONTROL_KEY && failMark) {
      const s = JSON.parse(new TextDecoder().decode(value));
      if (s.snapshots[0].parts[0][2]) { failMark = false; throw new Error('synthetic mark failure'); }
    }
  };
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 503);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', part())).status, 200);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 200);
});
test('metadata traversal budget is shared across rows and fields', () => {
  const value = { schema: SCHEMA, table: 'session_chunks', rows: Array.from({ length: 6 }, () => ({ events_json: Array(4000).fill(0) })) };
  assert.throws(() => validatePart(value), /structured_metadata_limit/);
});

test('explicit deletion removes a committed snapshot, verifies absence and is idempotent on retry', async () => {
  const f = fixture(), values = [part(), { schema: SCHEMA, table: 'session_chunks', rows: [{ id: 1, events_json: [{ t: 1, kind: 'load', trackId: 1 }] }] }];
  await complete(f, values);
  const result = await f.call(`/v1/snapshots/${ID}`, 'DELETE');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { snapshotId: ID, deleted: true, parts: 2, bytes: values.reduce((n, v) => n + bytes(v).length, 0) });
  assert.equal(await f.bucket.get(partKey(ID, 0)), null); assert.equal(await f.bucket.get(partKey(ID, 1)), null);
  assert.deepEqual((await (await f.call('/v1/snapshots')).json()).snapshots, []);
  assert.equal((await f.call(`/v1/snapshots/${ID}`)).status, 404);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`)).status, 404);
  const retry = await f.call(`/v1/snapshots/${ID}`, 'DELETE');
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), { snapshotId: ID, deleted: true, parts: 0, bytes: 0 });
  const { state } = await new Ledger(f.bucket, 'synthetic-owner', NOW).load();
  assert.equal(state.snapshots.length, 0); assert.equal(state.writes, 7);
});
test('deletion releases an incomplete reservation and never touches other snapshots', async () => {
  const f = fixture(); await prepare(f); await complete(f, [part()], ID2);
  const result = await f.call(`/v1/snapshots/${ID}`, 'DELETE');
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { snapshotId: ID, deleted: true, parts: 1, bytes: bytes(part()).length });
  const list = (await (await f.call('/v1/snapshots')).json()).snapshots;
  assert.equal(list.length, 1); assert.equal(list[0].snapshotId, ID2); assert.equal(list[0].state, 'committed');
  assert.ok(await f.bucket.get(partKey(ID2, 0)));
});
test('interrupted deletion resumes as deleting, rejects every other operation and finishes on retry', async () => {
  const f = fixture(), values = [part(), part('second')]; await complete(f, values);
  let armed = true;
  f.bucket.hook = async (key, _value, options) => { if (armed && options?.delete && key === partKey(ID, 1)) { armed = false; throw new Error('synthetic interruption'); } };
  assert.equal((await f.call(`/v1/snapshots/${ID}`, 'DELETE')).status, 503);
  assert.ok(await f.bucket.get(partKey(ID, 1)), 'failed part delete leaves object for retry');
  const list = (await (await f.call('/v1/snapshots')).json()).snapshots;
  assert.equal(list[0].state, 'deleting');
  assert.equal((await f.call(`/v1/snapshots/${ID}`)).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`)).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/parts/0`, 'PUT', values[0])).status, 409);
  assert.equal((await f.call(`/v1/snapshots/${ID}/commit`, 'POST', {})).status, 409);
  assert.equal((await f.call('/v1/snapshots', 'POST', await manifest(ID, values))).status, 409);
  const retry = await f.call(`/v1/snapshots/${ID}`, 'DELETE');
  assert.equal(retry.status, 200);
  assert.deepEqual((await (await f.call('/v1/snapshots')).json()).snapshots, []);
  assert.equal(await f.bucket.get(partKey(ID, 0)), null); assert.equal(await f.bucket.get(partKey(ID, 1)), null);
});
test('deletion fails closed when readback still shows a part object', async () => {
  const f = fixture(); await complete(f);
  const original = f.bucket.delete.bind(f.bucket); let sabotaged = true;
  f.bucket.delete = async key => { await original(key); if (sabotaged) { const m = await manifest(ID, [part()]);
    await f.bucket.put(key, bytes(part()), { onlyIf: new Headers() , customMetadata: { sha256: m.parts[0].sha256 } }); sabotaged = false; } };
  assert.equal((await f.call(`/v1/snapshots/${ID}`, 'DELETE')).status, 503);
  const list = (await (await f.call('/v1/snapshots')).json()).snapshots;
  assert.equal(list[0].state, 'deleting');
  assert.equal((await f.call(`/v1/snapshots/${ID}`, 'DELETE')).status, 200);
  assert.deepEqual((await (await f.call('/v1/snapshots')).json()).snapshots, []);
});
test('deletion is owner-gated and disabled-gated like every other snapshot route', async () => {
  const f = fixture(); await complete(f);
  const denied = await f.handler(new Request(ORIGIN + `/v1/snapshots/${ID}`, { method: 'DELETE', headers: { authorization: 'Bearer wrong' } }), f.env);
  assert.ok(denied.status >= 400 && denied.status !== 404, 'authorization failure rejects before deletion');
  assert.equal((await f.call('/v1/snapshots', 'DELETE')).status, 405);
  f.env.SNAPSHOTS_ENABLED = 'false';
  assert.equal((await f.call(`/v1/snapshots/${ID}`, 'DELETE')).status, 503);
  assert.ok(await f.bucket.get(partKey(ID, 0)));
});

test('status reports live usage when enabled and bound', async () => {
  const f = fixture();
  let status = await (await f.call('/v1/status')).json();
  assert.deepEqual(status.usage, { day: '2026-11-22', writes: 0, reads: 0 });
  await prepare(f);
  status = await (await f.call('/v1/status')).json();
  assert.equal(status.usage.writes, 1);
  assert.equal(status.usage.reads, 0);
  assert.equal(status.usage.day, '2026-11-22');
});

test('status usage is null and storage untouched when disabled or unbound', async () => {
  for (const mutate of [env => { env.SNAPSHOTS_ENABLED = 'false'; }, env => { env.LIBRARY_BUCKET = undefined; }]) {
    const f = fixture();
    const real = f.env.LIBRARY_BUCKET;
    f.env.LIBRARY_BUCKET = new Proxy({}, { get() { throw new Error('storage touched'); } });
    mutate(f.env);
    const status = await (await f.call('/v1/status')).json();
    assert.equal(status.usage, null);
    assert.equal(typeof status.authenticated, 'boolean');
  }
});

test('status usage reads a rolled day as zero without mutating the stored counters', async () => {
  const f = fixture();
  await f.bucket.put(CONTROL_KEY, bytes({ version: 1, owner: 'synthetic-owner', day: '2026-11-21',
    writes: 500, reads: 12, snapshots: [] }), { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: {} });
  const status = await (await f.call('/v1/status')).json();
  assert.deepEqual(status.usage, { day: '2026-11-22', writes: 0, reads: 0 });
  const stored = JSON.parse(await (await f.bucket.get(CONTROL_KEY)).text());
  assert.equal(stored.day, '2026-11-21');
  assert.equal(stored.writes, 500);
});
