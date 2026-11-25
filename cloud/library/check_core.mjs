// Universal synthetic real-service check core: runs in node (CLI with an owner
// bearer token) and in the owner's browser (temporary reviewed staging page,
// same-origin cookies, no token). Generated metadata only, never personal rows.
// Covers: status and live usage preflight, begin/upload/receipt/hash readback,
// exact retries, immutable rejection, and explicit deletion with empty-list
// readback. The run fails before any write when the remaining UTC-day write
// budget cannot cover the planned shape plus reserve. Every failure after a
// reservation triggers best-effort cleanup of exactly the snapshots this run
// created, with residue reported. Any Workers CPU/resource failure surfaces as
// a non-2xx Worker error code and fails the run visibly.
import { SCHEMA, bytes, digest } from './schema.mjs';
import { validatePart } from './part.mjs';

// Exact write-admission debits for a run, verified against ledger.mjs: an
// admitted call debits first and persists; a call rejected after admission
// (changed-manifest / changed-part immutable 409) rolls back with its change
// and consumes nothing. Per snapshot: begin 1 + begin retry 1 + one per PUT
// + index-0 retry 1 + commit 1 + commit retry 1 + two ledger debits per bounded eight-part delete batch.
export function plannedWrites(snapshots, parts) {
  return snapshots * (parts + 5 + 2 * Math.ceil(parts / 8));
}
// Preflight headroom on top of the exact plan, covering arithmetic drift
// against live counters. Cleanup deletes for created snapshots are already
// inside the plan; cleanup never retries a failed delete.
const WRITES_MARGIN = 8;
const encoder = new TextEncoder();

