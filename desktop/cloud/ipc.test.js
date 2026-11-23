const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerCloudIpc } = require('./ipc');
const { prepareFromManagedBackend } = require('./source');
const target = require('./target');
function fixture() {
  const handlers = new Map(), events = [];
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  const frame = { url: 'http://127.0.0.1:4444/settings' }, wc = new EventEmitter();
  Object.assign(wc, { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false });
  const event = { sender: wc, senderFrame: frame };
  const connection = { publicState: () => ({ phase: 'connected', destination: 'https://synthetic.example' }) };
  for (const verb of ['connect', 'resume', 'disconnect', 'cancel']) connection[verb] = async () => { events.push(verb); };
  const upload = { state: () => ({ phase: 'review' }), clear: () => events.push('clear'), cancel: () => events.push('cancelUpload'),
    review: async () => events.push('review'), upload: async (...args) => events.push(['upload', ...args]) };
  const dispose = registerCloudIpc({ ipcMain, webContents: wc, connection, upload, getTargetURL: () => 'http://127.0.0.1:4444' });
  const call = (verb, ...args) => handlers.get(`library-cloud:${verb}`)(event, ...args);
  return { handlers, events, wc, event, frame, connection, upload, dispose, call };
}
test('compiled-in target remains disabled without environment/renderer overrides', () => {
  assert.equal(target.enabled, false); assert.ok(Object.isFrozen(target));
  assert.equal(target.resource, 'https://manadj-private-library.murtaza-javaid.workers.dev');
});
test('IPC safe state and exact reviewed upload parameters only', async () => {
  const f = fixture(); assert.equal((await f.call('state')).ok, true);
  const review = { reviewID: 'a'.repeat(48), reviewedSha256: 'b'.repeat(64) };
  assert.equal((await f.call('upload', review)).ok, true);
  assert.deepEqual(f.events[0], ['upload', review.reviewID, review.reviewedSha256]);
  for (const value of [{ ...review, body: 'injected' }, { reviewID: 'bad', reviewedSha256: review.reviewedSha256 }, null, []])
    assert.deepEqual(await f.call('upload', value), { ok: false, error: 'cloud_request_invalid' });
  assert.deepEqual(await f.call('review', { path: '/home/elsewhere' }), { ok: false, error: 'cloud_request_invalid' });
});
test('wrong sender, subframe or navigated renderer never invokes cloud verbs', async () => {
  const f = fixture();
  for (const event of [{ sender: {}, senderFrame: f.frame }, { sender: f.wc, senderFrame: { url: f.frame.url } }])
    assert.deepEqual(await f.handlers.get('library-cloud:review')(event), { ok: false, error: 'cloud_frame_rejected' });
  f.frame.url = 'https://hostile.invalid'; assert.equal((await f.call('connect')).error, 'cloud_frame_rejected');
  assert.equal(f.events.length, 0);
});
test('navigation/cancel/disposal invalidate work and remove every handler', async () => {
  const f = fixture();
  f.wc.emit('did-start-navigation', {}, 'about:blank', false, false);
  f.wc.emit('did-start-navigation', {}, '#settings', true, true);
  assert.deepEqual(f.events, []);
  f.wc.emit('did-start-navigation', {}, 'http://127.0.0.1:4444', false, true);
  assert.deepEqual(f.events, ['cancelUpload', 'cancel']);
  await f.call('cancel'); assert.deepEqual(f.events.slice(-1), ['cancelUpload']);
  f.connection.publicState = () => ({ phase: 'connecting' });
  await f.call('cancel'); assert.deepEqual(f.events.slice(-2), ['cancelUpload', 'cancel']);
  f.dispose(); assert.equal(f.handlers.size, 0); assert.equal(f.wc.listenerCount('did-start-navigation'), 0);
});
test('IPC does not pass raw exceptions, provider strings or credentials to renderer', async () => {
  const f = fixture(); f.connection.connect = async () => { throw new Error('private-secret'); };
  assert.deepEqual(await f.call('connect'), { ok: false, error: 'cloud_operation_failed' });
});
test('managed source refuses attach mode, arbitrary host/credentials/path, missing token before fetch', async () => {
  let calls = 0; const fetch = async () => { calls++; throw new Error(); };
  const handle = { url: 'http://127.0.0.1:1234', token: 'a'.repeat(48) };
  for (const value of [null, { ...handle, exited: true }, { ...handle, token: '' }, { ...handle, url: 'http://hostile.invalid:1234' },
    { ...handle, url: 'http://user@127.0.0.1:1234' }, { ...handle, url: 'http://127.0.0.1:1234/other' }])
    await assert.rejects(prepareFromManagedBackend(value, { fetch }), { code: 'cloud_managed_backend_required' });
  assert.equal(calls, 0);
});
test('managed source uses only fixed local endpoint and main-only shell token; no Origin or path input', async () => {
  const handle = { url: 'http://127.0.0.1:1234', token: 'a'.repeat(48) };
  const data = { parts: [], rowCounts: {}, omissions: [] };
  const value = await prepareFromManagedBackend(handle, { fetch: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:1234/api/_shell/cloud/prepare'); assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'x-manadj-shell-token': handle.token });
    assert.equal(options.body, undefined); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(value, data);
});
