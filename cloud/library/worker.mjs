import { LIMITS, Failure, authorizeOwner, bytes, digest, reject, readJSON, validateManifest, validID, integer } from './contracts.mjs';
import { Ledger, partKey, DELETE_BATCH_PARTS } from './ledger.mjs';
import { validatePart } from './part.mjs';
import { CHECK_PAGE_HTML } from './check_page.mjs';
import { CHECK_ASSETS } from './browser_sources.mjs';
const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' };
const response = (value, status = 200, extra = {}) => new Response(bytes(value), { status, headers: { ...HEADERS, ...extra } });
// TEMPORARY reviewed staging fixture assets (removed with the route once the
// gates pass). Owner-only behind the same authorization; the page CSP allows
// only same-origin scripts/connections.
const CHECK_PAGE_HEADERS = { ...HEADERS, 'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
export function createHandler({ authorize = authorizeOwner, clock = Date.now } = {}) {
  return async function handle(request, env) {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.LIBRARY_ORIGIN || url.search || url.hash || /%|\/\//.test(url.pathname)) reject(404, 'route_not_found');
      if (url.pathname === '/v1/status' && request.method === 'GET') {
        const owner = await authorize(request, env);
        // Live admission counters for budget preflight. The disabled or
        // unbound deployment never touches storage for this.
        const usage = env.SNAPSHOTS_ENABLED === 'true' && env.LIBRARY_BUCKET
          ? await new Ledger(env.LIBRARY_BUCKET, owner?.sub, clock()).usage() : null;
        return response({ authenticated: true, snapshotsEnabled: env.SNAPSHOTS_ENABLED === 'true', limits: LIMITS, usage });
      }
      // Disabled preparation performs no R2 operation, key fetch or body parsing.
      if (env.SNAPSHOTS_ENABLED !== 'true') reject(503, 'snapshots_disabled');
      const owner = await authorize(request, env);
      if (!env.LIBRARY_BUCKET || !owner?.sub) reject(503, 'library_configuration_missing');
      // Browser writes must come from the owner origin; native clients omit Origin.
      const origin = request.headers.get('origin');
      if (origin && origin !== env.LIBRARY_ORIGIN) reject(403, 'origin_rejected');
      // TEMPORARY reviewed staging fixture: owner-only page and its assets,
      // read-only GETs that never touch storage.
      if (url.pathname === '/v1/service-check') {
        if (request.method !== 'GET') reject(405, 'method_not_allowed');
        return new Response(CHECK_PAGE_HTML, { headers: CHECK_PAGE_HEADERS });
      }
      const checkAsset = CHECK_ASSETS[url.pathname];
      if (checkAsset) {
        if (request.method !== 'GET') reject(405, 'method_not_allowed');
        return new Response(checkAsset[0], { headers: { ...HEADERS, 'content-type': checkAsset[1] } });
      }
      const now = clock(), ledger = new Ledger(env.LIBRARY_BUCKET, owner.sub, now);
      if (url.pathname === '/v1/snapshots') {
        if (request.method === 'GET') return response({ snapshots: await ledger.read() });
        if (request.method !== 'POST') reject(405, 'method_not_allowed');
        const { raw, value } = await readJSON(request, 32768), total = validateManifest(value);
        return response(await ledger.begin(value, await digest(raw), total, now), 201);
      }
      const match = /^\/v1\/snapshots\/([a-f0-9-]+)(?:\/(commit|parts\/(0|[1-9]\d{0,2})))?$/.exec(url.pathname);
      if (!match || !validID(match[1])) reject(404, 'route_not_found');
      const id = match[1], index = match[3] === undefined ? null : Number(match[3]);
      if (index !== null && !integer(index, 0, LIMITS.parts - 1)) reject(404, 'route_not_found');
      if (match[2] === 'commit') {
        if (request.method !== 'POST') reject(405, 'method_not_allowed');
        const { value } = await readJSON(request, 2);
        if (JSON.stringify(value) !== '{}') reject(400, 'commit_body_invalid');
        const receipt = await ledger.commit(id), raw = bytes(receipt);
        return new Response(raw, { headers: { ...HEADERS, etag: `"${await digest(raw)}"` } });
      }
      if (index === null) {
        if (request.method === 'DELETE') {
          // Consistency-safe explicit owner deletion: tombstone in the ledger
          // first, remove part objects, verify absence by readback, then
          // release the reservation. Any interruption leaves a resumable
          // 'deleting' state, never a readable snapshot with missing parts.
          const started = await ledger.startDelete(id);
          if (!started.found) return response({ snapshotId: id, deleted: true, parts: 0, bytes: 0 });
          const end = Math.min(started.parts, started.next + DELETE_BATCH_PARTS);
          // At most eight objects per request, four concurrent chains. Never
          // acknowledge progress until all deletions have absence readback.
          for (let first = started.next; first < end; first += 4) {
            await Promise.all(Array.from({ length: Math.min(4, end - first) }, async (_, offset) => {
              const key = partKey(id, first + offset);
              await env.LIBRARY_BUCKET.delete(key);
              if (await env.LIBRARY_BUCKET.get(key)) reject(503, 'delete_readback_failed');
            }));
          }
          const finished = await ledger.finishDelete(id, end);
          if (finished.deleted === false) return response({ snapshotId: id, deleted: false,
            state: 'deleting', next: finished.next, parts: started.parts, bytes: started.bytes }, 202);
          return response({ snapshotId: id, deleted: true, parts: started.parts, bytes: started.bytes });
        }
        if (request.method !== 'GET') reject(405, 'method_not_allowed');
        const receipt = await ledger.read(id), raw = bytes(receipt);
        return new Response(raw, { headers: { ...HEADERS, etag: `"${await digest(raw)}"` } });
      }
      if (request.method === 'PUT') {
        const { raw, value } = await readJSON(request); validatePart(value);
        const hash = await digest(raw), reservation = await ledger.reservePart(id, index, raw.length, hash);
        if (!reservation.stored) {
          const put = await env.LIBRARY_BUCKET.put(partKey(id, index), raw, {
            onlyIf: new Headers({ 'If-None-Match': '*' }),
            httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }, customMetadata: { sha256: hash },
          });
          if (!put) {
            const existing = await env.LIBRARY_BUCKET.get(partKey(id, index));
            if (!existing || existing.size !== raw.length || existing.customMetadata?.sha256 !== hash) reject(409, 'stored_part_conflict');
            // Reconcile an ambiguous earlier write by hashing the actual stored bytes.
            if (await digest(await existing.arrayBuffer()) !== hash) reject(409, 'stored_part_conflict');
          }
          await ledger.markStored(id, index, raw.length, hash);
        }
        return response({ snapshotId: id, index, bytes: raw.length, sha256: hash, stored: true });
      }
      if (request.method === 'GET') {
        const expected = await ledger.read(id, index), object = await env.LIBRARY_BUCKET.get(partKey(id, index));
        if (!object || object.size !== expected.bytes) reject(503, 'readback_failed');
        const raw = await object.arrayBuffer();
        if (raw.byteLength !== expected.bytes || await digest(raw) !== expected.sha256) reject(503, 'readback_failed');
        return new Response(raw, { headers: { ...HEADERS, etag: `"${expected.sha256}"`,
          'content-disposition': `attachment; filename="${id}-part-${index}.json"` } });
      }
      reject(405, 'method_not_allowed');
    } catch (error) {
      if (error instanceof Failure) return response({ error: error.code }, error.status);
      return response({ error: 'library_unavailable' }, 503);
    }
  };
}
export default { fetch: createHandler() };
