const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudConnection } = require('./connection');
const config = { enabled: true, resource: 'https://synthetic-library.example', issuer: 'https://synthetic-access.example',
  redirect: 'http://127.0.0.1:53682/oauth/library/callback' };
const base = `${config.issuer}/cdn-cgi/access/oauth`;
const metadata = { issuer: config.issuer, authorization_endpoint: `${base}/authorization`, token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/registration`, revocation_endpoint: `${base}/revoke`,
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const calls = [], saves = []; let saved = null, opened = 0, now = 1000, refreshes = 0;
  const store = { assertEncryption() {}, async load() { return saved; },
    async save(value) { saves.push({ ...value }); saved = { ...value }; }, async clear() { saved = null; } };
  const fetcher = async (url, options) => {
    calls.push({ url, options }); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    if (url.endsWith('/.well-known/oauth-authorization-server')) return reply(metadata);
    if (url === `${base}/registration`) return reply({ client_id: 'synthetic-client', token_endpoint_auth_method: 'none', redirect_uris: [config.redirect] }, 201);
    if (url === `${base}/token`) {
      const form = new URLSearchParams(options.body);
      if (form.get('grant_type') === 'refresh_token') refreshes++;
      return reply({ token_type: 'Bearer', access_token: `oauth:synthetic-access-${refreshes}`, refresh_token: `synthetic-refresh-${refreshes}`, expires_in: 900 });
    }
    if (url === `${config.resource}/v1/status`) return reply({ authenticated: true, snapshotsEnabled: false });
    return reply({ synthetic: true });
  };
  const browserAuthorize = async ({ attempt, openExternal, signal }) => {
    assert.ok(!signal.aborted); await openExternal(attempt.authorizationURL());
    const url = new URL(config.redirect); url.search = new URLSearchParams({ state: attempt.state, code: 'synthetic-code' });
    return attempt.consume(url.href);
  };
  const connection = new CloudConnection({ config, store, fetch: fetcher, clock: () => now,
    openExternal: async () => { opened++; }, browserAuthorize, ...overrides });
  return { connection, calls, saves, store, fetcher, setSaved: value => { saved = value; }, getSaved: () => saved,
    advance: value => { now += value; }, getOpened: () => opened, getRefreshes: () => refreshes };
}
test('disabled lifecycle has no network, storage or browser effects', async () => {
  const f = fixture({ config: undefined });
  await assert.rejects(f.connection.connect(), { code: 'cloud_disabled' });
  assert.deepEqual(await f.connection.resume(), { phase: 'disabled', enabled: false, destination: null });
  await f.connection.disconnect(); assert.equal(f.calls.length, 0); assert.equal(f.saves.length, 0); assert.equal(f.getOpened(), 0);
});
test('full synthetic registration/browser/S256/exchange/status/persist exposes only safe state', async () => {
  const f = fixture();
  assert.deepEqual(await f.connection.connect(), { phase: 'connected', enabled: true, destination: config.resource });
  assert.equal(f.getOpened(), 1); assert.equal(f.saves.length, 1);
  assert.deepEqual(f.getSaved(), { clientID: 'synthetic-client', refreshToken: 'synthetic-refresh-0' });
  const registration = f.calls.find(c => c.url.endsWith('/registration'));
  assert.deepEqual(JSON.parse(registration.options.body).redirect_uris, [config.redirect]);
  const exchange = f.calls.find(c => c.url.endsWith('/token'));
  const form = new URLSearchParams(exchange.options.body);
  assert.equal(form.get('grant_type'), 'authorization_code'); assert.equal(form.get('client_id'), 'synthetic-client');
  assert.ok(form.get('code_verifier').length >= 43); assert.equal(form.get('resource'), config.resource);
  assert.ok(!JSON.stringify(f.connection.publicState()).includes('synthetic-access'));
  assert.ok(!JSON.stringify(f.connection.publicState()).includes('synthetic-refresh'));
  const status = f.calls.find(c => c.url.endsWith('/v1/status'));
  assert.equal(status.options.headers.authorization, 'Bearer oauth:synthetic-access-0');
});
test('OS storage rejection happens before registration or browser', async () => {
  const f = fixture(); f.store.assertEncryption = () => { throw new Error('private diagnostic'); };
  await assert.rejects(f.connection.connect(), { code: 'cloud_connection_failed' });
  assert.equal(f.calls.length, 0); assert.equal(f.getOpened(), 0); assert.equal(f.connection.publicState().phase, 'disconnected');
});
test('moved discovery or changed registration callback fails before browser or token exchange', async () => {
  for (const stage of ['discovery', 'registration']) {
    const f = fixture();
    f.connection.fetcher = async (url, options) => {
      if (stage === 'discovery' && url.includes('/.well-known/')) return reply({ ...metadata, token_endpoint: 'https://hostile.invalid/token' });
      if (stage === 'registration' && url.endsWith('/registration')) return reply({ client_id: 'x', token_endpoint_auth_method: 'none', redirect_uris: ['http://localhost:1'] });
      return f.fetcher(url, options);
    };
    await assert.rejects(f.connection.connect(), err => ['cloud_discovery_mismatch', 'cloud_registration_invalid'].includes(err.code));
    assert.equal(f.getOpened(), 0); assert.equal(f.saves.length, 0);
  }
});
test('wrong owner or malformed/opaque token response never persists a connection', async () => {
  for (const stage of ['owner', 'token', 'expires']) {
    const f = fixture();
    f.connection.fetcher = async (url, options) => {
      if (stage === 'owner' && url.endsWith('/v1/status')) return reply({ error: 'untrusted private provider prose' }, 401);
      if (stage === 'token' && url.endsWith('/token')) return reply({ token_type: 'Bearer', access_token: '', refresh_token: 'x', expires_in: 900 });
      if (stage === 'expires' && url.endsWith('/token')) return reply({ token_type: 'Bearer', access_token: 'x', refresh_token: 'x', expires_in: 999999 });
      return f.fetcher(url, options);
    };
    await assert.rejects(f.connection.connect(), err => !err.message.includes('provider prose'));
    assert.equal(f.saves.length, 0); assert.equal(f.connection.publicState().phase, 'disconnected');
  }
});
test('resume refreshes stored opaque token, verifies status and saves rotation', async () => {
  const f = fixture(); f.setSaved({ clientID: 'saved-client', refreshToken: 'saved-refresh' });
  assert.equal((await f.connection.resume()).phase, 'connected');
  assert.equal(f.getOpened(), 0); assert.equal(f.getRefreshes(), 1);
  const exchange = f.calls.find(c => c.url.endsWith('/token')), form = new URLSearchParams(exchange.options.body);
  assert.equal(form.get('client_id'), 'saved-client'); assert.equal(form.get('refresh_token'), 'saved-refresh');
  assert.deepEqual(f.getSaved(), { clientID: 'saved-client', refreshToken: 'synthetic-refresh-1' });
});
test('concurrent requests share a refresh and do not leak tokens in responses', async () => {
  const f = fixture(); await f.connection.connect(); f.advance(880000);
  const gate = deferred(); const entered = deferred();
  f.connection.fetcher = async (url, options) => {
    if (url.endsWith('/token')) { entered.resolve(); await gate.promise; }
    return f.fetcher(url, options);
  };
  const requests = [f.connection.authenticated('/v1/snapshots'), f.connection.authenticated('/v1/snapshots')];
  await entered.promise; gate.resolve();
  assert.deepEqual(await Promise.all(requests), [{ synthetic: true }, { synthetic: true }]);
  assert.equal(f.getRefreshes(), 1);
});
test('canceled login cannot persist stale callback or token exchange', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ browserAuthorize: async () => { entered.resolve(); return gate.promise; } });
  const work = f.connection.connect(); await entered.promise;
  assert.equal(f.connection.cancel().phase, 'disconnected'); gate.resolve('grant_type=authorization_code&code=synthetic');
  await assert.rejects(work, { code: 'cloud_operation_cancelled' });
  assert.equal(f.saves.length, 0); assert.equal(f.calls.some(c => c.url.endsWith('/token')), false);
});
test('disconnect queues after in-flight save so stale completion cannot resurrect storage', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const save = f.store.save; f.store.save = async value => { entered.resolve(); await release.promise; return save(value); };
  const work = f.connection.connect(); await entered.promise;
  const disconnect = f.connection.disconnect(); release.resolve();
  await assert.rejects(work, { code: 'cloud_operation_cancelled' }); await disconnect;
  assert.equal(f.getSaved(), null); assert.equal(f.connection.publicState().phase, 'disconnected');
});
test('stale refresh finishing after sign-out never reinstalls tokens or saved state', async () => {
  const f = fixture(); await f.connection.connect(); f.advance(880000);
  const gate = deferred(), entered = deferred();
  f.connection.fetcher = async (url, options) => {
    if (url.endsWith('/token')) { entered.resolve(); await gate.promise; }
    return f.fetcher(url, options);
  };
  const work = f.connection.authenticated('/v1/snapshots'); await entered.promise;
  await f.connection.disconnect(); gate.resolve();
  await assert.rejects(work, { code: 'cloud_operation_cancelled' });
  assert.equal(f.getSaved(), null); await assert.rejects(f.connection.authenticated('/v1/snapshots'), { code: 'cloud_signin_required' });
});
test('network/provider errors are sanitized and mutations are never auto-retried', async () => {
  const f = fixture(); await f.connection.connect(); let count = 0;
  f.connection.fetcher = async () => { count++; throw new Error('oauth:synthetic-secret'); };
  await assert.rejects(f.connection.authenticated('/v1/snapshots', { method: 'POST', body: '{}' }), { code: 'cloud_network_unavailable' });
  assert.equal(count, 1);
  f.connection.fetcher = async () => { count++; return reply({ error: 'private server diagnostic' }, 503); };
  await assert.rejects(f.connection.authenticated('/v1/snapshots'), { code: 'cloud_service_unavailable' }); assert.equal(count, 2);
});
test('hostile path/method rejected before authenticated request', async () => {
  const f = fixture(); await f.connection.connect(); const count = f.calls.length;
  for (const path of ['https://hostile.invalid', '//hostile.invalid/v1/status', '/v1/snapshots?x=1', '/v1/snapshots/../status', '/v1/snapshots#fragment'])
    await assert.rejects(f.connection.authenticated(path), { code: 'cloud_request_invalid' });
  await assert.rejects(f.connection.authenticated('/v1/snapshots', { method: 'DELETE' }), { code: 'cloud_request_invalid' });
  assert.equal(f.calls.length, count);
});
test('response limit and redirected requests fail without passing provider content', async () => {
  const f = fixture(); await f.connection.connect();
  f.connection.fetcher = async () => reply({ x: 'x'.repeat(300000) });
  await assert.rejects(f.connection.authenticated('/v1/snapshots'), { code: 'cloud_response_limit' });
  f.connection.fetcher = async () => new Response('redirect', { status: 302, headers: { location: 'https://hostile.invalid' } });
  await assert.rejects(f.connection.authenticated('/v1/snapshots'), { code: 'cloud_response_invalid' });
});
test('external cancellation aborts active request and rejects even a noncooperating mock', async () => {
  const f = fixture(); await f.connection.connect(); const gate = deferred(), entered = deferred(), controller = new AbortController();
  f.connection.fetcher = async (url, options) => { entered.resolve(); await gate.promise; assert.ok(options.signal.aborted); return reply({ synthetic: true }); };
  const work = f.connection.authenticated('/v1/snapshots', { signal: controller.signal });
  await entered.promise; controller.abort(); gate.resolve();
  await assert.rejects(work, { code: 'cloud_operation_cancelled' });
});

test('sync transport keeps fixed origin bounded routing and native-only tokens', async () => {
  const f = fixture(); await f.connection.connect();
  const group = '11111111-1111-4111-8111-111111111111', origin = '22222222-2222-4222-8222-222222222222';
  const packet = { body: { group_id: group, origin_id: origin, sequence: 1 }, signature: 'fixture' };
  await f.connection.syncAuthenticated(group, origin, 'head');
  await f.connection.syncAuthenticated(group, origin, 'read', { after: 7, limit: 8 });
  await f.connection.syncAuthenticated(group, origin, 'publish', { sequence: 1, packet });
  const calls = f.calls.filter(c => c.url.includes('/v1/sync/'));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, `${config.resource}/v1/sync/${group}/origins/${origin}/head`);
  assert.equal(calls[1].url, `${config.resource}/v1/sync/${group}/origins/${origin}/operations?after=7&limit=8`);
  assert.deepEqual(JSON.parse(calls[2].options.body), { expectedPreviousSequence: 0, packet });
  assert.equal(calls[2].options.headers.authorization, 'Bearer oauth:synthetic-access-0');
  for (const operation of [
    () => f.connection.syncAuthenticated('https://outside.invalid', origin, 'head'),
    () => f.connection.syncAuthenticated(group, origin, 'read', { after: -1 }),
    () => f.connection.syncAuthenticated(group, origin, 'read', { limit: 33 }),
    () => f.connection.syncAuthenticated(group, origin, 'publish', { sequence: 2, packet }),
    () => f.connection.syncAuthenticated(group, origin, 'publish', { sequence: 1, packet: { ...packet, padding: 'x'.repeat(248 * 1024) } }),
    () => f.connection.syncAuthenticated(group, origin, 'delete'),
  ]) await assert.rejects(operation, { code: 'cloud_request_invalid' });
  assert.equal(f.calls.filter(c => c.url.includes('/v1/sync/')).length, 3);
  await f.connection.disconnect();
  await assert.rejects(f.connection.syncAuthenticated(group, origin, 'head'), { code: 'cloud_signin_required' });
});
