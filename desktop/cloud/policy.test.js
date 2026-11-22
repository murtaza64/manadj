const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { configuration, discovery, AuthorizationAttempt, authorizeFrame } = require('./policy');
const { EncryptedTokenStore } = require('./tokenStore');
const input = { enabled: true, resource: 'https://synthetic-library.example', issuer: 'https://synthetic-access.example',
  redirect: 'http://127.0.0.1:53682/oauth/library/callback' };
const config = configuration(input);
const metadata = { issuer: config.issuer, authorization_endpoint: `${config.issuer}/cdn-cgi/access/oauth/authorization`,
  token_endpoint: `${config.issuer}/cdn-cgi/access/oauth/token`, registration_endpoint: `${config.issuer}/cdn-cgi/access/oauth/registration`,
  revocation_endpoint: `${config.issuer}/cdn-cgi/access/oauth/revoke`, code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] };
function attempt(options) { return new AuthorizationAttempt(config, metadata, 'synthetic-client', options); }
function callback(a, additions = {}) {
  const u = new URL(config.redirect); u.search = new URLSearchParams({ state: a.state, code: 'synthetic-code', ...additions }); return u.href;
}
const rejects = (fn, code) => assert.throws(fn, err => err.code === code);

test('configuration defaults disabled, no target is guessed', () => {
  assert.equal(configuration(), null); assert.equal(configuration({ enabled: false, resource: input.resource }), null);
  rejects(() => new AuthorizationAttempt(null, metadata, 'x'), 'cloud_disabled');
});
test('configuration pins canonical HTTPS origins and one exact loopback callback', () => {
  for (const resource of ['http://synthetic-library.example', 'https://u@synthetic-library.example', input.resource + '/x', input.resource + '?x=1', input.resource + '#x']) {
    rejects(() => configuration({ ...input, resource }), 'cloud_configuration_invalid');
  }
  for (const redirect of ['http://localhost:53682/oauth/library/callback', 'http://127.0.0.1:80/oauth/library/callback',
    'http://127.0.0.1:53682/other', input.redirect + '?state=x', input.redirect + '#x', 'https://127.0.0.1:53682/oauth/library/callback']) {
    rejects(() => configuration({ ...input, redirect }), 'cloud_configuration_invalid');
  }
  assert.ok(Object.isFrozen(config));
});
test('discovery rejects moved endpoints, issuer and weaker OAuth capabilities', () => {
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
    rejects(() => discovery(config, { ...metadata, [key]: 'https://untrusted.example' }), 'cloud_discovery_mismatch');
  }
  for (const key of ['code_challenge_methods_supported', 'token_endpoint_auth_methods_supported', 'grant_types_supported']) {
    rejects(() => discovery(config, { ...metadata, [key]: [] }), 'cloud_discovery_mismatch');
  }
});
test('S256 uses fresh random state and verifier; callback form round-trips reserved characters', () => {
  const a = attempt(), b = attempt(); const url = new URL(a.authorizationURL());
  assert.notEqual(a.state, b.state); assert.notEqual(a.verifier, b.verifier);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('resource'), config.resource);
  const verifier = a.verifier, u = callback(a, { code: 'a+b&c=d/é' }); const form = new URLSearchParams(a.consume(u));
  assert.equal(form.get('code'), 'a+b&c=d/é'); assert.equal(form.get('code_verifier'), verifier);
  assert.equal(a.state, ''); assert.equal(a.verifier, ''); rejects(() => a.consume(u), 'cloud_signin_expired');
});
test('wrong callback address/state never yields token request and does not consume valid attempt', () => {
  const a = attempt(); const good = callback(a);
  for (const u of [good.replace('53682', '53683'), good.replace('/oauth/library/callback', '/other'),
    good.replace('127.0.0.1', 'localhost'), good + '#fragment', callback(a, { state: 'wrong' }), good + '&state=extra']) {
    rejects(() => a.consume(u), 'cloud_callback_rejected'); assert.equal(a.finished, false);
  }
  assert.ok(a.consume(good));
});
test('matched callback rejects duplicate/empty code, provider error and control characters, one-shot', () => {
  for (const build of [a => callback(a) + '&code=extra', a => callback(a, { code: '' }),
    a => callback(a, { error: 'untrusted provider prose' }), a => callback(a, { code: 'bad\nvalue' })]) {
    const a = attempt(); rejects(() => a.consume(build(a)), 'cloud_signin_declined'); assert.equal(a.finished, true);
  }
});
test('cancel, expiration and backward clock invalidate attempt', () => {
  let now = 10; const a = attempt({ clock: () => now, lifetimeMs: 100 }); const u = callback(a);
  now = 110; rejects(() => a.consume(u), 'cloud_signin_expired');
  const b = attempt({ clock: () => now }); now = 109; rejects(() => b.authorizationURL(), 'cloud_signin_expired');
  const c = attempt(); c.cancel(); rejects(() => c.authorizationURL(), 'cloud_signin_expired');
});
test('IPC guard only accepts intended main frame at the current local origin', () => {
  const frame = { url: 'http://127.0.0.1:49200/settings' };
  const wc = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false };
  const ev = { sender: wc, senderFrame: frame }; const target = 'http://127.0.0.1:49200';
  authorizeFrame(ev, wc, target);
  rejects(() => authorizeFrame({ ...ev, sender: {} }, wc, target), 'cloud_frame_rejected');
  rejects(() => authorizeFrame({ ...ev, senderFrame: { url: frame.url } }, wc, target), 'cloud_frame_rejected');
  frame.url = 'http://127.0.0.1:49201'; rejects(() => authorizeFrame(ev, wc, target), 'cloud_frame_rejected');
  frame.url = 'https://untrusted.example'; rejects(() => authorizeFrame(ev, wc, target), 'cloud_frame_rejected');
});

