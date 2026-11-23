import test from 'node:test';
import assert from 'node:assert/strict';
import { validCheckOrigin, plannedWrites, runServiceCheck } from './service_check.mjs';
import { createHandler } from './worker.mjs';
import { CONTROL_KEY } from './ledger.mjs';
import { LIMITS, bytes } from './contracts.mjs';
import { Bucket } from './test_bucket.mjs';

const ORIGIN = 'https://manadj-private-library.murtaza-javaid.workers.dev';
const NOW = Date.parse('2026-11-22T18:00:00Z'), DAY = '2026-11-22';

function fixture() {
  const bucket = new Bucket();
  const env = { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: bucket };
  const handler = createHandler({ authorize: async request => {
    if (request.headers.get('authorization') !== 'Bearer synthetic-check') throw new Error('denied');
    return { sub: 'synthetic-owner' };
  }, clock: () => NOW });
  const fetchImpl = (url, init) => handler(new Request(url, init), env);
  return { bucket, env, fetchImpl };
}
async function controlState(bucket) {
  const object = await bucket.get(CONTROL_KEY);
  return object ? JSON.parse(await object.text()) : null;
}
async function seedControl(bucket, state) {
  await bucket.put(CONTROL_KEY, bytes({ version: 1, owner: 'synthetic-owner', day: DAY, writes: 0, reads: 0, snapshots: [], ...state }),
    { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' } });
}
const quiet = () => {};

test('origin pin accepts only exact Workers hostnames', () => {
  assert.equal(validCheckOrigin(ORIGIN), true);
  assert.equal(validCheckOrigin('https://manadj-private-library.workers.dev'), true);
  for (const bad of ['http://manadj-private-library.murtaza-javaid.workers.dev',
    'https://manadj-private-library.murtaza-javaid.workers.dev:8443', 'https://manadj-private-library.murtaza-javaid.workers.dev/',
    'https://manadj-private-library.murtaza-javaid.workers.dev.evil.example', 'https://evil.example',
    'https://manadj-private-library.murtaza-javaid.workers.dev.attacker.workers.dev.evil.example',
    'HTTPS://manadj-private-library.murtaza-javaid.workers.dev', '', null, undefined]) {
    assert.equal(validCheckOrigin(bad), false, String(bad));
  }
});

test('planned writes match the exact ledger debit algorithm', () => {
  assert.equal(plannedWrites(1, 256), 263);   // reviewed Run A worst shape
  assert.equal(plannedWrites(10, 8), 150);    // reviewed Run B near-full ledger
  assert.equal(plannedWrites(2, 256), 526);   // old shape, over the 512/day budget
  assert.equal(plannedWrites(2, 3), 20);
});

test('happy path runs the full contract and debits exactly the planned writes', async () => {
  const f = fixture();
  const summary = await runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: f.fetchImpl,
    snapshots: 2, parts: 3, partBytes: 2048, log: quiet });
  assert.equal(summary.plannedWrites, 20);
  const control = await controlState(f.bucket);
  assert.deepEqual(control.snapshots, []);
  assert.equal(control.writes, 20);
  assert.ok(control.reads > 0);
});

test('a mid-run failure cleans up exactly its own reservation', async () => {
  const f = fixture();
  let partPuts = 0;
  f.bucket.hook = async (key, value, options) => {
    if (options?.delete || key === CONTROL_KEY) return;
    if (++partPuts === 3) throw new Error('r2 down');
  };
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: f.fetchImpl,
    snapshots: 1, parts: 5, partBytes: 2048, log: quiet }), /parts\/2|did not complete|500/);
  const control = await controlState(f.bucket);
  assert.deepEqual(control.snapshots, [], 'cleanup removed the tombstoned reservation');
  assert.equal([...f.bucket.objects.keys()].filter(k => k !== CONTROL_KEY).length, 0, 'no part objects remain');
});

test('budget preflight refuses before any write when the UTC day cannot cover the run', async () => {
  const f = fixture();
  await seedControl(f.bucket, { writes: LIMITS.writes - 5 });
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: f.fetchImpl,
    snapshots: 1, parts: 8, partBytes: 2048, log: quiet }), /write budget/);
  const control = await controlState(f.bucket);
  assert.equal(control.writes, LIMITS.writes - 5, 'no debit happened');
  assert.deepEqual(control.snapshots, []);
  assert.equal([...f.bucket.objects.keys()].filter(k => k !== CONTROL_KEY).length, 0);
});

test('a missing usage report fails before any write', async () => {
  const f = fixture();
  const wrapped = async (url, init) => {
    const response = await f.fetchImpl(url, init);
    if (new URL(url).pathname === '/v1/status') {
      const value = await response.json(); delete value.usage;
      return new Response(JSON.stringify(value), { status: 200, headers: response.headers });
    }
    return response;
  };
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: wrapped,
    snapshots: 1, parts: 3, partBytes: 2048, log: quiet }), /usage/);
  assert.equal(await controlState(f.bucket), null, 'nothing was written');
});

test('an interrupted run cleans up at the next checkpoint', async () => {
  const f = fixture();
  const controller = new AbortController();
  let calls = 0;
  const wrapped = async (url, init) => {
    if (++calls === 4) controller.abort(); // after status, list, begin
    return f.fetchImpl(url, init);
  };
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: wrapped,
    snapshots: 1, parts: 5, partBytes: 2048, log: quiet, signal: controller.signal }), /interrupted/);
  const control = await controlState(f.bucket);
  assert.deepEqual(control?.snapshots ?? [], [], 'the created reservation was cleaned up');
});

test('the disabled deployment is refused before any write', async () => {
  const f = fixture();
  f.env.SNAPSHOTS_ENABLED = 'false';
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: f.fetchImpl,
    snapshots: 1, parts: 3, partBytes: 2048, log: quiet }), /disabled/);
  assert.equal(await controlState(f.bucket), null);
});

test('a non-empty stored list is refused before any write', async () => {
  const f = fixture();
  await seedControl(f.bucket, { snapshots: [{ id: '12345678-1234-4234-8234-123456789012', manifestHash: '0'.repeat(64),
    total: 100, createdAt: '2026-11-22T00:00:00Z', committed: true, deleting: false, parts: [[100, '1'.repeat(64), true]] }] });
  await assert.rejects(runServiceCheck({ origin: ORIGIN, token: 'synthetic-check', fetchImpl: f.fetchImpl,
    snapshots: 1, parts: 3, partBytes: 2048, log: quiet }), /not empty/);
  const control = await controlState(f.bucket);
  assert.equal(control.snapshots.length, 1, 'existing data untouched');
});