export async function runCheck({ baseUrl = '', token = null, fetchImpl = fetch, snapshots = 1, parts = 256,
                                 partBytes = 256 * 1024, log = console.log, signal } = {}) {
  const created = [];
  async function call(path, { method = 'GET', body, expect = [200], timeout = 60000 } = {}) {
    const started = performance.now();
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method, redirect: 'error', cache: 'no-store',
        credentials: 'same-origin',
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(timeout) });
    } catch (error) { throw new Error(`${method} ${path} did not complete: ${error.name}`); }
    const ms = Math.round(performance.now() - started);
    const text = await response.text();
    if (!expect.includes(response.status)) {
      let code = ''; try { code = JSON.parse(text).error || ''; } catch { /* Worker HTML error page */ }
      throw new Error(`${method} ${path} -> ${response.status} ${code || text.slice(0, 80)} (CPU/resource failures show as 5xx here)`);
    }
    let value = null; try { value = JSON.parse(text); } catch { /* part bodies */ }
    return { value, text, ms, status: response.status, etag: response.headers.get('etag') };
  }
  async function remove(id) {
    let next = -1;
    for (let attempt = 0; attempt < 33; attempt++) {
      const { value, status } = await call(`/v1/snapshots/${id}`, { method: 'DELETE', expect: [200, 202] });
      if (value?.snapshotId !== id) throw new Error('delete receipt id mismatch');
      if (status === 200 && value.deleted === true) return value;
      if (status !== 202 || value.deleted !== false || value.state !== 'deleting' ||
          !Number.isSafeInteger(value.next) || value.next <= next || value.next < 1 ||
          !Number.isSafeInteger(value.parts) || value.parts > 256 || value.next >= value.parts) {
        throw new Error('delete progress invalid');
      }
      next = value.next;
    }
    throw new Error('delete progress exhausted');
  }
  async function cleanup() {
    for (const id of created) {
      try { await remove(id); }
      catch { log(`cleanup: ${id} may remain reserved; delete it from the app or rerun after reset`); }
    }
    created.length = 0;
  }
  async function fail(message) {
    await cleanup();
    throw new Error(`service_check: ${message}`);
  }
  async function checkpoint() {
    if (signal?.aborted === true) await fail('interrupted');
  }
  function syntheticPart(bytesTarget, seed, maxPartBytes) {
    // Padded tracks-table rows keep the DTO honest: validated vocabulary only.
    const rows = [];
    let body = '';
    for (let id = 1; ; id++) {
      rows.push({ id, title: `Synthetic service check ${seed} ${'x'.repeat(64)}`, artist: 'service-check' });
      body = JSON.stringify({ schema: SCHEMA, table: 'tracks', rows });
      if (encoder.encode(body).length >= bytesTarget) { rows.pop(); break; }
    }
    body = JSON.stringify({ schema: SCHEMA, table: 'tracks', rows });
    const value = JSON.parse(body);
    validatePart(value);
    if (rows.length < 1 || encoder.encode(body).length > maxPartBytes) throw new Error('could not build a valid synthetic part');
    return body;
  }

  async function run() {
    const status = await call('/v1/status');
    if (status.value?.authenticated !== true) throw new Error('service_check: status did not authenticate the owner session');
    if (status.value?.snapshotsEnabled !== true) throw new Error('service_check: snapshots are disabled on this deployment; run only against the reviewed enabled build');
    const limits = status.value.limits;
    if (!Number.isSafeInteger(snapshots) || snapshots < 1 || snapshots > limits.snapshots ||
        !Number.isSafeInteger(parts) || parts < 1 || parts > limits.parts ||
        !Number.isSafeInteger(partBytes) || partBytes < 1024 || partBytes > limits.partBytes) {
      await fail('shape outside reviewed limits');
    }
    const usage = status.value?.usage;
    if (!usage || !Number.isSafeInteger(usage.writes)) await fail('status reports no live usage; budget preflight is required before writes');
    const planned = plannedWrites(snapshots, parts), remaining = limits.writes - usage.writes;
    if (remaining < planned + WRITES_MARGIN) {
      await fail(`UTC-day write budget cannot cover this run: ${remaining} remaining, ${planned} planned + ${WRITES_MARGIN} reserve`);
    }
    log(`status ok: authenticated, enabled, limits ${JSON.stringify(limits)}, usage ${JSON.stringify(usage)}, planned writes ${planned}`);

    const before = await call('/v1/snapshots');
    if (!Array.isArray(before.value?.snapshots) || before.value.snapshots.length) {
      await fail(`stored list is not empty (${before.value.snapshots?.length}); refusing to mix with existing data`);
    }

    let slowest = 0;
    for (let round = 0; round < snapshots; round++) {
      await checkpoint();
      const id = crypto.randomUUID();
      const partBodies = [];
      for (let index = 0; index < parts; index++) {
        const body = syntheticPart(partBytes, `${round}-${index}`, limits.partBytes);
        partBodies.push({ body, bytes: encoder.encode(body).length, sha256: await digest(encoder.encode(body)) });
      }
      const manifest = JSON.stringify({ schema: SCHEMA, snapshotId: id, parts: partBodies.map(p => ({ bytes: p.bytes, sha256: p.sha256 })) });
      const begin = await call('/v1/snapshots', { method: 'POST', body: manifest, expect: [201] });
      if (begin.value?.state !== 'incomplete') await fail('begin did not return an incomplete receipt');
      created.push(id);
      // Exact begin retry is idempotent; a changed manifest for the same id is rejected.
      await call('/v1/snapshots', { method: 'POST', body: manifest, expect: [201] });
      const changed = JSON.parse(manifest); changed.parts[0].sha256 = '0'.repeat(64);
      await call('/v1/snapshots', { method: 'POST', body: JSON.stringify(changed), expect: [409] });
      for (let index = 0; index < partBodies.length; index++) {
        await checkpoint();
        const put = await call(`/v1/snapshots/${id}/parts/${index}`, { method: 'PUT', body: partBodies[index].body });
        if (put.value?.sha256 !== partBodies[index].sha256 || put.value?.stored !== true) await fail(`part ${index} receipt mismatch`);
        slowest = Math.max(slowest, put.ms);
        if (index === 0) {
          await call(`/v1/snapshots/${id}/parts/0`, { method: 'PUT', body: partBodies[0].body }); // exact retry
          await call(`/v1/snapshots/${id}/parts/0`, { method: 'PUT', body: syntheticPart(2048, 'changed', limits.partBytes), expect: [409] });
        }
      }
      const commit = await call(`/v1/snapshots/${id}/commit`, { method: 'POST', body: '{}' });
      if (commit.value?.state !== 'committed') await fail('commit did not return a committed receipt');
      const again = await call(`/v1/snapshots/${id}/commit`, { method: 'POST', body: '{}' });
      if (again.etag !== commit.etag) await fail('commit retry did not return the immutable receipt');
      const receipt = await call(`/v1/snapshots/${id}`);
      if (JSON.stringify(receipt.value) !== JSON.stringify(commit.value)) await fail('read receipt differs from commit receipt');
      // Hash readback of every part, largest first to stress CPU early.
      const order = [...partBodies.keys()].sort((a, b) => partBodies[b].bytes - partBodies[a].bytes);
      for (const index of order) {
        const got = await call(`/v1/snapshots/${id}/parts/${index}`);
        const raw = encoder.encode(got.text);
        if (raw.length !== partBodies[index].bytes || await digest(raw) !== partBodies[index].sha256) await fail(`part ${index} readback hash mismatch`);
        slowest = Math.max(slowest, got.ms);
      }
      log(`snapshot ${round + 1}/${snapshots} verified: ${parts} parts x ~${partBytes} bytes, slowest request so far ${slowest}ms`);
    }

    const list = await call('/v1/snapshots');
    if (list.value.snapshots.length !== created.length) await fail('stored list does not match created snapshots');
    for (const id of created) {
      const del = await remove(id);
      if (del.deleted !== true) await fail(`deletion of ${id} did not confirm`);
      await call(`/v1/snapshots/${id}`, { expect: [404] });
    }
    created.length = 0;
    const after = await call('/v1/snapshots');
    if (after.value.snapshots.length) await fail('stored list is not empty after deletion readback');
    log('service check passed: auth, usage preflight, begin/upload/receipt/hash readback, retries, immutable rejection, deletion with verified absence');
    return { plannedWrites: planned, slowestMs: slowest };
  }
  try {
    return await run();
  } catch (error) {
    await cleanup(); // fail() sites already cleaned; request-level throws land here.
    throw error;
  }
}
