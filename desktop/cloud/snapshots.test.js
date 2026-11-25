const test = require('node:test');
const assert = require('node:assert/strict');
const { listSnapshots, deleteSnapshot } = require('./snapshots');
const ID = '12345678-1234-4234-8234-123456789012';
const entry = (id = ID, state = 'committed') => ({ snapshotId: id, state, bytes: 100, parts: 1, createdAt: '2026-11-22T18:00:00Z' });
function connection(responses) {
  const calls = [];
  return { calls, authenticated: async (path, options = {}) => {
    calls.push([path, options.method || 'GET']);
    if (!responses.length) throw new Error('unexpected request ' + path);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  } };
}
test('listing validates and returns only bounded summaries', async () => {
  const c = connection([{ snapshots: [entry(), entry('22345678-1234-4234-8234-123456789012', 'incomplete')] }]);
  const value = await listSnapshots(c);
  assert.equal(value.length, 2); assert.equal(value[1].state, 'incomplete');
  assert.deepEqual(c.calls, [['/v1/snapshots', 'GET']]);
});
test('listing rejects malformed, excess or out-of-contract responses', async () => {
  for (const bad of [null, {}, { snapshots: null }, { snapshots: [{}] }, { snapshots: [entry('not-a-uuid')] },
    { snapshots: [entry(ID, 'unknown-state')] }, { snapshots: Array.from({ length: 11 }, () => entry()) },
    { snapshots: [{ ...entry(), extra: 'ok' }].map(x => (delete x.extra, { ...x, bytes: -1 })) }]) {
    const c = connection([bad]);
    await assert.rejects(listSnapshots(c), { code: 'cloud_response_invalid' });
  }
});
test('deletion sends one exact DELETE and independently read-backs absence', async () => {
  const c = connection([{ snapshotId: ID, deleted: true, parts: 2, bytes: 200 }, { snapshots: [] }]);
  const value = await deleteSnapshot(c, ID);
  assert.deepEqual(value.deleted, { snapshotId: ID, parts: 2, bytes: 200 });
  assert.deepEqual(value.snapshots, []);
  assert.deepEqual(c.calls, [[`/v1/snapshots/${ID}`, 'DELETE'], ['/v1/snapshots', 'GET']]);
});
test('deletion fails visibly when the id survives readback or the receipt mismatches', async () => {
  let c = connection([{ snapshotId: ID, deleted: true, parts: 1, bytes: 100 }, { snapshots: [entry()] }]);
  await assert.rejects(deleteSnapshot(c, ID), { code: 'cloud_delete_readback_failed' });
  for (const receipt of [{ snapshotId: ID, deleted: false, parts: 1, bytes: 100 }, { snapshotId: '22345678-1234-4234-8234-123456789012', deleted: true, parts: 1, bytes: 100 },
    { snapshotId: ID, deleted: true, parts: -1, bytes: 100 }, null])
    await assert.rejects(deleteSnapshot(connection([receipt]), ID), { code: 'cloud_response_invalid' });
  await assert.rejects(deleteSnapshot(connection([]), 'not-a-uuid'), { code: 'cloud_request_invalid' });
});

test('deletion follows bounded progress before confirming final independent absence', async () => {
  const progress = next => ({ snapshotId: ID, deleted: false, state: 'deleting', next, parts: 17, bytes: 1700 });
  const c = connection([progress(8), progress(16), { snapshotId: ID, deleted: true, parts: 17, bytes: 1700 }, { snapshots: [] }]);
  const result = await deleteSnapshot(c, ID);
  assert.equal(result.deleted.parts, 17);
  assert.deepEqual(c.calls.map(x => x[1]), ['DELETE', 'DELETE', 'DELETE', 'GET']);
});

test('deletion stops on stalled, regressed, excess or mismatched progress without an unbounded retry', async () => {
  const p = { snapshotId: ID, deleted: false, state: 'deleting', next: 8, parts: 17, bytes: 1700 };
  for (const bad of [p, { ...p, next: 7 }, { ...p, next: 17 }, { ...p, snapshotId: 'other' }, { ...p, parts: 257 }]) {
    const c = connection([p, bad]);
    await assert.rejects(deleteSnapshot(c, ID), { code: 'cloud_response_invalid' });
    assert.equal(c.calls.length, 2);
  }
});
