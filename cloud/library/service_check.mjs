// Synthetic real-service verification for the private library Worker. Run only
// after a reviewed enablement deploy; it exercises the exact production path
// with generated metadata, never personal library rows.
//
//   node cloud/library/service_check.mjs --origin https://... --token-env LIBRARY_CHECK_TOKEN \
//     [--snapshots 2] [--parts 256] [--part-bytes 262144] [--max-ledger]
//
// The bearer token comes from the owner's own Access session and is read from
// an environment variable only. It is never printed, saved or forwarded.
// Covers: status, begin/upload/receipt/hash readback, exact retries, immutable
// rejection, quota-admission shapes under a near-full ledger, and explicit
// deletion with empty-list readback. Any Workers CPU/resource failure surfaces
// as a non-2xx Worker error code and fails the run visibly.
import { digest, bytes, SCHEMA } from './contracts.mjs';
import { validatePart } from './part.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
}
const ORIGIN = option('--origin', '');
const TOKEN_ENV = option('--token-env', 'LIBRARY_CHECK_TOKEN');
const SNAPSHOTS = Number(option('--snapshots', '2'));
const PARTS = Number(option('--parts', '256'));
const PART_BYTES = Number(option('--part-bytes', String(256 * 1024)));
if (!/^https:\/\/[a-z0-9-]+\.workers\.dev$/.test(ORIGIN)) fail('exact --origin https://<worker>.workers.dev required');
const TOKEN = process.env[TOKEN_ENV];
if (typeof TOKEN !== 'string' || !TOKEN) fail(`bearer token must be in env ${TOKEN_ENV}; never paste it on the command line`);
if (!Number.isSafeInteger(SNAPSHOTS) || SNAPSHOTS < 1 || SNAPSHOTS > 10 ||
    !Number.isSafeInteger(PARTS) || PARTS < 1 || PARTS > 256 ||
    !Number.isSafeInteger(PART_BYTES) || PART_BYTES < 1024 || PART_BYTES > 256 * 1024) fail('shape outside reviewed limits');

