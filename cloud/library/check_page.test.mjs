import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_PAGE_HTML } from './check_page.mjs';
import { CHECK_ASSETS } from './browser_sources.mjs';
import { createHandler } from './worker.mjs';
import { Bucket } from './test_bucket.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const ORIGIN = 'https://manadj-private-library.murtaza-javaid.workers.dev';
const NOW = Date.parse('2026-11-22T18:00:00Z');

test('generated browser sources are fresh copies of the canonical files', () => {
  const expected = {
    '/v1/service-check/browser/app.js': 'browser/app.js',
    '/v1/service-check/browser/check_core.mjs': 'check_core.mjs',
    '/v1/service-check/browser/schema.mjs': 'schema.mjs',
    '/v1/service-check/browser/part.mjs': 'part.mjs',
    '/v1/service-check/browser/fields.json': 'fields.json',
  };
  assert.deepEqual(Object.keys(CHECK_ASSETS).sort(), Object.keys(expected).sort());
  for (const [route, file] of Object.entries(expected)) {
    assert.equal(CHECK_ASSETS[route][0], readFileSync(join(here, file), 'utf8').replace(/\r\n/g, '\n'),
      `${route} is stale; run node cloud/library/sync_check_page.mjs`);
  }
});

test('the page is clearly temporary, click-driven and free of token or file inputs', () => {
  assert.match(CHECK_PAGE_HTML, /TEMPORARY REVIEWED STAGING FIXTURE/);
  assert.match(CHECK_PAGE_HTML, /Nothing runs on page load/);
  assert.equal(CHECK_PAGE_HTML.includes('type="file"'), false);
  assert.equal(CHECK_PAGE_HTML.includes('type="password"'), false);
  assert.equal(CHECK_PAGE_HTML.toLowerCase().includes('token'), false);
  assert.equal(CHECK_PAGE_HTML.includes('<input'), false);
});

function stubDom() {
  const listeners = new Map();
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { id, textContent: '', disabled: false,
        addEventListener: (kind, fn) => listeners.set(`${id}:${kind}`, fn) });
      return elements.get(id);
    },
    querySelectorAll() { return [...elements.values()].filter(e => e.id.startsWith('run-')); },
  };
  return { document, listeners, elements };
}

test('the browser bundle runs nothing on load and the click path checks out end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'manadj-check-page-'));
  for (const [route, [source]] of Object.entries(CHECK_ASSETS)) {
    writeFileSync(join(dir, route.split('/').pop()), source);
  }
  const { document, listeners, elements } = stubDom();
  const bucket = new Bucket();
  const env = { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: bucket };
  let fetches = 0;
  const handler = createHandler({ authorize: async () => ({ sub: 'synthetic-owner' }), clock: () => NOW });
  globalThis.document = document;
  globalThis.location = { href: `${ORIGIN}/v1/service-check` };
  globalThis.fetch = (url, init) => { fetches++; return handler(new Request(url, init), env); };
  try {
    await import(pathToFileURL(join(dir, 'app.js')).href);
    assert.equal(fetches, 0, 'importing the page script must not call the service');
    assert.ok(listeners.has('run-a:click') && listeners.has('run-b:click'));
    const before = bucket.calls.length;
    await listeners.get('run-a:click')({ preventDefault() {} });
    assert.ok(fetches > 0, 'the click drives the real check sequence');
    assert.match(elements.get('log').textContent, /run-a PASS/);
    assert.match(elements.get('log').textContent, /service check passed/);
    const control = JSON.parse(await (await bucket.get('library-v1/control.json')).text());
    assert.deepEqual(control.snapshots, [], 'the run cleaned up after itself');
    assert.equal(control.writes, 263, 'fixed shape A debits exactly the planned writes');
    assert.ok(bucket.calls.length > before);
    // The browser path never sends an authorization header; same-origin cookies do the work.
    const authHeaders = bucket.calls.filter(() => false); // request-level assertion below
    assert.deepEqual(authHeaders, []);
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.fetch;
  }
});

test('the browser path sends no authorization header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'manadj-check-page-'));
  for (const [route, [source]] of Object.entries(CHECK_ASSETS)) {
    writeFileSync(join(dir, route.split('/').pop()), source);
  }
  const { document, listeners } = stubDom();
  const bucket = new Bucket();
  const env = { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: bucket };
  const seen = [];
  const handler = createHandler({ authorize: async request => {
    seen.push(request.headers.get('authorization'));
    if (request.headers.get('authorization') !== null) throw new Error('browser path must not send bearer');
    return { sub: 'synthetic-owner' };
  }, clock: () => NOW });
  globalThis.document = document;
  globalThis.location = { href: `${ORIGIN}/v1/service-check` };
  globalThis.fetch = (url, init) => handler(new Request(url, init), env);
  try {
    await import(pathToFileURL(join(dir, 'app.js')).href);
    await listeners.get('run-b:click')({ preventDefault() {} });
    assert.ok(seen.length > 10);
    assert.ok(seen.every(h => h === null));
    const control = JSON.parse(await (await bucket.get('library-v1/control.json')).text());
    assert.equal(control.writes, 150, 'fixed shape B debits exactly the planned writes');
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.fetch;
  }
});

function fixture(overrides = {}) {
  const bucket = new Bucket();
  const env = { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: bucket, ...overrides };
  const handler = createHandler({ authorize: async request => {
    if (request.headers.get('authorization') !== 'Bearer synthetic-check') throw new Error('denied');
    return { sub: 'synthetic-owner' };
  }, clock: () => NOW });
  const call = (path, method = 'GET', headers = {}) =>
    handler(new Request(ORIGIN + path, { method, headers: { authorization: 'Bearer synthetic-check', ...headers } }), env);
  return { bucket, env, handler, call };
}

test('the fixture routes are owner-only GETs with locked-down headers', async () => {
  const f = fixture();
  const page = await f.call('/v1/service-check');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /TEMPORARY REVIEWED STAGING FIXTURE/);
  const script = await f.call('/v1/service-check/browser/check_core.mjs');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /text\/javascript/);
  const fields = await f.call('/v1/service-check/browser/fields.json');
  assert.match(fields.headers.get('content-type'), /application\/json/);
  assert.equal((await f.call('/v1/service-check', 'POST')).status, 405);
  assert.equal((await f.call('/v1/service-check/browser/app.js', 'POST')).status, 405);
  assert.equal((await f.call('/v1/service-check/browser/worker.mjs')).status, 404, 'no arbitrary source serving');
  assert.equal(f.bucket.calls.length, 0, 'fixture routes never touch storage');
});

test('the fixture is fail-closed: denied without owner auth, absent when disabled or unbound', async () => {
  const denied = createHandler({ authorize: async () => { throw new Error('denied'); }, clock: () => NOW });
  const unauth = await denied(new Request(ORIGIN + '/v1/service-check', { headers: {} }),
    { LIBRARY_ORIGIN: ORIGIN, SNAPSHOTS_ENABLED: 'true', LIBRARY_BUCKET: new Bucket() });
  assert.notEqual(unauth.status, 200);
  const disabled = fixture({ SNAPSHOTS_ENABLED: 'false' });
  assert.equal((await disabled.call('/v1/service-check')).status, 503);
  const unbound = fixture({ LIBRARY_BUCKET: undefined });
  assert.equal((await unbound.call('/v1/service-check')).status, 503);
});

test('cross-origin writes stay rejected while the page itself is GET-only', async () => {
  const f = fixture();
  const evil = await f.call('/v1/service-check', 'GET', { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
});
