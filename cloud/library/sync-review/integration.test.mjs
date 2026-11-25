import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../worker.mjs';
import { canonical } from '../sync.mjs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('production entry keeps sync disabled independently of snapshots and pins group before lookup', async () => {
  let lookups = 0;
  const env = { LIBRARY_ORIGIN: 'https://sync.test', SNAPSHOTS_ENABLED: 'false',
    SYNC_GROUP: '11111111-1111-4111-8111-111111111111',
    SYNC_GROUPS: { idFromName() { lookups++; throw Error('unexpected'); } } };
  const handle = createHandler({ authorize: async () => ({ sub: 'fixture-owner' }) });
  const url = `https://sync.test/v1/sync/${env.SYNC_GROUP}/origins/22222222-2222-4222-8222-222222222222/head`;
  assert.equal((await handle(new Request(url), env)).status, 503);
  env.SYNC_ENABLED = 'true';
  assert.equal((await handle(new Request(url.replace(env.SYNC_GROUP, '99999999-9999-4999-8999-999999999999')), env)).status, 404);
  assert.equal(lookups, 0);
  const denied = createHandler({ authorize: async () => { throw Object.assign(new Error('owner'), { status: 401 }); } });
  assert.equal((await denied(new Request(url), env)).status, 401);
  assert.equal(lookups, 0);
});

test('Python RFC8785 signed numeric-key/unicode/float packet passes actual workerd storage', async () => {
  const vector = JSON.parse(await readFile(new URL('./python-vector.json', import.meta.url), 'utf8'));
  assert.equal(canonical(vector.packet.body), vector.canonicalBody);
  const body = vector.packet.body;
  const built = await build({ entryPoints: [new URL('../sync.mjs', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
  // Internal DO path only; owner proof is tested in the separate JWT outer harness.
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-11-01', bindings: { SYNC_GROUP: body.group_id, SYNC_BOOTSTRAP: JSON.stringify({ group: body.group_id,
      members: [{ origin: body.origin_id, subject: 'fixture-owner', key: vector.publicKey }] }) },
    durableObjects: { SYNC_GROUPS: { className: 'SyncGroup', useSQLite: true } } }));
  try {
    const ns = await mf.getDurableObjectNamespace('SYNC_GROUPS');
    const stub = ns.get(ns.idFromName(body.group_id));
    const response = await stub.fetch(`https://internal/origins/${body.origin_id}/operations/1`, { method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-reviewed-subject': 'fixture-owner' },
      body: JSON.stringify({ expectedPreviousSequence: 0, packet: vector.packet }) });
    assert.equal(response.status, 201, await response.text());
    const page = await stub.fetch(`https://internal/origins/${body.origin_id}/operations?after=0&limit=8`, { headers: { 'x-reviewed-subject': 'fixture-owner' } });
    assert.equal(canonical((await page.json()).operations), canonical([vector.packet]));
  } finally { await mf.dispose(); }
});