// A reversible fake, explicitly not an OS-encryption test or production adapter.
function fakeStorage(backend = 'gnome_libsecret') {
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from('FAKE:' + Buffer.from(value).toString('base64')),
    decryptString: bytes => { if (!bytes.toString().startsWith('FAKE:')) throw new Error(); return Buffer.from(bytes.toString().slice(5), 'base64').toString(); } };
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manadj-cloud-tests-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cloud'); const safeStorage = fakeStorage();
  return { root, safeStorage, store: new EncryptedTokenStore({ directory, safeStorage, platform: process.platform, audience: input.resource, ...options }) };
}
const tokens = { clientID: 'synthetic-client', refreshToken: 'synthetic-refresh-one' };
test('missing connection returns null; encrypted save/read/rotation/clear never writes plain token', async t => {
  const { store } = await fixture(t); assert.equal(await store.load(), null);
  await store.save(tokens); assert.deepEqual(await store.load(), tokens);
  assert.ok(!(await fs.readFile(store.file)).includes(Buffer.from(tokens.refreshToken)));
  if (process.platform !== 'win32') assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  await store.save({ ...tokens, refreshToken: 'synthetic-refresh-two' });
  assert.equal((await store.load()).refreshToken, 'synthetic-refresh-two');
  assert.deepEqual(await fs.readdir(store.directory), ['connection.enc']);
  await store.clear(); assert.equal(await store.load(), null);
});
test('Linux plaintext, unavailable and unknown stores fail closed without disk writes', async t => {
  for (const backend of ['basic_text', 'unknown', 'future-unknown']) {
    const { store } = await fixture(t, { safeStorage: fakeStorage(backend), platform: 'linux' });
    await assert.rejects(store.save(tokens), { code: 'cloud_os_encryption_unavailable' });
    await assert.rejects(fs.stat(store.directory), { code: 'ENOENT' });
  }
  const { store, safeStorage } = await fixture(t); safeStorage.isEncryptionAvailable = () => false;
  await assert.rejects(store.save(tokens), { code: 'cloud_os_encryption_unavailable' });
});
test('failed encryption preserves prior connection and emits no plaintext error', async t => {
  const { store, safeStorage } = await fixture(t); await store.save(tokens);
  safeStorage.encryptString = () => { throw new Error(tokens.refreshToken); };
  await assert.rejects(store.save({ ...tokens, refreshToken: 'replacement' }), { code: 'cloud_os_encryption_failed' });
  assert.deepEqual(await store.load(), tokens);
});
test('stored state is bound to its target; corrupt and overbroad state fails closed', async t => {
  const { store, safeStorage } = await fixture(t); await store.save(tokens);
  const other = new EncryptedTokenStore({ directory: store.directory, safeStorage, platform: process.platform, audience: 'https://other.example' });
  await assert.rejects(other.load(), { code: 'cloud_saved_connection_invalid' });
  await fs.writeFile(store.file, safeStorage.encryptString(JSON.stringify({ version: 1, binding: store.binding, ...tokens, accessToken: 'not-persisted' })));
  await assert.rejects(store.load(), { code: 'cloud_saved_connection_invalid' });
  await fs.writeFile(store.file, 'corrupt'); await assert.rejects(store.load(), { code: 'cloud_saved_connection_invalid' });
});
test('rejects oversized state, permissive modes and symlink connection file', { skip: process.platform === 'win32' }, async t => {
  const { store, root } = await fixture(t); await store.save(tokens);
  await fs.writeFile(store.file, Buffer.alloc(65537)); await assert.rejects(store.load(), { code: 'cloud_saved_connection_invalid' });
  await store.save(tokens); await fs.chmod(store.file, 0o644); await assert.rejects(store.load(), { code: 'cloud_saved_connection_invalid' });
  await fs.unlink(store.file); const foreign = path.join(root, 'foreign'); await fs.writeFile(foreign, 'untouched');
  await fs.symlink(foreign, store.file); await assert.rejects(store.load(), { code: 'cloud_saved_connection_unavailable' });
  assert.equal(await fs.readFile(foreign, 'utf8'), 'untouched');
});