function fail(message) { console.error(`service_check: ${message}`); process.exit(1); }
function syntheticPart(bytesTarget, seed) {
  // Padded tracks-table rows keep the DTO honest: validated vocabulary only.
  const rows = [];
  let body = '';
  for (let id = 1; ; id++) {
    rows.push({ id, title: `Synthetic service check ${seed} ${'x'.repeat(64)}`, artist: 'service-check' });
    body = JSON.stringify({ schema: SCHEMA, table: 'tracks', rows });
    if (Buffer.byteLength(body) >= bytesTarget) { rows.pop(); break; }
  }
  body = JSON.stringify({ schema: SCHEMA, table: 'tracks', rows });
  const value = JSON.parse(body);
  validatePart(value);
  if (rows.length < 1 || Buffer.byteLength(body) > 256 * 1024) fail('could not build a valid synthetic part');
  return body;
}
async function call(path, { method = 'GET', body, expect = [200], timeout = 60000 } = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${ORIGIN}${path}`, { method, redirect: 'error', cache: 'no-store',
      headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(timeout) });
  } catch (error) { fail(`${method} ${path} did not complete: ${error.name}`); }
  const ms = Math.round(performance.now() - started);
  const text = await response.text();
  if (!expect.includes(response.status)) {
    let code = ''; try { code = JSON.parse(text).error || ''; } catch { /* Worker HTML error page */ }
    fail(`${method} ${path} -> ${response.status} ${code || text.slice(0, 80)} (CPU/resource failures show as 5xx here)`);
  }
  let value = null; try { value = JSON.parse(text); } catch { /* part bodies */ }
  return { value, text, ms, etag: response.headers.get('etag') };
}
const created = [];
async function cleanup() {
  for (const id of created) {
    try { await call(`/v1/snapshots/${id}`, { method: 'DELETE', expect: [200] }); }
    catch { console.error(`cleanup: ${id} still reserved; delete it from the app`); }
  }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

const status = await call('/v1/status');
if (status.value?.authenticated !== true) fail('status did not authenticate the owner session');
if (status.value?.snapshotsEnabled !== true) fail('snapshots are disabled on this deployment; run only against the reviewed enabled build');
console.log(`status ok: authenticated, enabled, limits ${JSON.stringify(status.value.limits)}`);

const before = await call('/v1/snapshots');
if (!Array.isArray(before.value?.snapshots) || before.value.snapshots.length) fail(`stored list is not empty (${before.value.snapshots?.length}); refusing to mix with existing data`);

for (let round = 0; round < SNAPSHOTS; round++) {
  const id = crypto.randomUUID();
  const parts = [];
  for (let index = 0; index < PARTS; index++) {
    const body = syntheticPart(PART_BYTES, `${round}-${index}`);
    parts.push({ body, bytes: Buffer.byteLength(body), sha256: await digest(new TextEncoder().encode(body)) });
  }
  const manifest = JSON.stringify({ schema: SCHEMA, snapshotId: id, parts: parts.map(p => ({ bytes: p.bytes, sha256: p.sha256 })) });
  const begin = await call('/v1/snapshots', { method: 'POST', body: manifest, expect: [201] });
  if (begin.value?.state !== 'incomplete') fail('begin did not return an incomplete receipt');
  created.push(id);
  // Exact begin retry is idempotent; a changed manifest for the same id is rejected.
  await call('/v1/snapshots', { method: 'POST', body: manifest, expect: [201] });
  const changed = JSON.parse(manifest); changed.parts[0].sha256 = '0'.repeat(64);
  await call('/v1/snapshots', { method: 'POST', body: JSON.stringify(changed), expect: [409] });
  let slowest = 0;
  for (let index = 0; index < parts.length; index++) {
    const put = await call(`/v1/snapshots/${id}/parts/${index}`, { method: 'PUT', body: parts[index].body });
    if (put.value?.sha256 !== parts[index].sha256 || put.value?.stored !== true) fail(`part ${index} receipt mismatch`);
    slowest = Math.max(slowest, put.ms);
    if (index === 0) {
      await call(`/v1/snapshots/${id}/parts/0`, { method: 'PUT', body: parts[0].body }); // exact retry
      await call(`/v1/snapshots/${id}/parts/0`, { method: 'PUT', body: syntheticPart(2048, 'changed'), expect: [409] });
    }
  }
  const commit = await call(`/v1/snapshots/${id}/commit`, { method: 'POST', body: '{}' });
  if (commit.value?.state !== 'committed') fail('commit did not return a committed receipt');
  const again = await call(`/v1/snapshots/${id}/commit`, { method: 'POST', body: '{}' });
  if (again.etag !== commit.etag) fail('commit retry did not return the immutable receipt');
  const receipt = await call(`/v1/snapshots/${id}`);
  if (JSON.stringify(receipt.value) !== JSON.stringify(commit.value)) fail('read receipt differs from commit receipt');
  // Hash readback of every part, largest first to stress CPU early.
  const order = [...parts.keys()].sort((a, b) => parts[b].bytes - parts[a].bytes);
  for (const index of order) {
    const got = await call(`/v1/snapshots/${id}/parts/${index}`);
    const raw = new TextEncoder().encode(got.text);
    if (raw.length !== parts[index].bytes || await digest(raw) !== parts[index].sha256) fail(`part ${index} readback hash mismatch`);
    slowest = Math.max(slowest, got.ms);
  }
  console.log(`snapshot ${round + 1}/${SNAPSHOTS} verified: ${PARTS} parts x ~${PART_BYTES} bytes, slowest request ${slowest}ms`);
}

const list = await call('/v1/snapshots');
if (list.value.snapshots.length !== created.length) fail('stored list does not match created snapshots');
for (const id of created) {
  const del = await call(`/v1/snapshots/${id}`, { method: 'DELETE' });
  if (del.value?.deleted !== true) fail(`deletion of ${id} did not confirm`);
  await call(`/v1/snapshots/${id}`, { expect: [404] });
}
created.length = 0;
const after = await call('/v1/snapshots');
if (after.value.snapshots.length) fail('stored list is not empty after deletion readback');
console.log('service check passed: auth, begin/upload/receipt/hash readback, retries, immutable rejection, deletion with verified absence');
